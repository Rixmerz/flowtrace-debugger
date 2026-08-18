/**
 * Cross-process fixture: the spawning parent.
 *
 * Opens a root span and shells out to a child. The point is that it does
 * NOTHING special — no env var is set by hand. If the child lands in the same
 * trace, it is because the runtime injected FLOWTRACE_TRACEPARENT on its own.
 *
 * argv[2] is the child command, argv[3..] its arguments.
 */
import { createRequire } from 'node:module';
import { emit, flush, runInSpan, getCurrent } from '../../src/runtime/index.js';
import { installSubprocessPropagation } from '../../src/runtime/subprocess.js';

// bootstrap.mjs does this for a real application. Here it is explicit, and it
// must happen BEFORE child_process is reached — which is also why the module is
// pulled in with createRequire rather than a static import: a static ESM import
// of a builtin snapshots its named exports before the patch lands.
installSubprocessPropagation();
const { spawnSync } = createRequire(import.meta.url)('node:child_process');

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
    module: 'parent',
    class: '',
    method: 'spawnChild',
    visibility: 'public',
    args: {},
    depth: 0,
  });

  const [, , cmd, ...rest] = process.argv;
  const res = spawnSync(cmd, rest, { encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] });
  if (res.status !== 0) {
    console.error(`child exited ${res.status}`);
    process.exitCode = 1;
  }
});

await flush();
