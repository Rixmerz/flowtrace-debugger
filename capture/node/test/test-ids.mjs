import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newTraceId, newSpanId } from '../src/runtime/ids.js';

test('newTraceId returns 32 lowercase hex chars', () => {
  const id = newTraceId();
  assert.match(id, /^[0-9a-f]{32}$/);
});

test('newSpanId returns 16 lowercase hex chars', () => {
  const id = newSpanId();
  assert.match(id, /^[0-9a-f]{16}$/);
});

test('newTraceId produces 1000 unique values', () => {
  const ids = new Set(Array.from({ length: 1000 }, () => newTraceId()));
  assert.equal(ids.size, 1000);
});

test('newSpanId produces 1000 unique values', () => {
  const ids = new Set(Array.from({ length: 1000 }, () => newSpanId()));
  assert.equal(ids.size, 1000);
});
