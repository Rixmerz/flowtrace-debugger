/**
 * The analyzer's arithmetic on synthetic traces: error counting, self time,
 * percentiles, the tree cap and dangling parents.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const JSONLParser = require('../analyzer/parsers/jsonl-parser');
const PerformanceAnalyzer = require('../analyzer/metrics/performance');
const { percentile, MAX_TREE_NODES } = PerformanceAnalyzer;

const T = 'a'.repeat(32);
let seq = 0;
function span() { return (++seq).toString(16).padStart(16, '0'); }

function pair({ method, parent = null, duration, ts = 1, error = null, cls = '', depth = 0, trace = T }) {
  const id = span();
  const base = { trace_id: trace, span_id: id, parent_id: parent, thread: 'main', lang: 'node',
    module: 'm', class: cls, method, visibility: 'public', args: {}, depth };
  const exit = { ...base, ts: ts + 1, event: 'exit', result: {}, duration_ns: duration };
  if (error) exit.error = error;
  return { id, events: [{ ...base, ts, event: 'enter' }, exit] };
}

(async () => {
  let pass = 0;
  const check = (name, fn) => { try { fn(); console.log(`  ok   ${name}`); pass++; } catch (e) { console.error(`  FAIL ${name}\n${e.stack}`); process.exitCode = 1; } };

  // -- error counting from a file --------------------------------------------
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-perf-'));
    const file = path.join(dir, 't.jsonl');
    const ok = pair({ method: 'fine', duration: 10 });
    const bad = pair({ method: 'boom', duration: 10, error: { type: 'E', msg: 'x', stack: [] } });
    fs.writeFileSync(file, [...ok.events, ...bad.events, { event: 'error', trace_id: T, span_id: span(), ts: 1 }]
      .map((e) => JSON.stringify(e)).join('\n') + '\nnot json\n');
    const { events, stats } = await new JSONLParser().parseWithStats(file);
    check('errorEvents counts exits carrying error; event:"error" rows are not events', () => {
      assert.equal(stats.errorEvents, 1);
      assert.equal(stats.totalEvents, 4);
      assert.equal(stats.malformedLines, 2);
      assert.equal(events.length, 4);
    });
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // -- self time --------------------------------------------------------------
  {
    const parent = pair({ method: 'handler', duration: 10e6 });
    const child = pair({ method: 'query', parent: parent.id, duration: 6e6, depth: 1 });
    const grandchild = pair({ method: 'parse', parent: child.id, duration: 1e6, depth: 2 });
    const a = new PerformanceAnalyzer([...parent.events, ...child.events, ...grandchild.events]);
    const rows = Object.fromEntries(a.findBottlenecks().map((r) => [r.method, r]));
    check('self time subtracts direct children only', () => {
      assert.equal(rows.handler.totalTime, 10);
      assert.equal(rows.handler.selfTime, 4);
      assert.equal(rows.query.selfTime, 5);
      assert.equal(rows.parse.selfTime, 1);
    });
    check('bottlenecks rank by self time, so the leaf beats the handler', () => {
      const order = a.findBottlenecks().map((r) => r.method);
      assert.deepEqual(order, ['query', 'handler', 'parse']);
    });
    check('summary self time equals wall time of the tree, inclusive time exceeds it', () => {
      const s = a.getSummary();
      assert.equal(s.selfTime, 10);
      assert.equal(s.totalTime, 17);
    });
  }

  // -- async overlap ----------------------------------------------------------
  {
    const mw = pair({ method: 'middleware', duration: 2e6 });
    const work = pair({ method: 'handler', parent: mw.id, duration: 300e6, depth: 1 });
    const a = new PerformanceAnalyzer([...mw.events, ...work.events]);
    check('a child that outlives its parent yields self time 0 and an overlap flag, never a negative', () => {
      const row = a.findBottlenecks().find((r) => r.method === 'middleware');
      assert.equal(row.selfTime, 0);
      assert.equal(row.asyncOverlap, true);
      const tree = a.buildCallTrees()[0];
      assert.equal(tree.roots[0].asyncOverlap, true);
    });
  }

  // -- percentiles ------------------------------------------------------------
  check('percentiles are nearest-rank and clamped', () => {
    assert.equal(percentile([5], 0.99), 5);
    assert.equal(percentile([1, 2], 0.99), 2);
    assert.equal(percentile([1, 2], 0.5), 1);
    assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95), 10);
    assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9);
    assert.equal(percentile([], 0.5), 0);
  });
  {
    const one = pair({ method: 'once', duration: 7e6 });
    const a = new PerformanceAnalyzer(one.events);
    check('a single call reports its own duration as p99, not 0', () => {
      assert.equal(a.findSlowMethods()[0].p99, 7);
    });
  }

  // -- tree cap ---------------------------------------------------------------
  {
    const events = [];
    for (let i = 0; i < MAX_TREE_NODES + 100; i++) events.push(...pair({ method: `f${i}`, duration: 1 }).events);
    const trees = new PerformanceAnalyzer(events).buildCallTrees();
    check('call trees are capped and say so', () => {
      assert.equal(trees.truncated, true);
      assert.equal(trees.elidedCount, 100);
      assert.equal(trees[0].roots.length, MAX_TREE_NODES);
    });
  }

  // -- error, visibility, dangling parents ------------------------------------
  {
    const orphan = pair({ method: 'orphan', parent: 'f'.repeat(16), duration: 1, error: { type: 'E', msg: 'm', stack: ['s'] } });
    const root = pair({ method: 'root', duration: 1 });
    const trees = new PerformanceAnalyzer([...orphan.events, ...root.events]).buildCallTrees();
    check('a span whose parent is not in the file is flagged, not silently a root', () => {
      const t = trees[0];
      assert.equal(t.danglingParents, 1);
      const o = t.roots.find((n) => n.method === 'orphan');
      assert.equal(o.danglingParent, true);
      assert.equal(t.roots.find((n) => n.method === 'root').danglingParent, false);
    });
    check('tree nodes carry visibility and the error', () => {
      const o = trees[0].roots.find((n) => n.method === 'orphan');
      assert.equal(o.visibility, 'public');
      assert.deepEqual(o.error, { type: 'E', msg: 'm' });
    });
  }

  // -- NaN durations ----------------------------------------------------------
  {
    const bad = pair({ method: 'nan', duration: 'oops' });
    const a = new PerformanceAnalyzer(bad.events);
    check('a non-numeric duration does not throw', () => {
      assert.doesNotThrow(() => a.analyze());
    });
  }

  console.log(`\n${pass} passed${process.exitCode ? ', some failed' : ''}`);
})();
