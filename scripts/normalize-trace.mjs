#!/usr/bin/env node
/**
 * Normalize a flowtrace.jsonl into a deterministic, comparable form.
 *
 * Why this exists: a golden fixture for a tracer cannot be a byte-for-byte copy
 * of a run, because trace_id, span_id, ts and duration_ns differ every time. So
 * examples/golden/<lang>/expected.jsonl was never committed at all, and
 * `make validate-schema` validated zero events while reporting success.
 *
 * This rewrites the volatile fields to fixed values while preserving everything
 * that carries meaning — event order, the parent/child topology, depth, method
 * identity, args and results. The output therefore does two jobs at once:
 *
 *   1. It is still schema-valid, so it is a real fixture for validate-golden.mjs.
 *   2. It is stable across runs, so `make golden-verify` can diff a fresh run
 *      against it and catch behavioural regressions — a method that stopped
 *      being instrumented, a changed arg shape, a broken parent chain.
 *
 * Span IDs are renumbered in order of first appearance rather than blanked, so
 * the parent_id -> span_id topology survives normalization. That is the part a
 * regression is most likely to break, and the part a naive "replace all ids
 * with zeros" normalizer would silently destroy.
 *
 * Usage:
 *   node scripts/normalize-trace.mjs <input.jsonl> [> output.jsonl]
 *   cat trace.jsonl | node scripts/normalize-trace.mjs
 */
import { readFileSync } from 'node:fs';

/** Fixed, schema-valid stand-ins. All-zero IDs are invalid per W3C, so these
 *  are recognisable but legal. */
const FIXED_TRACE_ID = 'f'.repeat(31) + '1';
const FIXED_TS = 1700000000.0; // inside the schema's 1e9..1e10 window
const SPAN_PREFIX = '00000000000000'; // + 2 hex digits = 16 chars

/**
 * Numbering starts at 1, not 0: an all-zero span_id is explicitly invalid per
 * the W3C spec and is rejected by FlowTrace's own traceparent parsers, so a
 * fixture must not contain one as an example.
 */
function spanIdFor(ordinal) {
  if (ordinal > 0xff) {
    throw new Error(`normalizer supports up to 255 spans per trace, got ${ordinal}`);
  }
  return SPAN_PREFIX + ordinal.toString(16).padStart(2, '0');
}

/**
 * @param {string} text - raw JSONL
 * @returns {string} normalized JSONL
 */
export function normalize(text) {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);

  // First appearance order of each real span_id -> deterministic replacement.
  const spanMap = new Map();
  const mapSpan = (id) => {
    if (id === null || id === undefined) return id;
    if (!spanMap.has(id)) spanMap.set(id, spanIdFor(spanMap.size + 1));
    return spanMap.get(id);
  };

  const out = [];
  for (const line of lines) {
    const e = JSON.parse(line);

    e.trace_id = FIXED_TRACE_ID;
    // Map span_id BEFORE parent_id: a parent is always seen as a span_id
    // first (its own enter precedes its children), so this keeps numbering in
    // document order and makes the diff readable.
    e.span_id = mapSpan(e.span_id);
    e.parent_id = e.parent_id === null ? null : mapSpan(e.parent_id);

    e.ts = FIXED_TS;
    if ('duration_ns' in e) e.duration_ns = 0;

    // Thread names are runtime-specific (main / MainThread / HTTP-Dispatcher)
    // and can vary between runs of the same program. Fixtures are per-language,
    // so this is normalized rather than compared.
    if ('thread' in e) e.thread = 'thread';

    // Stack frames carry absolute paths and line numbers.
    if (e.error && Array.isArray(e.error.stack)) {
      e.error.stack = ['<normalized>'];
    }

    // Key order must be stable for a textual diff to be meaningful — two runs
    // that differ only in map iteration order are not a regression.
    out.push(JSON.stringify(sortKeysDeep(e)));
  }
  return out.join('\n') + '\n';
}

/** Recursively sort object keys so serialization is order-independent. */
function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value === null || typeof value !== 'object') return value;
  const sorted = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortKeysDeep(value[key]);
  }
  return sorted;
}

// ── CLI ──────────────────────────────────────────────────────────────
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*[/\\]/, ''));
if (isMain) {
  const path = process.argv[2];
  const text = path ? readFileSync(path, 'utf8') : readFileSync(0, 'utf8');
  process.stdout.write(normalize(text));
}
