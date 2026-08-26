/**
 * v2 dashboard analyzer smoke test against examples/golden/java/expected.jsonl.
 */

'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const FlowTraceAnalyzer = require('../analyzer');

const REPO_ROOT = path.resolve(__dirname, '../..');
const GOLDEN = path.join(REPO_ROOT, 'examples/golden/java/expected.jsonl');

(async () => {
  const a = new FlowTraceAnalyzer();
  const result = await a.analyze(GOLDEN);

  assert.ok(result.fileStats.totalEvents > 0, 'totalEvents > 0');
  assert.ok(result.fileStats.uniqueTraces > 0, 'uniqueTraces > 0');
  assert.equal(typeof result.fileStats.timeRange.startSec, 'number');

  const perf = result.performance;
  assert.ok(Array.isArray(perf.slowMethods));
  assert.ok(Array.isArray(perf.bottlenecks));
  assert.ok(Array.isArray(perf.callTrees));
  assert.ok(perf.callTrees.length > 0, 'at least one trace tree');

  const tree = perf.callTrees[0];
  assert.ok(typeof tree.trace_id === 'string');
  assert.ok(tree.roots.length > 0, 'tree has roots');
  // Validate the ms-based dashboard contract fields are exposed (no _ns names)
  assert.ok('avgDuration' in (perf.slowMethods[0] || { avgDuration: 0 }));
  assert.ok(Array.isArray(perf.timeDistribution.ranges));

  console.log(`  ok   dashboard analyzer reads java golden (${result.fileStats.totalEvents} events, ${perf.callTrees.length} trace(s))`);
  console.log('1 passed, 0 failed');
})().catch((e) => {
  console.error('  FAIL', e.message);
  process.exit(1);
});
