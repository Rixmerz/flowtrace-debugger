/**
 * HTTP trace-context propagation for FlowTrace v2.
 *
 * Outbound: injects `traceparent` into requests made via http.request/get,
 * https.request/get, and global fetch.
 * Inbound:  extracts `traceparent` from incoming requests and runs the whole
 * handler chain inside a seeded span context.
 *
 * Design notes:
 *
 *   - Inbound is patched at `http.Server.prototype.emit` rather than at
 *     `createServer`. Every route into a request listener — the createServer
 *     argument, `server.on('request')`, and frameworks like Express that
 *     register that way — funnels through this one emit, so a single patch
 *     covers all of them. Because AsyncLocalStorage.run propagates across
 *     async continuations, handlers that await still see the context.
 *     https.Server extends http.Server, so HTTPS is covered for free.
 *
 *   - `http.get` does NOT go through the exported `http.request` (it closes
 *     over the module-local binding), so both are patched independently.
 *
 *   - An existing `traceparent` on an outbound request is never overwritten:
 *     an explicit caller header, or another instrumentation layer, wins.
 *
 * All patches are idempotent and fail open — a propagation bug must never
 * break the traced application.
 */

import { createRequire } from 'node:module';

import { storage } from './context.js';
import { TRACEPARENT, currentTraceparent, syntheticParentFrom } from './propagation.js';

// IMPORTANT: obtained via createRequire, NOT a static ESM import.
//
// A builtin's ESM facade snapshots its named exports from the CJS exports when
// the facade is created, which happens on the first *ESM* import of that
// builtin. A static import here would create the facade before we patch, so
// `import { request } from 'node:http'` would bind the ORIGINAL and skip
// injection, while `import http from 'node:http'; http.request()` would work.
// createRequire reaches the CJS exports without creating the facade, so both
// import styles observe the patch. (The Server.prototype.emit patch below is
// immune either way — prototype methods resolve at call time.)
const require = createRequire(import.meta.url);
const http = require('node:http');
const https = require('node:https');

let installed = false;

/**
 * True if a headers-ish object already carries a traceparent, case-insensitively.
 * @param {Record<string, unknown>} headers
 */
function hasTraceparent(headers) {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === TRACEPARENT) return true;
  }
  return false;
}

/**
 * Normalize the many http.request signatures into "the options object that
 * carries headers", inserting one when the caller passed only a URL.
 *
 * Accepted shapes:
 *   request(url)                    request(options)
 *   request(url, cb)                request(options, cb)
 *   request(url, options)           request(url, options, cb)
 *
 * @param {unknown[]} args
 * @returns {{ args: unknown[], options: Record<string, any> } | null}
 */
function optionsFrom(args) {
  const isPlainish = (v) => typeof v === 'object' && v !== null && !(v instanceof URL);

  // request(url, options[, cb]) — second arg is the options bag.
  if ((typeof args[0] === 'string' || args[0] instanceof URL) && isPlainish(args[1])) {
    return { args, options: args[1] };
  }
  // request(options[, cb])
  if (isPlainish(args[0])) {
    return { args, options: args[0] };
  }
  // request(url[, cb]) — no options bag exists; splice one in after the URL.
  if (typeof args[0] === 'string' || args[0] instanceof URL) {
    const options = {};
    const next = [args[0], options, ...args.slice(1)];
    return { args: next, options };
  }
  return null;
}

/**
 * Wrap http.request / http.get style functions to inject the header.
 * @param {Function} original
 * @returns {Function}
 */
function wrapRequestFn(original) {
  return function flowtraceRequest(...args) {
    try {
      const traceparent = currentTraceparent();
      if (traceparent) {
        const normalized = optionsFrom(args);
        if (normalized) {
          const { options } = normalized;
          options.headers = options.headers ?? {};
          if (!hasTraceparent(options.headers)) {
            options.headers[TRACEPARENT] = traceparent;
          }
          args = normalized.args;
        }
      }
    } catch {
      // Fail open: never break the caller's request over a tracing concern.
    }
    return original.apply(this, args);
  };
}

/**
 * Wrap global fetch to inject the header, handling every documented shape of
 * `init.headers` (Headers instance, entry array, plain object).
 * @param {typeof globalThis.fetch} original
 */
function wrapFetch(original) {
  return function flowtraceFetch(input, init) {
    try {
      const traceparent = currentTraceparent();
      if (!traceparent) return original.call(this, input, init);

      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      if (!headers.has(TRACEPARENT)) {
        headers.set(TRACEPARENT, traceparent);
      }
      return original.call(this, input, { ...init, headers });
    } catch {
      return original.call(this, input, init);
    }
  };
}

/**
 * Install inbound + outbound HTTP propagation. Idempotent.
 */
export function install() {
  if (installed) return;
  installed = true;

  // ── Outbound ───────────────────────────────────────────────────
  http.request = wrapRequestFn(http.request);
  http.get = wrapRequestFn(http.get);
  https.request = wrapRequestFn(https.request);
  https.get = wrapRequestFn(https.get);

  if (typeof globalThis.fetch === 'function') {
    globalThis.fetch = wrapFetch(globalThis.fetch);
  }

  // ── Inbound ────────────────────────────────────────────────────
  const originalEmit = http.Server.prototype.emit;
  http.Server.prototype.emit = function flowtraceEmit(type, ...rest) {
    if (type !== 'request') {
      return originalEmit.call(this, type, ...rest);
    }
    let parent = null;
    try {
      parent = syntheticParentFrom(rest[0]?.headers?.[TRACEPARENT]);
    } catch {
      parent = null;
    }
    if (!parent) {
      return originalEmit.call(this, type, ...rest);
    }
    // Seed the context for the entire handler chain, so the first
    // instrumented function inside becomes a child of the remote span.
    return storage.run(parent, () => originalEmit.call(this, type, ...rest));
  };
}
