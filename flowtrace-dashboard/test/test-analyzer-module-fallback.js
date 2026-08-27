/**
 * A module-level function (no class) must keep its module name through
 * PerformanceAnalyzer's aggregation instead of being dropped — the dashboard
 * showed "Unknown" for every such function because `module` was discarded
 * in _buildMethodStats and never present on findSlowMethods/findBottlenecks/
 * findErrorHotspots output.
 */

'use strict';

const assert = require('node:assert/strict');
const PerformanceAnalyzer = require('../analyzer/metrics/performance');

function exitEvent(overrides) {
  return {
    event: 'exit',
    trace_id: 't1',
    span_id: overrides.span_id || 'a',
    method: overrides.method,
    class: overrides.class ?? '',
    module: overrides.module ?? '',
    duration_ns: overrides.duration_ns ?? 1_000_000,
    error: overrides.error ?? null,
  };
}

(async () => {
  const events = [
    exitEvent({ span_id: 'a', method: 'run_all', module: 'agent_service', duration_ns: 5_000_000 }),
    exitEvent({ span_id: 'b', method: 'validate', module: 'validator', class: 'OverValidator', duration_ns: 2_000_000 }),
    exitEvent({ span_id: 'c', method: 'risky_divide', module: 'agent_service', error: { message: 'boom' } }),
  ];
  const a = new PerformanceAnalyzer(events);

  const slow = a.findSlowMethods();
  const runAll = slow.find((m) => m.method === 'run_all');
  assert.ok(runAll, 'run_all present in slowMethods');
  assert.equal(runAll.class, '', 'module-level function has no class');
  assert.equal(runAll.module, 'agent_service', 'module survives aggregation');

  const validate = slow.find((m) => m.method === 'validate');
  assert.equal(validate.class, 'OverValidator');
  assert.equal(validate.module, 'validator');

  const bottlenecks = a.findBottlenecks();
  assert.ok(bottlenecks.every((b) => 'module' in b), 'every bottleneck row carries module');

  const errors = a.findErrorHotspots();
  const riskyDivide = errors.find((e) => e.method === 'risky_divide');
  assert.ok(riskyDivide, 'risky_divide present in errorHotspots');
  assert.equal(riskyDivide.module, 'agent_service');

  // Same method name, same empty class, different module — must not collide
  // into one aggregated row (this is why the grouping key includes module).
  const collisionEvents = [
    exitEvent({ span_id: 'x', method: 'loader', module: 'mod_a', duration_ns: 1_000_000 }),
    exitEvent({ span_id: 'y', method: 'loader', module: 'mod_b', duration_ns: 9_000_000 }),
  ];
  const b = new PerformanceAnalyzer(collisionEvents);
  assert.equal(b.methodStats.size, 2, 'same-named module-level functions in different modules stay distinct rows');

  console.log('  ok   module-level functions keep their module through aggregation, do not collide across modules');
  console.log('1 passed, 0 failed');
})().catch((e) => {
  console.error('  FAIL', e.message);
  process.exit(1);
});
