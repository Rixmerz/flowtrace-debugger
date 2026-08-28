/**
 * Outgoing W3C trace context propagation.
 *
 * Incoming propagation already works: runWithRemoteContext adopts a caller's
 * traceparent. The other half had to be done by hand — an integrator calling
 * currentTraceparent() and attaching it to every outbound request. That is fine
 * for code you own and useless for the code you do not: an HTTP client inside a
 * library, an SDK, anything you did not write. Those calls left the process
 * with no trace context, so the far side started a fresh trace and the two
 * halves never joined.
 *
 * This patches both edges of the process: outbound — global fetch and
 * http/https.request — to attach `traceparent` when a span is active, and
 * inbound — the HTTP server — to adopt a `traceparent` a caller sent.
 *
 * Inbound is patched for the same reason outbound was. runWithRemoteContext
 * has always existed, but it is not reachable: @flowtrace/capture-node is not
 * published, and under `flowtrace run` the runtime lives inside the CLI's
 * tarball at a version-pinned vendor path. So "call runWithRemoteContext in
 * your handler" was advice no user could actually follow, and every server
 * started a fresh trace per request no matter what the caller sent —
 * silently, since a split trace looks like a working trace until you go
 * looking for the other half.
 *
 * Patching globals is a heavier decision than the rest of the runtime, so the
 * rules here are deliberately conservative:
 *
 *   - Never overwrite a traceparent the caller already set. An application
 *     doing its own propagation, or forwarding one it received, wins.
 *   - Attach nothing when no span is active. A request outside any traced call
 *     goes out exactly as it would have.
 *   - Never throw. Every hook is wrapped: if anything goes wrong the original
 *     call proceeds unmodified. Losing propagation is acceptable; breaking the
 *     traced application is not.
 *   - Idempotent. Installing twice patches once, so a double bootstrap (worker
 *     threads inherit --import) does not stack wrappers.
 *
 * Opt out with FLOWTRACE_PROPAGATE=0.
 */

import { createRequire } from 'node:module';
import { currentTraceparent, runWithRemoteContext } from './context.js';

// IMPORTANT: the builtins are reached through createRequire, NOT a static
// `import http from 'node:http'`.
//
// A builtin's ESM facade snapshots its named exports from the CJS exports
// object when the facade is created, and the facade is created on the first
// *ESM* import of that builtin. A static import here would therefore build the
// facade before we patch, so an application doing
// `import { request } from 'node:http'` would keep binding the ORIGINAL
// function and silently get no propagation, while
// `import http from 'node:http'; http.request()` would work. Two import styles
// with different behaviour is worse than not patching at all — a user would
// have no way to tell which one they were in.
//
// createRequire reaches the CJS exports without creating the facade, so the
// facade is later built from the already-patched exports and both styles see
// it. Asserted by test-propagate-facade.mjs.
const require = createRequire(import.meta.url);
const http = require('node:http');
const https = require('node:https');

const HEADER = 'traceparent';

/** Marks a patched function so a second install is a no-op. */
const PATCHED = Symbol.for('flowtrace.propagate.patched');

/** Case-insensitive presence check over a plain headers object. */
function hasHeader(headers) {
  if (!headers) return false;
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === HEADER) return true;
  }
  return false;
}

// ── fetch ────────────────────────────────────────────────────

/**
 * Wraps global fetch. Header handling has three shapes to respect: a Headers
 * instance, an array of pairs, and a plain object — plus the case where the
 * traceparent lives on a Request passed as the first argument.
 */
function patchFetch() {
  const original = globalThis.fetch;
  if (typeof original !== 'function' || original[PATCHED]) return;

  const wrapper = function fetch(input, init) {
    let patchedInit = init;
    try {
      const tp = currentTraceparent();
      if (tp) {
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        if (!headers.has(HEADER)) {
          headers.set(HEADER, tp);
          patchedInit = { ...init, headers };
        }
      }
    } catch {
      // Fall through with the caller's original init.
      patchedInit = init;
    }
    return original.call(this, input, patchedInit);
  };

  wrapper[PATCHED] = true;
  globalThis.fetch = wrapper;
}

