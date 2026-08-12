/**
 * Cross-process fixture: the server half.
 *
 * Adopts the incoming `traceparent` and emits one span for the handler. The
 * body is the pattern a real middleware integrator would write — note it does
 * not branch on whether the header was present.
 *
 * Prints its listening port on stdout so the test can drive it.
 */
import { createServer } from 'node:http';
import {
  emit,
  flush,
  runWithRemoteContext,
  runInSpan,
  getCurrent,
} from '../../src/runtime/index.js';

const server = createServer((req, res) => {
  runWithRemoteContext(req.headers.traceparent, () => {
    // Same shape as the injected __ft_enter helper: capture the parent, open
    // a span, emit. With a header the parent is the remote span; without one
    // there is no parent and this becomes a local root.
    const parent = getCurrent();
    const parentId = parent ? parent.span_id : null;

    runInSpan(() => {
      const ctx = getCurrent();
      emit({
        ts: Date.now() / 1000,
        trace_id: ctx.trace_id,
        span_id: ctx.span_id,
        parent_id: parentId,
        event: 'enter',
        thread: 'main',
        lang: 'node',
        module: 'server',
        class: '',
        method: 'handleRequest',
        visibility: 'public',
        args: {},
        depth: ctx.depth,
      });
      res.end('ok');
    });
  });
});

server.listen(0, () => {
  process.stdout.write(`PORT ${server.address().port}\n`);
});

process.on('SIGTERM', async () => {
  await flush();
  server.close(() => process.exit(0));
});
