import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTraceparent, formatTraceparent } from '../src/runtime/traceparent.js';

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const SPAN = '00f067aa0ba902b7';
const VALID = `00-${TRACE}-${SPAN}-01`;

test('parses the canonical W3C example', () => {
  assert.deepEqual(parseTraceparent(VALID), {
    trace_id: TRACE,
    parent_id: SPAN,
    flags: 1,
    sampled: true,
  });
});

test('reports sampled=false when the flag bit is clear', () => {
  const r = parseTraceparent(`00-${TRACE}-${SPAN}-00`);
  assert.equal(r.sampled, false);
  assert.equal(r.flags, 0);
});

test('reads sampled from bit 0 only, ignoring other flag bits', () => {
  // 0xfe has every bit but bit 0 set.
  assert.equal(parseTraceparent(`00-${TRACE}-${SPAN}-fe`).sampled, false);
  assert.equal(parseTraceparent(`00-${TRACE}-${SPAN}-ff`).sampled, true);
});

test('rejects an all-zero trace id', () => {
  assert.equal(parseTraceparent(`00-${'0'.repeat(32)}-${SPAN}-01`), null);
});

test('rejects an all-zero parent id', () => {
  assert.equal(parseTraceparent(`00-${TRACE}-${'0'.repeat(16)}-01`), null);
});

test('rejects version ff', () => {
  assert.equal(parseTraceparent(`ff-${TRACE}-${SPAN}-01`), null);
});

test('rejects uppercase hex rather than normalizing it', () => {
  // Accepting this would let us emit a trace_id that fails our own schema.
  assert.equal(parseTraceparent(`00-${TRACE.toUpperCase()}-${SPAN}-01`), null);
  assert.equal(parseTraceparent(`00-${TRACE}-${SPAN.toUpperCase()}-01`), null);
});

test('rejects wrong-length ids', () => {
  assert.equal(parseTraceparent(`00-${TRACE.slice(0, 31)}-${SPAN}-01`), null);
  assert.equal(parseTraceparent(`00-${TRACE}-${SPAN.slice(0, 15)}-01`), null);
  assert.equal(parseTraceparent(`00-${TRACE}a-${SPAN}-01`), null);
});

test('rejects non-hex characters', () => {
  assert.equal(parseTraceparent(`00-${'g'.repeat(32)}-${SPAN}-01`), null);
  assert.equal(parseTraceparent(`0z-${TRACE}-${SPAN}-01`), null);
});

test('rejects trailing fields on version 00', () => {
  // Version 00 is exactly four fields; extra data means a malformed header.
  assert.equal(parseTraceparent(`${VALID}-extra`), null);
});

test('accepts trailing fields on a future version, per the spec', () => {
  const r = parseTraceparent(`01-${TRACE}-${SPAN}-01-future-stuff`);
  assert.equal(r.trace_id, TRACE);
  assert.equal(r.parent_id, SPAN);
});

test('rejects too few fields', () => {
  assert.equal(parseTraceparent(`00-${TRACE}-${SPAN}`), null);
  assert.equal(parseTraceparent('00'), null);
  assert.equal(parseTraceparent(''), null);
});

test('rejects non-string input instead of throwing', () => {
  // A caller we do not control must not be able to crash the traced app.
  for (const bad of [undefined, null, 42, {}, true]) {
    assert.equal(parseTraceparent(bad), null);
  }
});

test('rejects a repeated header (array), which the spec calls malformed', () => {
  assert.equal(parseTraceparent([VALID, VALID]), null);
  assert.equal(parseTraceparent([VALID]), null);
});

test('formats a context into a header', () => {
  assert.equal(formatTraceparent({ trace_id: TRACE, span_id: SPAN }), VALID);
});

test('format rejects invalid or absent ids', () => {
  assert.equal(formatTraceparent(null), null);
  assert.equal(formatTraceparent({}), null);
  assert.equal(formatTraceparent({ trace_id: TRACE, span_id: '0'.repeat(16) }), null);
  assert.equal(formatTraceparent({ trace_id: 'nope', span_id: SPAN }), null);
});

test('format then parse round-trips', () => {
  const header = formatTraceparent({ trace_id: TRACE, span_id: SPAN });
  const parsed = parseTraceparent(header);
  assert.equal(parsed.trace_id, TRACE);
  assert.equal(parsed.parent_id, SPAN);
});
