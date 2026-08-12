import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getCurrent,
  runInSpan,
  runWithRemoteContext,
  currentTraceparent,
} from '../src/runtime/context.js';

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const SPAN = '00f067aa0ba902b7';
const HEADER = `00-${TRACE}-${SPAN}-01`;

test('adopts the remote trace_id instead of minting a new one', () => {
  runWithRemoteContext(HEADER, () => {
    runInSpan(() => {
      assert.equal(getCurrent().trace_id, TRACE);
    });
  });
});

test('the first local span hangs off the remote span', () => {
  runWithRemoteContext(HEADER, () => {
    const seed = getCurrent();
    // The seed *is* the remote span, so a local child's parent is the caller.
    assert.equal(seed.span_id, SPAN);
    assert.equal(seed.remote, true);
  });
});

test('the first local span lands at depth 0, like an ordinary root', () => {
  runWithRemoteContext(HEADER, () => {
    runInSpan(() => {
      assert.equal(getCurrent().depth, 0);
    });
  });
});

test('nested local spans keep incrementing depth under a remote root', () => {
  runWithRemoteContext(HEADER, () => {
    runInSpan(() => {
      runInSpan(() => {
        const ctx = getCurrent();
        assert.equal(ctx.depth, 1);
        assert.equal(ctx.trace_id, TRACE);
      });
    });
  });
});

test('a malformed header seeds nothing, so the first local span is a root', () => {
  runWithRemoteContext('total garbage', () => {
    // No synthetic parent: this establishes a parent, it does not open a span.
    assert.equal(getCurrent(), null);
    runInSpan(() => {
      const ctx = getCurrent();
      assert.notEqual(ctx.trace_id, TRACE);
      assert.match(ctx.trace_id, /^[0-9a-f]{32}$/);
      assert.equal(ctx.depth, 0);
    });
  });
});

test('an absent header behaves the same as a malformed one', () => {
  for (const missing of [undefined, null, '']) {
    runWithRemoteContext(missing, () => {
      runInSpan(() => {
        assert.match(getCurrent().trace_id, /^[0-9a-f]{32}$/);
        assert.equal(getCurrent().depth, 0);
      });
    });
  }
});

test('the first local span is at depth 0 with or without a header', () => {
  // The symmetry an integrator depends on: no branching on header presence.
  const depths = [];
  for (const header of [HEADER, undefined]) {
    runWithRemoteContext(header, () => {
      runInSpan(() => depths.push(getCurrent().depth));
    });
  }
  assert.deepEqual(depths, [0, 0]);
});

test('fn still runs when the header is bad — a bad caller cannot break us', () => {
  let ran = false;
  runWithRemoteContext('00-nope', () => { ran = true; });
  assert.equal(ran, true);
});

test('returns whatever fn returns', () => {
  assert.equal(runWithRemoteContext(HEADER, () => 'value'), 'value');
});

test('propagates the adopted trace across an async boundary', async () => {
  await runWithRemoteContext(HEADER, async () => {
    await new Promise((r) => setTimeout(r, 1));
    return runInSpan(async () => {
      await new Promise((r) => setTimeout(r, 1));
      assert.equal(getCurrent().trace_id, TRACE);
    });
  });
});

test('two concurrent remote traces do not bleed into each other', async () => {
  const otherTrace = 'a'.repeat(32);
  const otherHeader = `00-${otherTrace}-${'b'.repeat(16)}-01`;

  const [a, b] = await Promise.all([
    runWithRemoteContext(HEADER, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return getCurrent().trace_id;
    }),
    runWithRemoteContext(otherHeader, async () => {
      await new Promise((r) => setTimeout(r, 1));
      return getCurrent().trace_id;
    }),
  ]);

  assert.equal(a, TRACE);
  assert.equal(b, otherTrace);
});

test('currentTraceparent renders the active span for an outgoing call', () => {
  runInSpan(() => {
    const ctx = getCurrent();
    assert.equal(currentTraceparent(), `00-${ctx.trace_id}-${ctx.span_id}-01`);
  });
});

test('currentTraceparent carries the adopted trace onward to a third process', () => {
  runWithRemoteContext(HEADER, () => {
    runInSpan(() => {
      // browser -> node -> next hop: the trace_id must survive both legs.
      assert.match(currentTraceparent(), new RegExp(`^00-${TRACE}-[0-9a-f]{16}-01$`));
    });
  });
});

test('currentTraceparent is null outside any span', () => {
  assert.equal(currentTraceparent(), null);
});
