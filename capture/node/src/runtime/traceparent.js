/**
 * W3C Trace Context — `traceparent` header parsing and formatting.
 *
 * Spec: https://www.w3.org/TR/trace-context/#traceparent-header
 *
 *   traceparent = version "-" trace-id "-" parent-id "-" trace-flags
 *   version     = 2 HEXDIGLC   ; "ff" is forbidden
 *   trace-id    = 32 HEXDIGLC  ; all-zero is invalid
 *   parent-id   = 16 HEXDIGLC  ; all-zero is invalid
 *   trace-flags = 2 HEXDIGLC   ; bit 0 = sampled
 *
 * HEXDIGLC is *lowercase* hex — uppercase is rejected, not normalized. The
 * spec is explicit about this, and being lenient here would let us emit a
 * trace_id that fails our own schema (`^[0-9a-f]{32}$`).
 *
 * This is what lets one logical request keep a single trace_id across process
 * boundaries. Without it every process mints its own root and the resulting
 * trees can never be joined.
 */

const INVALID_TRACE_ID = '0'.repeat(32);
const INVALID_SPAN_ID = '0'.repeat(16);

/** Lowercase-hex test of an exact length. */
function isHex(value, length) {
  if (typeof value !== 'string' || value.length !== length) return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    // 0-9 or a-f
    if (!((c >= 48 && c <= 57) || (c >= 97 && c <= 102))) return false;
  }
  return true;
}

/**
 * @typedef {{ trace_id: string, parent_id: string, flags: number, sampled: boolean }} RemoteContext
 */

/**
 * Parses a `traceparent` header value.
 *
 * Returns null for anything invalid rather than throwing — a malformed header
 * from a caller we do not control must degrade to "start a new trace", never
 * break the traced application.
 *
 * @param {string|string[]|undefined|null} header
 * @returns {RemoteContext|null}
 */
export function parseTraceparent(header) {
  // Node gives repeated headers as an array. The spec says a request with
  // multiple traceparent values is malformed, so we do not guess which wins.
  if (Array.isArray(header)) return null;
  if (typeof header !== 'string') return null;

  const parts = header.split('-');
  if (parts.length < 4) return null;

  const [version, traceId, parentId, flags] = parts;

  if (!isHex(version, 2) || version === 'ff') return null;

  // Version 00 is exactly four fields. Later versions may append more, and the
  // spec requires us to accept those by parsing the fields we understand — so
  // extra trailing fields are only tolerated when the version says so.
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
 * Builds a `traceparent` header value to send on an outgoing call.
 *
 * We always emit version 00 and the sampled flag: an event only reaches this
 * code path because it was captured, so from the peer's perspective this trace
 * is sampled.
 *
 * @param {{ trace_id: string, span_id: string }} ctx
 * @returns {string|null} null if ctx does not hold valid W3C ids.
 */
export function formatTraceparent(ctx) {
  if (!ctx) return null;
  const { trace_id: traceId, span_id: spanId } = ctx;
  if (!isHex(traceId, 32) || traceId === INVALID_TRACE_ID) return null;
  if (!isHex(spanId, 16) || spanId === INVALID_SPAN_ID) return null;
  return `00-${traceId}-${spanId}-01`;
}
