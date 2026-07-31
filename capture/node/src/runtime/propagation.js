/**
 * W3C Trace Context propagation for FlowTrace v2.
 *
 * Until this module existed, every entry point minted a fresh trace_id via
 * newTraceId(), so a trace died at the process boundary: two services in a
 * request chain produced two unrelated traces and cross-repo call trees were
 * impossible.  This module carries trace_id/span_id across boundaries in the
 * standard `traceparent` form, so the MCP server's parent_id linking (which is
 * already file-agnostic) reconstructs a single tree spanning every service.
 *
 * Format (W3C Trace Context Level 1, version 00):
 *
 *     00-<32 hex trace_id>-<16 hex span_id>-<2 hex flags>
 *     └┬┘ └──────┬───────┘ └──────┬──────┘ └────┬─────┘
 *   version   trace-id        parent-id       flags
 *
 * Two carriers are supported:
 *   - env `FLOWTRACE_TRACEPARENT` — process boundaries (subprocess, CLI chains)
 *   - HTTP header `traceparent`   — network boundaries (see ./http.js)
 *
 * @see https://www.w3.org/TR/trace-context/
 */

import { getCurrent } from './context.js';

/** Header / env carrier name (lowercase per spec). */
export const TRACEPARENT = 'traceparent';

/** Env var used to seed a root context across process boundaries. */
export const TRACEPARENT_ENV = 'FLOWTRACE_TRACEPARENT';

const TRACE_ID_RE = /^[0-9a-f]{32}$/;
const SPAN_ID_RE = /^[0-9a-f]{16}$/;

/** All-zero IDs are explicitly invalid per the W3C spec. */
const NULL_TRACE_ID = '0'.repeat(32);
const NULL_SPAN_ID = '0'.repeat(16);

/**
 * Parse a `traceparent` value.
 *
 * Returns null for anything malformed rather than throwing — a bad upstream
 * header must never break the traced application. Unknown future versions are
 * accepted when the first four fields still parse, as the spec requires.
 *
 * @param {string|undefined|null} value
 * @returns {{ trace_id: string, span_id: string, sampled: boolean } | null}
 */
export function parseTraceparent(value) {
  if (typeof value !== 'string') return null;

  const parts = value.trim().toLowerCase().split('-');
  // version, trace_id, span_id, flags. Future versions may append more.
  if (parts.length < 4) return null;

  const [version, trace_id, span_id, flags] = parts;

  // "ff" is forbidden; anything else is a version we can read the first
  // four fields of.
  if (!/^[0-9a-f]{2}$/.test(version) || version === 'ff') return null;
  if (!TRACE_ID_RE.test(trace_id) || trace_id === NULL_TRACE_ID) return null;
  if (!SPAN_ID_RE.test(span_id) || span_id === NULL_SPAN_ID) return null;
  if (!/^[0-9a-f]{2}$/.test(flags)) return null;

  // Version 00 has exactly 4 fields; extra fields mean a malformed v00 header.
  if (version === '00' && parts.length !== 4) return null;

  return {
    trace_id,
    span_id,
    sampled: (parseInt(flags, 16) & 0x01) === 0x01,
  };
}

/**
 * Serialize IDs into a `traceparent` value.
 *
 * @param {string} trace_id - 32 lowercase hex chars.
 * @param {string} span_id  - 16 lowercase hex chars.
 * @param {boolean} [sampled=true]
 * @returns {string|null} null if the IDs are not spec-valid.
 */
export function formatTraceparent(trace_id, span_id, sampled = true) {
  if (!TRACE_ID_RE.test(trace_id ?? '') || trace_id === NULL_TRACE_ID) return null;
  if (!SPAN_ID_RE.test(span_id ?? '') || span_id === NULL_SPAN_ID) return null;
  return `00-${trace_id}-${span_id}-${sampled ? '01' : '00'}`;
}

// ── Root seed ────────────────────────────────────────────────────────
//
// A "synthetic parent" is a context that was never emitted as an event — it
// only exists so that the first *local* span inherits the remote trace_id and
// points parent_id at the remote span. depth is -1 so that the existing
// `parent.depth + 1` arithmetic yields 0 for that first local span, keeping
// the schema's `depth >= 0` constraint intact.
export const SYNTHETIC_PARENT_DEPTH = -1;

/**
 * Build a synthetic parent context from a traceparent value.
 *
 * @param {string|undefined|null} value
 * @returns {{ trace_id: string, span_id: string, depth: number } | null}
 */
export function syntheticParentFrom(value) {
  const parsed = parseTraceparent(value);
  if (parsed === null) return null;
  return {
    trace_id: parsed.trace_id,
    span_id: parsed.span_id,
    depth: SYNTHETIC_PARENT_DEPTH,
  };
}

/**
 * Cached env-derived root seed. `undefined` = not yet resolved, `null` = no
 * valid seed present. Resolved once because process env does not change
 * meaningfully mid-run and __ft_enter is on the hot path.
 *
 * @type {{ trace_id: string, span_id: string, depth: number } | null | undefined}
 */
let envSeed;

/**
 * The synthetic parent implied by `FLOWTRACE_TRACEPARENT`, or null.
 * @returns {{ trace_id: string, span_id: string, depth: number } | null}
 */
export function rootSeed() {
  if (envSeed === undefined) {
    envSeed = syntheticParentFrom(process.env[TRACEPARENT_ENV]);
  }
  return envSeed;
}

/**
 * Clear the memoized env seed. Tests only — lets a single process exercise
 * several seed values without re-spawning.
 */
export function resetRootSeed() {
  envSeed = undefined;
}

/**
 * The `traceparent` representing the currently active span, for injection into
 * an outbound request. Falls back to the env seed so that a process which
 * makes a call before entering any instrumented function still forwards the
 * inbound trace rather than starting a new one.
 *
 * @returns {string|null}
 */
export function currentTraceparent() {
  const ctx = getCurrent() ?? rootSeed();
  if (!ctx) return null;
  return formatTraceparent(ctx.trace_id, ctx.span_id);
}
