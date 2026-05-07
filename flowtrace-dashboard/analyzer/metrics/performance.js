/**
 * v2 Performance Analyzer. Operates on v2 events: groups by trace_id, computes
 * latency from `duration_ns`, and exposes a call-tree view via parent_id chain.
 */

'use strict';

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
      const key = `${cls}.${e.method}`;
      let stats = this.methodStats.get(key);
      if (!stats) {
        stats = { class: cls, method: e.method, lang: e.lang, calls: [], errors: 0 };
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
        method: s.method,
        callCount: durations.length,
        avg_ns: Math.round(avg),
        min_ns: durations[0] || 0,
        max_ns: durations[durations.length - 1] || 0,
        p50_ns: pick(0.5),
        p95_ns: pick(0.95),
        p99_ns: pick(0.99),
        total_ns: sum,
        errors: s.errors,
      });
    }
    out.sort((a, b) => b.avg_ns - a.avg_ns);
    return out.slice(0, top);
  }

  findBottlenecks(top = 10) {
    const out = [];
    for (const [name, s] of this.methodStats) {
      const sum = s.calls.reduce((a, c) => a + c.duration_ns, 0);
      const avg = sum / s.calls.length;
      out.push({
        name,
        class: s.class,
        method: s.method,
        callCount: s.calls.length,
        avg_ns: Math.round(avg),
        total_ns: sum,
        impactScore: Math.round(s.calls.length * avg),
      });
    }
    out.sort((a, b) => b.impactScore - a.impactScore);
    return out.slice(0, top);
  }

  calculateTimeDistribution() {
    let totalTime = 0;
    for (const s of this.methodStats.values()) {
      totalTime += s.calls.reduce((a, c) => a + c.duration_ns, 0);
    }
    const distribution = [];
    for (const [name, s] of this.methodStats) {
      const t = s.calls.reduce((a, c) => a + c.duration_ns, 0);
      distribution.push({
        name,
        class: s.class,
        method: s.method,
        total_ns: t,
        percentage: totalTime > 0 ? Math.round((t / totalTime) * 10000) / 100 : 0,
      });
    }
    distribution.sort((a, b) => b.percentage - a.percentage);
    return { total_ns: totalTime, distribution: distribution.slice(0, 20) };
  }

  findErrorHotspots() {
    const out = [];
    for (const [name, s] of this.methodStats) {
      if (s.errors === 0) continue;
      out.push({
        name,
        class: s.class,
        method: s.method,
        totalCalls: s.calls.length,
        errors: s.errors,
        errorRate: Math.round((s.errors / s.calls.length) * 10000) / 100,
      });
    }
    out.sort((a, b) => b.errors - a.errors);
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
    let totalErrors = 0;
    let total_ns = 0;
    for (const s of this.methodStats.values()) {
      totalCalls += s.calls.length;
      totalErrors += s.errors;
      total_ns += s.calls.reduce((a, c) => a + c.duration_ns, 0);
    }
    return {
      totalCalls,
      totalMethods: this.methodStats.size,
      avg_ns: totalCalls > 0 ? Math.round(total_ns / totalCalls) : 0,
      total_ns,
      totalErrors,
      errorRate: totalCalls > 0 ? Math.round((totalErrors / totalCalls) * 10000) / 100 : 0,
    };
  }
}

module.exports = PerformanceAnalyzer;
