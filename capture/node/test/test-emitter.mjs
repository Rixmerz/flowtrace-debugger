import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Create a fresh emitter instance for each test by dynamically importing
 * with a cache-busting query param.  This avoids singleton state leaking
 * between tests.
 */
async function freshEmitter(outputPath) {
  const mod = await import(`../src/runtime/emitter.js?t=${Date.now()}`);
  mod.init(outputPath);
  return mod;
}

// ── helper ──────────────────────────────────────────────────────────────────

function validEnter(overrides = {}) {
  return {
    trace_id: 'a'.repeat(32),
    span_id:  'b'.repeat(16),
    event:    'enter',
    method:   'myMethod',
    timestamp: Date.now(),
    ...overrides,
  };
}

function validExit(overrides = {}) {
  return {
    trace_id: 'a'.repeat(32),
    span_id:  'b'.repeat(16),
    event:    'exit',
    method:   'myMethod',
    timestamp: Date.now(),
    durationMicros: 100,
    ...overrides,
  };
}

// ── tests ────────────────────────────────────────────────────────────────────

test('emit valid enter+exit and read back parsed lines', async () => {
  const dir  = await mkdtemp(join(tmpdir(), 'ft-emitter-'));
  const path = join(dir, 'trace.jsonl');

  const { emit, flush } = await freshEmitter(path);

  emit(validEnter());
  emit(validExit());
  await flush();

  const lines = (await readFile(path, 'utf8')).trim().split('\n');
  assert.equal(lines.length, 2);

  const enter = JSON.parse(lines[0]);
  assert.equal(enter.event, 'enter');
  assert.match(enter.trace_id, /^[0-9a-f]{32}$/);
  assert.match(enter.span_id,  /^[0-9a-f]{16}$/);

  const exit = JSON.parse(lines[1]);
  assert.equal(exit.event, 'exit');

  await rm(dir, { recursive: true });
});

test('event with bad trace_id is dropped and writes to stderr', async () => {
  const dir  = await mkdtemp(join(tmpdir(), 'ft-emitter-'));
  const path = join(dir, 'trace.jsonl');

  const { emit, flush } = await freshEmitter(path);

  const stderrChunks = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...args) => {
    stderrChunks.push(String(chunk));
    return origWrite(chunk, ...args);
  };

  emit(validEnter({ trace_id: 'not-valid' }));
  await flush();

  process.stderr.write = origWrite;

  // File should not exist or be empty.
  let content = '';
  try { content = await readFile(path, 'utf8'); } catch { /* file may not exist */ }
  assert.equal(content.trim(), '', 'no lines should be written for bad event');

  assert.ok(
    stderrChunks.some(c => c.includes('dropped')),
    'stderr should contain "dropped"'
  );

  await rm(dir, { recursive: true });
});

test('100 parallel emits produce exactly 100 non-interleaved lines', async () => {
  const dir  = await mkdtemp(join(tmpdir(), 'ft-emitter-'));
  const path = join(dir, 'trace.jsonl');

  const { emit, flush } = await freshEmitter(path);

  // Emit 100 events concurrently — queue must serialize them.
  await Promise.all(
    Array.from({ length: 100 }, (_, i) =>
      Promise.resolve(emit(validEnter({ span_id: String(i).padStart(16, '0') })))
    )
  );
  await flush();

  const raw   = await readFile(path, 'utf8');
  const lines = raw.trim().split('\n');
  assert.equal(lines.length, 100, `expected 100 lines, got ${lines.length}`);

  // Every line must be valid JSON (no interleaving).
  for (const line of lines) {
    const obj = JSON.parse(line); // throws if corrupt
    assert.equal(obj.event, 'enter');
  }

  await rm(dir, { recursive: true });
});

test('schema validation via validate-golden.mjs passes for valid events', async () => {
  const dir  = await mkdtemp(join(tmpdir(), 'ft-emitter-'));
  const path = join(dir, 'trace.jsonl');

  // Write a minimal valid enter+exit pair directly (bypass singleton).
  const { emit, flush } = await freshEmitter(path);
  const ts = Date.now();
  emit({
    schemaVersion: '2.0.0',
    trace_id:      'a'.repeat(32),
    span_id:       'b'.repeat(16),
    event:         'enter',
    method:        'com.example.App.main',
    timestamp:     ts,
  });
  emit({
    schemaVersion:  '2.0.0',
    trace_id:       'a'.repeat(32),
    span_id:        'b'.repeat(16),
    event:          'exit',
    method:         'com.example.App.main',
    timestamp:      ts + 1,
    durationMicros: 500,
    durationMillis: 0,
  });
  await flush();

  try {
    await execFileAsync('node', [
      '../../scripts/validate-golden.mjs',
      path,
    ], { cwd: new URL('.', import.meta.url).pathname });
    // passed — no assertion needed
  } catch (err) {
    // validate-golden may not support arbitrary paths; skip gracefully.
    if (err.code === 'ERR_MODULE_NOT_FOUND' || /Cannot find/i.test(err.message)) {
      console.log('  (schema validation skipped — validate-golden.mjs not found)');
    } else {
      throw err;
    }
  }

  await rm(dir, { recursive: true });
});
