/**
 * W3C trace-context propagation unit tests.
 *
 * Covers parse/format round-tripping, the spec's invalidity rules, and the
 * synthetic-parent depth contract that keeps seeded root spans at depth 0.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TRACEPARENT,
  TRACEPARENT_ENV,
  parseTraceparent,
  formatTraceparent,
  syntheticParentFrom,
  rootSeed,
  resetRootSeed,
  currentTraceparent,
  SYNTHETIC_PARENT_DEPTH,
} from '../src/runtime/propagation.js';
import { runInSpan, getCurrent } from '../src/runtime/context.js';

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const SPAN = '00f067aa0ba902b7';
const VALID = `00-${TRACE}-${SPAN}-01`;

test('carrier names are the lowercase spec values', () => {
  assert.equal(TRACEPARENT, 'traceparent');
  assert.equal(TRACEPARENT_ENV, 'FLOWTRACE_TRACEPARENT');
});

test('parseTraceparent accepts the canonical W3C example', () => {
  assert.deepEqual(parseTraceparent(VALID), {
    trace_id: TRACE,
    span_id: SPAN,
    sampled: true,
  });
});

test('parseTraceparent reads the sampled flag', () => {
  assert.equal(parseTraceparent(`00-${TRACE}-${SPAN}-01`).sampled, true);
  assert.equal(parseTraceparent(`00-${TRACE}-${SPAN}-00`).sampled, false);
  // Only bit 0 is "sampled"; other bits must not be misread as unsampled.
  assert.equal(parseTraceparent(`00-${TRACE}-${SPAN}-03`).sampled, true);
  assert.equal(parseTraceparent(`00-${TRACE}-${SPAN}-02`).sampled, false);
});

test('parseTraceparent normalizes case and surrounding whitespace', () => {
  const parsed = parseTraceparent(`  00-${TRACE.toUpperCase()}-${SPAN.toUpperCase()}-01  `);
  assert.equal(parsed.trace_id, TRACE);
  assert.equal(parsed.span_id, SPAN);
});

test('parseTraceparent rejects malformed input without throwing', () => {
  const bad = [
    undefined, null, '', 'garbage', 42, {},
    `00-${TRACE}-${SPAN}`,            // missing flags
    `00-${TRACE}`,                    // missing span
    `00-${TRACE}-${SPAN}-01-extra`,   // v00 must have exactly 4 fields
    `zz-${TRACE}-${SPAN}-01`,         // non-hex version
    `ff-${TRACE}-${SPAN}-01`,         // version ff is forbidden
    `00-${TRACE.slice(0, 31)}-${SPAN}-01`,  // short trace_id
    `00-${TRACE}-${SPAN.slice(0, 15)}-01`,  // short span_id
    `00-${'g'.repeat(32)}-${SPAN}-01`,      // non-hex trace_id
    `00-${TRACE}-${SPAN}-zz`,               // non-hex flags
    `00-${'0'.repeat(32)}-${SPAN}-01`,      // all-zero trace_id is invalid
    `00-${TRACE}-${'0'.repeat(16)}-01`,     // all-zero span_id is invalid
  ];
  for (const value of bad) {
    assert.equal(parseTraceparent(value), null, `should reject: ${JSON.stringify(value)}`);
  }
});

test('parseTraceparent tolerates unknown future versions', () => {
  // The spec requires forward compatibility: read the first four fields.
  const parsed = parseTraceparent(`01-${TRACE}-${SPAN}-01-somethingnew`);
  assert.equal(parsed.trace_id, TRACE);
  assert.equal(parsed.span_id, SPAN);
});

test('formatTraceparent round-trips through parseTraceparent', () => {
  const formatted = formatTraceparent(TRACE, SPAN);
  assert.equal(formatted, VALID);
  const parsed = parseTraceparent(formatted);
  assert.equal(parsed.trace_id, TRACE);
  assert.equal(parsed.span_id, SPAN);
});

test('formatTraceparent encodes the sampled flag and rejects invalid IDs', () => {
  assert.equal(formatTraceparent(TRACE, SPAN, false), `00-${TRACE}-${SPAN}-00`);
  assert.equal(formatTraceparent('short', SPAN), null);
  assert.equal(formatTraceparent(TRACE, 'short'), null);
  assert.equal(formatTraceparent('0'.repeat(32), SPAN), null);
  assert.equal(formatTraceparent(TRACE, '0'.repeat(16)), null);
});

test('syntheticParentFrom yields depth -1 so the first local span lands at 0', () => {
  const parent = syntheticParentFrom(VALID);
  assert.equal(parent.trace_id, TRACE);
  assert.equal(parent.span_id, SPAN);
  assert.equal(parent.depth, SYNTHETIC_PARENT_DEPTH);
  assert.equal(SYNTHETIC_PARENT_DEPTH, -1);
  // This is the arithmetic __ft_enter performs; it must produce a
  // schema-valid depth (>= 0) for the seeded root span.
  assert.equal(parent.depth + 1, 0);
});

test('syntheticParentFrom returns null on invalid input', () => {
  assert.equal(syntheticParentFrom('garbage'), null);
  assert.equal(syntheticParentFrom(undefined), null);
});

test('rootSeed reads FLOWTRACE_TRACEPARENT and memoizes the result', () => {
  const previous = process.env[TRACEPARENT_ENV];
  try {
    process.env[TRACEPARENT_ENV] = VALID;
    resetRootSeed();
    const seed = rootSeed();
    assert.equal(seed.trace_id, TRACE);
    assert.equal(seed.span_id, SPAN);
    assert.equal(seed.depth, -1);

    // Memoized: changing env without a reset must not change the answer,
    // because __ft_enter calls this on the hot path.
    process.env[TRACEPARENT_ENV] = `00-${'a'.repeat(32)}-${SPAN}-01`;
    assert.equal(rootSeed().trace_id, TRACE);

    resetRootSeed();
    assert.equal(rootSeed().trace_id, 'a'.repeat(32));
  } finally {
    if (previous === undefined) delete process.env[TRACEPARENT_ENV];
    else process.env[TRACEPARENT_ENV] = previous;
    resetRootSeed();
  }
});

test('rootSeed is null when the env carrier is absent or invalid', () => {
  const previous = process.env[TRACEPARENT_ENV];
  try {
    delete process.env[TRACEPARENT_ENV];
    resetRootSeed();
    assert.equal(rootSeed(), null);

    process.env[TRACEPARENT_ENV] = 'not-a-traceparent';
    resetRootSeed();
    assert.equal(rootSeed(), null);
  } finally {
    if (previous === undefined) delete process.env[TRACEPARENT_ENV];
    else process.env[TRACEPARENT_ENV] = previous;
    resetRootSeed();
  }
});

test('currentTraceparent reflects the active span', () => {
  const previous = process.env[TRACEPARENT_ENV];
  try {
    delete process.env[TRACEPARENT_ENV];
    resetRootSeed();

    // No context, no seed → nothing to inject.
    assert.equal(currentTraceparent(), null);

    runInSpan(() => {
      const ctx = getCurrent();
      assert.equal(currentTraceparent(), formatTraceparent(ctx.trace_id, ctx.span_id));
    });
  } finally {
    if (previous === undefined) delete process.env[TRACEPARENT_ENV];
    else process.env[TRACEPARENT_ENV] = previous;
    resetRootSeed();
  }
});

test('currentTraceparent falls back to the env seed outside any span', () => {
  const previous = process.env[TRACEPARENT_ENV];
  try {
    process.env[TRACEPARENT_ENV] = VALID;
    resetRootSeed();
    // A process that makes an outbound call before entering any instrumented
    // function must still forward the inbound trace rather than drop it.
    assert.equal(currentTraceparent(), VALID);
  } finally {
    if (previous === undefined) delete process.env[TRACEPARENT_ENV];
    else process.env[TRACEPARENT_ENV] = previous;
    resetRootSeed();
  }
});
