import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCurrent, runInSpan } from '../src/runtime/context.js';

test('getCurrent returns null outside any span', () => {
  assert.equal(getCurrent(), null);
});

test('runInSpan provides context inside fn', () => {
  runInSpan(() => {
    const ctx = getCurrent();
    assert.ok(ctx, 'context should be set');
    assert.match(ctx.trace_id, /^[0-9a-f]{32}$/);
    assert.match(ctx.span_id, /^[0-9a-f]{16}$/);
    assert.equal(ctx.depth, 0);
  });
});

test('nested runInSpan increments depth and inherits trace_id', () => {
  runInSpan(() => {
    const outer = getCurrent();
    runInSpan(() => {
      const inner = getCurrent();
      assert.equal(inner.trace_id, outer.trace_id, 'trace_id must be inherited');
      assert.notEqual(inner.span_id, outer.span_id, 'span_id must differ');
      assert.equal(inner.depth, 1);
    });
  });
});

test('AsyncLocalStorage propagates across await Promise.all boundaries', async () => {
  await runInSpan(async () => {
    const root = getCurrent();

    const results = await Promise.all([
      runInSpan(async () => {
        await Promise.resolve(); // yield
        return getCurrent();
      }),
      runInSpan(async () => {
        await Promise.resolve();
        return getCurrent();
      }),
    ]);

    // Each child has its own span_id but shares the root trace_id.
    for (const child of results) {
      assert.equal(child.trace_id, root.trace_id);
      assert.notEqual(child.span_id, root.span_id);
      assert.equal(child.depth, 1);
    }

    // The two children have different span_ids.
    assert.notEqual(results[0].span_id, results[1].span_id);
  });
});

test('context is restored after runInSpan completes', () => {
  assert.equal(getCurrent(), null); // baseline

  runInSpan(() => {
    assert.ok(getCurrent());
  });

  assert.equal(getCurrent(), null); // restored
});
