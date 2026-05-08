import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// W3C trace-id: 32 hex chars; span-id: 16 hex chars.
const TRACE_ID_RE = /^[0-9a-f]{32}$/;
const SPAN_ID_RE  = /^[0-9a-f]{16}$/;

let outputPath = null;
/** @type {Promise<void>} Single-lane async write queue. */
let queue = Promise.resolve();
let initialized = false;

function getDefaultOutputPath() {
  if (process.env.FLOWTRACE_OUTPUT) {
    return resolve(process.env.FLOWTRACE_OUTPUT);
  }
  const iso = new Date().toISOString().replace(/[:.]/g, '-');
  return resolve(`.flowtrace/${iso}.jsonl`);
}

async function ensureInit() {
  if (initialized) return;
  initialized = true;
  outputPath = outputPath ?? getDefaultOutputPath();
  await mkdir(dirname(outputPath), { recursive: true });
}

/**
 * Override the output path before the first emit (useful in tests).
 * @param {string} path
 */
export function init(path) {
  outputPath = resolve(path);
  initialized = false; // allow re-init with new path
}

/**
 * Validates and enqueues a trace event line.
 * Invalid events are dropped; a diagnostic is written to stderr.
 *
 * @param {object} event
 */
export function emit(event) {
  queue = queue.then(async () => {
    // Validate required fields.
    const { trace_id, span_id, event: evtType } = event;

    if (!TRACE_ID_RE.test(trace_id)) {
      process.stderr.write(
        `[flowtrace] dropped event: invalid trace_id "${trace_id}"\n`
      );
      return;
    }
    if (!SPAN_ID_RE.test(span_id)) {
      process.stderr.write(
        `[flowtrace] dropped event: invalid span_id "${span_id}"\n`
      );
      return;
    }
    if (evtType !== 'enter' && evtType !== 'exit') {
      process.stderr.write(
        `[flowtrace] dropped event: event must be "enter" or "exit", got "${evtType}"\n`
      );
      return;
    }

    await ensureInit();

    // Serialize, stripping undefined values.
    const line = JSON.stringify(event, (_k, v) => (v === undefined ? undefined : v));
    await appendFile(outputPath, line + '\n', 'utf8');
  });
}

/**
 * Flush — waits for all pending writes to complete.
 * @returns {Promise<void>}
 */
export function flush() {
  return queue;
}

// Flush on process exit.
process.on('beforeExit', () => {
  // beforeExit fires when the event loop drains; awaiting the queue here
  // keeps the loop alive until all writes complete.
  queue.then(() => {});
});
