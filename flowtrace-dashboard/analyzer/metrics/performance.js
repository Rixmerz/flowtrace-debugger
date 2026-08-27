/**
 * v2 Performance Analyzer. Operates on v2 events: groups by trace_id, computes
 * latency from `duration_ns`, and exposes a call-tree view via parent_id chain.
 */

'use strict';

/** Convert raw event duration_ns to milliseconds. */
function nsToMs(ns) {
  return ns / 1e6;
}

class PerformanceAnalyzer {
  constructor(events) {
    this.events = events || [];
    this.methodStats = new Map();
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
      stats.calls.push({
        duration_ns: e.duration_ns || 0,
        ts: e.ts,
        hasError: !!e.error,
      });
      if (e.error) stats.errors++;
    }
  }

  findSlowMethods(top = 20) {
    const out = [];
    for (const [name, s] of this.methodStats) {
      const durations = s.calls.map((c) => c.duration_ns).sort((a, b) => a - b);
      const sum = durations.reduce((a, b) => a + b, 0);
      const avg = sum / durations.length;
      const pick = (p) => durations[Math.floor(durations.length * p)] || 0;
      out.push({
        name,
        class: s.class,
        module: s.module,
        method: s.method,
        callCount: durations.length,
        avgDuration: nsToMs(avg),
        p95: nsToMs(pick(0.95)),
        p99: nsToMs(pick(0.99)),
        totalTime: nsToMs(sum),
        errors: s.errors,
        impactScore: Math.round(durations.length * nsToMs(avg)),
      });
    }
    out.sort((a, b) => b.avgDuration - a.avgDuration);
    return out.slice(0, top);
  }

  findBottlenecks(top = 10) {
    const out = [];
    for (const [name, s] of this.methodStats) {
      const sum = s.calls.reduce((a, c) => a + c.duration_ns, 0);
      const durations = s.calls.map((c) => c.duration_ns).sort((a, b) => a - b);
      const avg = sum / s.calls.length;
      const pick = (p) => durations[Math.floor(durations.length * p)] || 0;
      out.push({
        name,
        class: s.class,
        module: s.module,
        method: s.method,
        callCount: s.calls.length,
        avgDuration: nsToMs(avg),
        p95: nsToMs(pick(0.95)),
        p99: nsToMs(pick(0.99)),
        totalTime: nsToMs(sum),
        errors: s.errors,
        impactScore: Math.round(s.calls.length * nsToMs(avg)),
      });
    }
    out.sort((a, b) => b.impactScore - a.impactScore);
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
        const bucket = BUCKETS.find((b) => ms < b.max);
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

  /** Group events by trace_id and emit a tree per trace. */
  buildCallTrees() {
    const byTrace = new Map();
    for (const e of this.events) {
      if (!byTrace.has(e.trace_id)) byTrace.set(e.trace_id, []);
      byTrace.get(e.trace_id).push(e);
    }
    const trees = [];
    for (const [trace_id, scoped] of byTrace) {
      const enters = scoped.filter((e) => e.event === 'enter').sort((a, b) => a.ts - b.ts);
      const exits = new Map();
      for (const e of scoped) if (e.event === 'exit') exits.set(e.span_id, e);
      const nodes = new Map();
      for (const e of enters) {
        nodes.set(e.span_id, {
          span_id: e.span_id,
          parent_id: e.parent_id,
          method: e.method,
          class: e.class,
          module: e.module,
          lang: e.lang,
          depth: e.depth || 0,
          duration_ns: exits.get(e.span_id)?.duration_ns ?? null,
          children: [],
        });
      }
      const roots = [];
      for (const node of nodes.values()) {
        if (node.parent_id && nodes.has(node.parent_id)) {
          nodes.get(node.parent_id).children.push(node);
        } else {
          roots.push(node);
        }
      }
      trees.push({ trace_id, roots });
    }
    return trees;
  }

  getSummary() {
    let totalCalls = 0;
    let totalExceptions = 0;
    let total_ns = 0;
    for (const s of this.methodStats.values()) {
      totalCalls += s.calls.length;
      totalExceptions += s.errors;
      total_ns += s.calls.reduce((a, c) => a + c.duration_ns, 0);
    }
    return {
      totalCalls,
      totalMethods: this.methodStats.size,
      avgDuration: totalCalls > 0 ? nsToMs(total_ns / totalCalls) : 0,
      totalTime: nsToMs(total_ns),
      totalExceptions,
      errorRate: totalCalls > 0 ? Math.round((totalExceptions / totalCalls) * 10000) / 100 : 0,
    };
  }
}

module.exports = PerformanceAnalyzer;
