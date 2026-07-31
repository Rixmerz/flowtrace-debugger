'use strict';
/**
 * The dashboard's consumers must read the v2 field names the analyzer emits.
 *
 * The analyzer produces avg_ns / total_ns / p95_ns / totalErrors, matching the
 * schema's duration_ns. Every consumer still read the v1 names — avgDuration,
 * totalExceptions, totalTime, p95, exceptionCount, callCount — which the analyzer
 * stopped emitting. The results:
 *
 *   - `dashboard-cli analyze` crashed on any real v2 trace with
 *     "Cannot read properties of undefined (reading 'toFixed')".
 *   - the browser metrics panel rendered every duration from undefined and showed
 *     NaN% as the error rate.
 *   - the errors table — the first place you look when tracing a failure —
 *     printed "undefined" in both number columns.
 *   - mcp-tools.js handed undefined to every MCP consumer.
 *
 * So the capture layers were emitting correct v2 traces that nothing downstream
 * could display. The grep-style assertion at the end is the durable guard: it
 * covers every consumer file at once, which is what a per-field test cannot do.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const DASH_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(DASH_ROOT, '..');
const GOLDEN_NODE = path.join(REPO_ROOT, 'examples', 'golden', 'node', 'calculator.js');
const CLI = path.join(REPO_ROOT, 'flowtrace-cli', 'bin', 'flowtrace.js');

let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    pass += 1;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
    fail += 1;
  }
}

/** Capture a real v2 trace via the CLI, so this tests the actual pipeline. */
function captureTrace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-v2f-'));
  fs.copyFileSync(GOLDEN_NODE, path.join(dir, 'calculator.js'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'p' }));
  const r = spawnSync(process.execPath, [CLI, 'run', '--', 'node', 'calculator.js'], {
    cwd: dir, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, NODE_OPTIONS: '' },
  });
  const traceDir = path.join(dir, '.flowtrace');
  const files = fs.existsSync(traceDir)
    ? fs.readdirSync(traceDir).filter((f) => f.endsWith('.jsonl'))
    : [];
  assert.ok(files.length > 0, `no trace captured:\n${r.stdout}\n${r.stderr}`);
  return { dir, trace: path.join(traceDir, files[0]) };
}

console.log('\ndashboard consumers read v2 field names\n');

const { dir, trace } = captureTrace();

(async () => {
  const FlowTraceAnalyzer = require(path.join(DASH_ROOT, 'analyzer'));
  const results = await new FlowTraceAnalyzer().analyze(trace);
  const perf = results.performance;

  test('the analyzer emits nanosecond field names, not v1 duration names', () => {
    // Pinning the producer side too: if these ever change back, the consumers
    // below would silently read undefined again.
    assert.ok(typeof perf.summary.avg_ns === 'number', 'summary.avg_ns missing');
    assert.ok(typeof perf.summary.total_ns === 'number', 'summary.total_ns missing');
    assert.ok(typeof perf.summary.totalErrors === 'number', 'summary.totalErrors missing');
    assert.ok(!('avgDuration' in perf.summary), 'analyzer re-emitted the v1 avgDuration');
    assert.ok(!('totalExceptions' in perf.summary), 'analyzer re-emitted totalExceptions');
  });

  test('slow methods carry percentile fields in nanoseconds', () => {
    const m = perf.slowMethods[0];
    assert.ok(m, 'no slow methods to inspect');
    for (const key of ['avg_ns', 'p95_ns', 'p99_ns', 'total_ns']) {
      assert.ok(typeof m[key] === 'number', `slowMethods[0].${key} missing`);
    }
  });

  test('error hotspots carry errors / totalCalls / errorRate', () => {
    // The golden fixture throws once on purpose, so this is never empty.
    const h = perf.errorHotspots[0];
    assert.ok(h, 'no error hotspots — the fixture should raise once');
    assert.ok(typeof h.errors === 'number', 'errorHotspots[0].errors missing');
    assert.ok(typeof h.totalCalls === 'number', 'errorHotspots[0].totalCalls missing');
    assert.ok(typeof h.errorRate === 'number', 'errorHotspots[0].errorRate missing');
  });

  test('the dashboard CLI renders a full report without crashing', () => {
    // This is the exact command that died on undefined.toFixed.
    const r = spawnSync(process.execPath, [path.join(DASH_ROOT, 'cli.js'), 'analyze', trace], {
      cwd: DASH_ROOT, encoding: 'utf8', timeout: 60000,
    });
    const out = r.stdout + r.stderr;
    assert.ok(!/toFixed/.test(out), `still crashing on a missing field:\n${out}`);
    assert.ok(!/undefined/.test(out), `rendered "undefined":\n${out}`);
    // And the numbers are really there.
    assert.match(out, /Average Duration:\s*[\d.]+ms/, `no average duration:\n${out}`);
    assert.match(out, /Total Time:\s*[\d.]+ms/, `no total time:\n${out}`);
  });

  test('no consumer file still reads a v1 field name', () => {
    // The durable guard. A per-field test cannot cover files added later; this
    // does, and it is what would have caught the original divergence.
    const V1_NAMES = [
      'avgDuration', 'totalExceptions', 'totalTime',
      'exceptionCount', '.p95', '.p99',
    ];
    const files = [
      'cli.js',
      'mcp-tools.js',
      path.join('public', 'js', 'components', 'metrics-panel.js'),
      path.join('public', 'js', 'components', 'table-renderer.js'),
    ];

    const offenders = [];
    for (const rel of files) {
      const full = path.join(DASH_ROOT, rel);
      if (!fs.existsSync(full)) continue;
      const lines = fs.readFileSync(full, 'utf-8').split('\n');
      lines.forEach((line, i) => {
        // Comments explain the history on purpose; only real reads count.
        const code = line.split('//')[0];
        if (/^\s*\*/.test(line)) return;
        // Strip the v2 field names first: ".p99_ns" contains ".p99", and
        // "avgDurationEl" is a DOM handle rather than a data read.
        const stripped = code
          .replace(/\.\w+_ns\b/g, '')
          .replace(/\b\w+El\b/g, '');
        for (const name of V1_NAMES) {
          if (stripped.includes(name)) {
            offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
          }
        }
      });
    }
    assert.deepStrictEqual(offenders, [], `v1 field names still read:\n${offenders.join('\n')}`);
  });

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  fs.rmSync(dir, { recursive: true, force: true });
  console.error('\n  harness error:', err.message, '\n');
  process.exit(1);
});
