/**
 * Canonicalize a FlowTrace v2 trace so it can be committed as a golden fixture
 * and diffed byte-for-byte across runs and machines.
 *
 * Four fields are genuinely non-deterministic and are explicitly out of scope
 * of the golden comparison (every fixture README says "modulo ts, span_id,
 * duration_ns"):
 *
 *   - trace_id / span_id / parent_id — random per run. Span ids are renumbered
 *     in order of first appearance, and parent_id is mapped through the same
 *     table, so the *shape* of the call tree is still fully asserted.
 *   - ts          — wall clock. Replaced by a fixed base plus the event index,
 *     which keeps ordering observable and stays inside the schema's epoch range.
 *   - duration_ns — timing. Replaced by a constant.
 *   - thread, but ONLY when it matches Go's `goroutine-<id>` shape — the id
 *     is a runtime-internal number (explicitly outside Go's compatibility
 *     promise, see docs/changes/2026-08-27-go-capture-layer.md's D3) that
 *     measurably varies run to run depending on what else the runtime has
 *     already spawned (GC workers, sysmon), not on anything the fixture
 *     controls. It is renumbered in order of first appearance the same way
 *     span_id is, so a spawned goroutine getting a *different* thread than
 *     its parent — the actual contract — still fully asserts. Every other
 *     language's `thread` value (a JVM thread name, "main", a Python thread
 *     id) is deterministic already and stays verbatim.
 *
 * Everything else (event, lang, module, class, method, visibility, args,
 * result, error, depth) is preserved verbatim: that is the contract the
 * capture layers must satisfy.
 */

/** Fixed trace_id for every normalized fixture. Matches ^[0-9a-f]{32}$. */
export const CANONICAL_TRACE_ID = 'f10c17ace000000000000000000000a1';

/** Epoch seconds base — inside the schema's [1e9, 1e10] window. */
const TS_BASE = 1700000000;

/** Constant substituted for every measured duration. */
const CANONICAL_DURATION_NS = 1000;

/** Key order used when re-serializing, so fixtures stay diff-stable. */
const KEY_ORDER = [
  'ts', 'trace_id', 'span_id', 'parent_id', 'event', 'thread', 'lang',
  'module', 'class', 'method', 'visibility', 'args', 'result', 'error',
  'duration_ns', 'depth',
];

function spanIdFor(index) {
  return index.toString(16).padStart(16, '0');
}

/** Matches Go's `thread` shape only — see the header comment above. */
const GOROUTINE_THREAD = /^goroutine-\d+$/;

/**
 * Java's default Object.toString() renders as `com.foo.Bar@1b6d3586`, where the
 * suffix is an identity hash that changes on every JVM run. Left alone it makes
 * the Java fixtures diff-unstable for reasons that have nothing to do with the
 * trace contract.
 */
const IDENTITY_HASH = /@[0-9a-f]{4,}\b/g;

function scrubIdentityHashes(value) {
  if (typeof value === 'string') return value.replace(IDENTITY_HASH, '@<identity>');
  if (Array.isArray(value)) return value.map(scrubIdentityHashes);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, scrubIdentityHashes(v)])
    );
  }
  return value;
}

/**
 * Canonicalizes an error object for the golden diff.
 *
 * `type` and `msg` are preserved verbatim — the fixture chooses the exception,
 * so both are deterministic and are exactly what these fixtures exist to
 * assert. `stack` is not: frames carry absolute paths, line numbers and
 * runtime-internal entries that differ per machine and per Python/Node/JDK
 * version. Committing them would produce a fixture that fails for reasons
 * having nothing to do with the trace contract.
 *
 * The array is collapsed rather than deleted, so the empty/non-empty
 * distinction survives: an agent that stopped capturing stacks altogether
 * still breaks the diff.
 */
function normalizeError(error) {
  if (error === null || typeof error !== 'object') return error;
  const out = scrubIdentityHashes({ ...error });
  if (Array.isArray(out.stack)) {
    out.stack = out.stack.length > 0 ? ['<scrubbed>'] : [];
  }
  return out;
}

/**
 * @param {object[]} events - Parsed JSONL events, in emission order.
 * @returns {object[]} Normalized events.
 */
export function normalizeEvents(events) {
  const spanMap = new Map();
  let nextSpan = 1;

  const mapSpan = (id) => {
    if (id === null || id === undefined) return null;
    if (!spanMap.has(id)) {
      spanMap.set(id, spanIdFor(nextSpan));
      nextSpan += 1;
    }
    return spanMap.get(id);
  };

  const threadMap = new Map();
  const mapThread = (value) => {
    if (typeof value !== 'string' || !GOROUTINE_THREAD.test(value)) return value;
    if (!threadMap.has(value)) {
      threadMap.set(value, `goroutine-${threadMap.size + 1}`);
    }
    return threadMap.get(value);
  };

  return events.map((ev, i) => {
    const out = { ...ev };

    out.trace_id = CANONICAL_TRACE_ID;
    out.span_id = mapSpan(ev.span_id);
    out.parent_id = mapSpan(ev.parent_id);
    out.ts = TS_BASE + i / 1000;
    if ('thread' in out) out.thread = mapThread(out.thread);
    if ('duration_ns' in out) out.duration_ns = CANONICAL_DURATION_NS;
    if ('args' in out) out.args = scrubIdentityHashes(out.args);
    if ('result' in out) out.result = scrubIdentityHashes(out.result);
    if ('error' in out) out.error = normalizeError(out.error);

    // Re-key in canonical order; drop nothing, but append any unexpected key
    // at the end rather than silently losing it.
    const ordered = {};
    for (const k of KEY_ORDER) if (k in out) ordered[k] = out[k];
    for (const k of Object.keys(out)) if (!(k in ordered)) ordered[k] = out[k];
    return ordered;
  });
}

/**
 * Parse raw JSONL text into events, ignoring blank lines.
 * @param {string} raw
 * @returns {object[]}
 */
export function parseJsonl(raw) {
  return raw
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l, i) => {
      try {
        return JSON.parse(l);
      } catch (e) {
        throw new Error(`invalid JSON on line ${i + 1}: ${e.message}`);
      }
    });
}

/**
 * Serialize events back to JSONL (trailing newline, one object per line).
 * @param {object[]} events
 * @returns {string}
 */
export function toJsonl(events) {
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

/**
 * Normalize raw capture output in one step.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeJsonl(raw) {
  return toJsonl(normalizeEvents(parseJsonl(raw)));
}
