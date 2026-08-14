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
 * This patches the outbound edges of the process — global fetch, and
 * http/https.request — to attach `traceparent` when a span is active.
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

import http from 'node:http';
import https from 'node:https';
import { currentTraceparent } from './context.js';

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
