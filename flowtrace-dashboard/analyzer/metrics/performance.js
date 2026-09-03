/**
 * v2 Performance Analyzer. Operates on v2 events: groups by trace_id, computes
 * latency from `duration_ns`, and exposes a call-tree view via parent_id chain.
 *
 * Two numbers per call, because they answer different questions:
 *
 *   duration_ns  inclusive — enter to exit, children included. "How long did
 *                the caller wait for this?"
 *   self_ns      exclusive — duration minus the durations of direct children.
 *                "Where was the time actually spent?"
 *
 * Ranking hotspots by inclusive time put every outer frame above the code that
 * was slow (a request handler always "costs" more than the query inside it).
 * Summing inclusive time across a tree also counted every nanosecond once per
 * ancestor, so "total time" exceeded the wall clock. Self time is what the
 * bottleneck ranking and the totals use now; inclusive time is still reported
 * under its own name.
 *
 * Self time is clamped at zero and the span flagged `asyncOverlap` when a
 * child outlives its parent — an Express middleware that calls next() returns
 * in microseconds while the handler runs for hundreds of milliseconds. That is
 * a signal (the work was handed off), not a negative number.
 */

'use strict';

/** Convert raw event duration_ns to milliseconds. */
function nsToMs(ns) {
  return ns / 1e6;
}

/** Call trees above this many nodes are cut, the way trace_tree does. */
const MAX_TREE_NODES = 2000;

/**
 * Nearest-rank percentile on an ascending array. `floor(n * p)` overshot the
 * last index for p close to 1 and the `|| 0` that hid it reported p99 = 0 on
 * small samples.
 */
function percentile(sorted, p) {
  const n = sorted.length;
  if (n === 0) return 0;
  const rank = Math.ceil(p * n) - 1;
  return sorted[Math.min(n - 1, Math.max(0, rank))];
}

class PerformanceAnalyzer {
  constructor(events) {
    this.events = events || [];
    this.methodStats = new Map();
    this._indexSpans();
    this._buildMethodStats();
  }

  analyze() {
    return {
      slowMethods: this.findSlowMethods(),
      bottlenecks: this.findBottlenecks(),
      timeDistribution: this.calculateTimeDistribution(),
      errorHotspots: this.findErrorHotspots(),
      callTrees: this.buildCallTrees(),
      summary: this.getSummary(),
    };
  }

  /** exit by span_id, plus the sum of direct children's durations per span. */
  _indexSpans() {
    this.exitBySpan = new Map();
    this.childDuration = new Map();
    for (const e of this.events) {
      if (e.event === 'exit') this.exitBySpan.set(e.span_id, e);
    }
    for (const e of this.exitBySpan.values()) {
      if (!e.parent_id || !this.exitBySpan.has(e.parent_id)) continue;
      const d = Number.isFinite(e.duration_ns) ? e.duration_ns : 0;
      this.childDuration.set(e.parent_id, (this.childDuration.get(e.parent_id) || 0) + d);
    }
  }

  /** Inclusive and exclusive time for one exit event. */
  _timing(exit) {
    const duration_ns = Number.isFinite(exit.duration_ns) ? exit.duration_ns : 0;
    const children = this.childDuration.get(exit.span_id) || 0;
    return {
      duration_ns,
      self_ns: Math.max(0, duration_ns - children),
      asyncOverlap: children > duration_ns,
    };
  }

  _buildMethodStats() {
    for (const e of this.events) {
      if (e.event !== 'exit') continue;
      const cls = e.class || '';
      const mod = e.module || '';
      const key = `${mod}|${cls}|${e.method}`;
      let stats = this.methodStats.get(key);
      if (!stats) {
        stats = { class: cls, module: mod, method: e.method, lang: e.lang, calls: [], errors: 0 };
        this.methodStats.set(key, stats);
      }
      const t = this._timing(e);
      stats.calls.push({ ...t, ts: e.ts, hasError: !!e.error });
      if (e.error) stats.errors++;
    }
  }

  _methodRow(name, s) {
    const durations = s.calls.map((c) => c.duration_ns).sort((a, b) => a - b);
    const selfs = s.calls.map((c) => c.self_ns);
    const sum = durations.reduce((a, b) => a + b, 0);
    const selfSum = selfs.reduce((a, b) => a + b, 0);
    const n = durations.length;
    return {
      name,
      class: s.class,
      module: s.module,
      method: s.method,
      callCount: n,
      avgDuration: nsToMs(sum / n),
      avgSelfTime: nsToMs(selfSum / n),
      p95: nsToMs(percentile(durations, 0.95)),
      p99: nsToMs(percentile(durations, 0.99)),
      /** inclusive: children counted, so sums across methods double-count */
      totalTime: nsToMs(sum),
      /** exclusive: what this method itself spent */
      selfTime: nsToMs(selfSum),
      asyncOverlap: s.calls.some((c) => c.asyncOverlap),
      errors: s.errors,
      impactScore: Math.round(nsToMs(selfSum)),
    };
  }

  findSlowMethods(top = 20) {
    const out = [];
    for (const [name, s] of this.methodStats) out.push(this._methodRow(name, s));
    out.sort((a, b) => b.avgDuration - a.avgDuration);
    return out.slice(0, top);
  }