// ── http / https ─────────────────────────────────────────────

/**
 * http.request accepts (url), (url, options), (options) and any of those with
 * a trailing callback. Rather than reimplement that overload resolution, the
 * options object is located positionally: it is the first argument that is a
 * plain object and not a URL.
 */
function optionsArgIndex(args) {
  for (let i = 0; i < args.length && i < 3; i++) {
    const a = args[i];
    if (a && typeof a === 'object' && !(a instanceof URL) && typeof a !== 'function') return i;
  }
  return -1;
}

function patchNodeHttp(mod, name) {
  const original = mod[name];
  if (typeof original !== 'function' || original[PATCHED]) return;

  const wrapper = function (...args) {
    try {
      const tp = currentTraceparent();
      if (tp) {
        const idx = optionsArgIndex(args);
        if (idx >= 0) {
          const opts = args[idx];
          if (!hasHeader(opts.headers)) {
            // Copy rather than mutate: the caller may reuse the object, and a
            // stale traceparent on a later request would be worse than none.
            args[idx] = { ...opts, headers: { ...opts.headers, [HEADER]: tp } };
          }
        } else if (args.length > 0) {
          // Only a URL (and maybe a callback) was passed, so there is no
          // options object to extend — insert one right after the URL, where
          // the overload expects it.
          args.splice(1, 0, { headers: { [HEADER]: tp } });
        }
      }
    } catch {
      // Leave args as the caller built them.
    }
    return original.apply(this, args);
  };

  wrapper[PATCHED] = true;
  mod[name] = wrapper;
}

// ── inbound ──────────────────────────────────────────────

/**
 * Adopts an inbound `traceparent` so this process continues the caller's trace.
 *
 * Patched at `http.Server.prototype.emit` rather than at `createServer`'s
 * listener because that is the single choke point: `createServer(fn)` is
 * itself `server.on('request', fn)`, and every framework — express, fastify,
 * koa, plain http — arrives through `emit('request', req, res)`. One patch,
 * no per-framework knowledge. https.Server extends http.Server, so this covers
 * TLS too.
 *
 * The same conservative rules as the outbound half: never throw (a failure
 * here would break the traced application, and losing correlation is the
 * lesser loss), do nothing when there is no header, and stay idempotent.
 * runWithRemoteContext already calls fn() directly for an absent or malformed
 * header, so an untraced request goes through exactly as it would have.
 */
function patchServerInbound(mod) {
  const Server = mod.Server;
  if (typeof Server !== 'function' || !Server.prototype) return;

  const original = Server.prototype.emit;
  if (typeof original !== 'function' || original[PATCHED]) return;

  const wrapper = function emit(event, ...args) {
    if (event !== 'request') return original.call(this, event, ...args);
    try {
      const tp = args[0]?.headers?.[HEADER];
      if (tp) {
        return runWithRemoteContext(tp, () => original.call(this, event, ...args));
      }
    } catch {
      // Fall through and emit exactly as the caller would have.
    }
    return original.call(this, event, ...args);
  };

  wrapper[PATCHED] = true;
  Server.prototype.emit = wrapper;
}

// ── install ──────────────────────────────────────────────────

/**
 * Installs outgoing propagation on every supported client. Safe to call more
 * than once.
 *
 * @returns {boolean} true when propagation is active after this call.
 */
export function installOutgoingPropagation() {
  if (process.env.FLOWTRACE_PROPAGATE === '0') return false;
  try {
    patchFetch();
    // http.Server covers https.Server too — it extends it.
    patchServerInbound(http);
    patchNodeHttp(http, 'request');
    patchNodeHttp(http, 'get');
    patchNodeHttp(https, 'request');
    patchNodeHttp(https, 'get');
    return true;
  } catch {
    // An environment without one of these is not an error; it just means no
    // propagation there.
    return false;
  }
}
