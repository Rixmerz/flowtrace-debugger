/**
 * Cross-process fixture: the spawned child.
 *
 * Emits one root span. Its trace_id and parent_id come from whatever the
 * runtime seeded out of the environment — the child sets nothing itself.
 */
import { emit, flush, runInSpan, getCurrent, seedFromEnvironment } from '../../src/runtime/index.js';

seedFromEnvironment();

// Same shape as the injected __ft_enter helper: capture the parent before
// opening the span. With a seed the parent is the spawning process's span;
// without one there is no parent and this is a local root.
const seeded = getCurrent();
const parentId = seeded ? seeded.span_id : null;

await runInSpan(async () => {
  const ctx = getCurrent();
  emit({
    ts: Date.now() / 1000,
    trace_id: ctx.trace_id,
    span_id: ctx.span_id,
    parent_id: parentId,
    event: 'enter',
    thread: 'main',
    lang: 'node',
    module: 'child',
    class: '',
    method: 'work',
    visibility: 'public',
    args: {},
    depth: ctx.depth,
  });
});

await flush();