  findBottlenecks(top = 10) {
    const out = [];
    for (const [name, s] of this.methodStats) out.push(this._methodRow(name, s));
    out.sort((a, b) => b.impactScore - a.impactScore || b.selfTime - a.selfTime);
    return out.slice(0, top);
  }

  calculateTimeDistribution() {
    const BUCKETS = [
      { range: '<1ms', max: 1 },
      { range: '1-10ms', max: 10 },
      { range: '10-100ms', max: 100 },
      { range: '100ms-1s', max: 1000 },
      { range: '1-10s', max: 10000 },
      { range: '>10s', max: Infinity },
    ];
    const counts = new Map(BUCKETS.map((b) => [b.range, 0]));
    let totalCalls = 0;
    for (const s of this.methodStats.values()) {
      for (const c of s.calls) {
        const ms = nsToMs(c.duration_ns);
        if (!Number.isFinite(ms)) continue; // a NaN duration has no bucket
        const bucket = BUCKETS.find((b) => ms < b.max) || BUCKETS[BUCKETS.length - 1];
        counts.set(bucket.range, counts.get(bucket.range) + 1);
        totalCalls++;
      }
    }
    const ranges = [];
    for (const b of BUCKETS) {
      const count = counts.get(b.range);
      if (count === 0) continue;
      ranges.push({
        range: b.range,
        count,
        percentage: totalCalls > 0 ? Math.round((count / totalCalls) * 10000) / 100 : 0,
      });
    }
    return { ranges };
  }

  findErrorHotspots() {
    const out = [];
    for (const [name, s] of this.methodStats) {
      if (s.errors === 0) continue;
      out.push({
        name,
        class: s.class,
        module: s.module,
        method: s.method,
        callCount: s.calls.length,
        exceptions: s.errors,
        errorRate: Math.round((s.errors / s.calls.length) * 10000) / 100,
      });
    }
    out.sort((a, b) => b.exceptions - a.exceptions);
    return out;
  }

  /**
   * Group events by trace_id and emit a tree per trace.
   *
   * Capped at MAX_TREE_NODES across the response: a real 17.8k-event trace
   * produced a multi-megabyte tree, and this structure is cached per analysis
   * and shipped to the browser whole. `truncated` / `elidedCount` say so.
   *
   * A span whose parent_id names a span that is not in the file is reported
   * with `danglingParent: true` rather than silently promoted to a root: for a
   * multi-file cross-process trace, a half-loaded file otherwise looks exactly
   * like a healthy one with several roots.
   */
  buildCallTrees() {
    const byTrace = new Map();
    for (const e of this.events) {
      if (!byTrace.has(e.trace_id)) byTrace.set(e.trace_id, []);
      byTrace.get(e.trace_id).push(e);
    }
    const trees = [];
    let budget = MAX_TREE_NODES;
    let elided = 0;
    for (const [trace_id, scoped] of byTrace) {
      const enters = scoped.filter((e) => e.event === 'enter').sort((a, b) => a.ts - b.ts);
      const nodes = new Map();
      let danglingParents = 0;
      for (const e of enters) {
        if (budget <= 0) { elided++; continue; }
        budget--;
        const exit = this.exitBySpan.get(e.span_id);
        const timing = exit ? this._timing(exit) : null;
        nodes.set(e.span_id, {
          span_id: e.span_id,
          parent_id: e.parent_id,
          method: e.method,
          class: e.class,
          module: e.module,
          lang: e.lang,
          visibility: e.visibility,
          depth: e.depth || 0,
          duration_ns: exit ? timing.duration_ns : null,
          self_ns: exit ? timing.self_ns : null,
          asyncOverlap: exit ? timing.asyncOverlap : false,
          error: exit && exit.error ? { type: exit.error.type, msg: exit.error.msg } : null,
          danglingParent: false,
          children: [],
        });
      }
      const roots = [];
      for (const node of nodes.values()) {
        if (node.parent_id && nodes.has(node.parent_id)) {
          nodes.get(node.parent_id).children.push(node);
        } else {
          if (node.parent_id) {
            node.danglingParent = true;
            danglingParents++;
          }
          roots.push(node);
        }
      }
      trees.push({ trace_id, roots, danglingParents });
    }
    return Object.assign(trees, { truncated: elided > 0, elidedCount: elided });
  }

  getSummary() {
    let totalCalls = 0;
    let totalExceptions = 0;
    let total_ns = 0;
    let self_ns = 0;
    for (const s of this.methodStats.values()) {
      totalCalls += s.calls.length;
      totalExceptions += s.errors;
      for (const c of s.calls) {
        total_ns += c.duration_ns;
        self_ns += c.self_ns;
      }
    }
    return {
      totalCalls,
      totalMethods: this.methodStats.size,
      avgDuration: totalCalls > 0 ? nsToMs(total_ns / totalCalls) : 0,
      /** inclusive sum — exceeds wall time whenever calls nest */
      totalTime: nsToMs(total_ns),
      /** exclusive sum — the time actually spent, each nanosecond once */
      selfTime: nsToMs(self_ns),
      totalExceptions,
      errorRate: totalCalls > 0 ? Math.round((totalExceptions / totalCalls) * 10000) / 100 : 0,
    };
  }
}

module.exports = PerformanceAnalyzer;
module.exports.percentile = percentile;
module.exports.MAX_TREE_NODES = MAX_TREE_NODES;
