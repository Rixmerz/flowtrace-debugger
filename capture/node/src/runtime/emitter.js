import { openSync, writeSync, closeSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// W3C trace-id: 32 hex chars; span-id: 16 hex chars.
const TRACE_ID_RE = /^[0-9a-f]{32}$/;
const SPAN_ID_RE  = /^[0-9a-f]{16}$/;

let outputPath = null;
/** @type {number|null} Append-mode file descriptor, opened on first emit. */
let fd = null;

/*
 * Why synchronous writes.
 *
 * This emitter used to queue asynchronous appendFile() calls and settle them on
 * 'beforeExit'. That event does not fire when the traced application calls
 * process.exit(), which is how most CLIs and most servers with a graceful
 * shutdown actually stop — so everything still in flight was silently lost. The
 * tail of a trace is usually the part you are debugging, and it vanished with
 * no error at all.
 *
 * The obvious repair — keep the async queue and add a synchronous 'exit'
 * handler that writes whatever is left — cannot be made exact. Between the OS
 * completing a write and its .then continuation running, the line is on disk
 * but still recorded as pending; process.exit() runs 'exit' handlers without
 * draining microtasks, so that line gets written a second time. Measured
 * against the Express fixture that produced 9 events for 8 calls, with the
 * first line byte-identically duplicated.
 *
 * With an append-mode descriptor and writeSync, a line is either written or it
 * is not, and ordering is guaranteed by the syscall. No queue, no pending set,
 * no exit race. One syscall per event, and none of the promise machinery the
 * async version paid for on every single event.
 */

function getDefaultOutputPath() {
  if (process.env.FLOWTRACE_OUTPUT) {
    return resolve(process.env.FLOWTRACE_OUTPUT);
  }
  const iso = new Date().toISOString().replace(/[:.]/g, '-');
  return resolve(`.flowtrace/${iso}.jsonl`);
}

function ensureOpen() {
  if (fd !== null) return;
  outputPath = outputPath ?? getDefaultOutputPath();
  mkdirSync(dirname(outputPath), { recursive: true });
  fd = openSync(outputPath, 'a');
}

/**
 * Override the output path before the first emit (useful in tests).
 * @param {string} path
 */
export function init(path) {
  closeOutput();
  outputPath = resolve(path);
}

function closeOutput() {
  if (fd === null) return;
  try {
    closeSync(fd);
  } catch { /* already gone */ }
  fd = null;
}

/**
 * Validates and writes a trace event line.
 * Invalid events are dropped; a diagnostic is written to stderr.
 *
 * @param {object} event
 */
export function emit(event) {
  const { trace_id, span_id, event: evtType } = event;

  if (!TRACE_ID_RE.test(trace_id)) {
    process.stderr.write(`[flowtrace] dropped event: invalid trace_id "${trace_id}"\n`);
    return;
  }
  if (!SPAN_ID_RE.test(span_id)) {
    process.stderr.write(`[flowtrace] dropped event: invalid span_id "${span_id}"\n`);
    return;
  }
  if (evtType !== 'enter' && evtType !== 'exit') {
    process.stderr.write(
      `[flowtrace] dropped event: event must be "enter" or "exit", got "${evtType}"\n`
    );
    return;
  }

  // Serialize, stripping undefined values.
  const line = JSON.stringify(event, (_k, v) => (v === undefined ? undefined : v)) + '\n';

  try {
    ensureOpen();
    writeSync(fd, line);
  } catch (e) {
    process.stderr.write(`[flowtrace] failed to write event: ${e.message}\n`);
  }
}

/**
 * Flush. Retained for API compatibility — every event is already durable by the
 * time emit() returns, so there is nothing to wait for.
 * @returns {Promise<void>}
 */
export function flush() {
  return Promise.resolve();
}

// Release the descriptor on the way out. Nothing to flush: writes are already
// complete. Deliberately no 'uncaughtException' / 'unhandledRejection' hooks —
// merely registering a listener for those suppresses Node's default crash
// behaviour, which would change how the traced application itself behaves.
process.on('exit', closeOutput);
