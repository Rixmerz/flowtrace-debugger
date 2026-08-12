/**
 * Cross-process fixture: the client half.
 *
 * Opens a root span, emits it, and propagates that span downstream via the
 * `traceparent` header. Takes the target port as argv[2].
 */
import {
  emit,
  flush,
  runInSpan,
  getCurrent,
  currentTraceparent,
} from '../../src/runtime/index.js';

const port = process.argv[2];

await runInSpan(async () => {
  const ctx = getCurrent();
  emit({
    ts: Date.now() / 1000,
    trace_id: ctx.trace_id,
    span_id: ctx.span_id,
    parent_id: null,
    event: 'enter',
    thread: 'main',
    lang: 'node',
    module: 'client',
    class: '',
    method: 'callServer',
    visibility: 'public',
    args: {},
    depth: 0,
  });

  await fetch(`http://127.0.0.1:${port}/`, {
    headers: { traceparent: currentTraceparent() },
  });
});

await flush();
