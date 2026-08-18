/**
 * W3C Trace Context parsing and rendering for the browser.
 *
 * Deliberately a copy of capture/node/src/runtime/traceparent.js rather than a
 * shared import: that file lives in a different package with a Node-only
 * dependency graph, and this one must bundle into a browser build with nothing
 * else pulled in. The two are pinned to the same behaviour by identical test
 * vectors — the canonical W3C example, the invalid-id and version cases — so a
 * change to one that is not mirrored fails the other's suite.
 */

const INVALID_TRACE_ID = '0'.repeat(32);
const INVALID_SPAN_ID = '0'.repeat(16);

/** Lowercase hex of an exact length. Uppercase is rejected, not normalized:
 *  accepting it would let us emit an id that fails our own schema. */
function isHex(value, length) {
  if (typeof value !== 'string' || value.length !== length) return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (!((c >= 48 && c <= 57) || (c >= 97 && c <= 102))) return false;
  }
  return true;
}

/**
 * @param {string|null|undefined} header
 * @returns {{trace_id: string, parent_id: string, flags: number, sampled: boolean}|null}
 */
export function parseTraceparent(header) {
  if (typeof header !== 'string') return null;
  const parts = header.split('-');
  if (parts.length < 4) return null;
  const [version, traceId, parentId, flags] = parts;
  if (!isHex(version, 2) || version === 'ff') return null;
  // Version 00 is exactly four fields; later versions may append.
  if (version === '00' && parts.length !== 4) return null;
  if (!isHex(traceId, 32) || traceId === INVALID_TRACE_ID) return null;
  if (!isHex(parentId, 16) || parentId === INVALID_SPAN_ID) return null;
  if (!isHex(flags, 2)) return null;
  const flagBits = parseInt(flags, 16);
  return {
    trace_id: traceId,
    parent_id: parentId,
    flags: flagBits,
    sampled: (flagBits & 0x01) === 0x01,
  };
}

/**
 * @param {{trace_id: string, span_id: string}|null} ctx
 * @returns {string|null}
 */
export function formatTraceparent(ctx) {
  if (!ctx) return null;
  const { trace_id: traceId, span_id: spanId } = ctx;
  if (!isHex(traceId, 32) || traceId === INVALID_TRACE_ID) return null;
  if (!isHex(spanId, 16) || spanId === INVALID_SPAN_ID) return null;
  return `00-${traceId}-${spanId}-01`;
}
