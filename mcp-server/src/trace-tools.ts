// FlowTrace v2 trace.* tool implementations. Pure functions over TraceEvent[]
// so they're trivially testable.

import type { TraceEvent, EnterEvent, ExitEvent } from "./types";

export interface TreeNode {
  span_id: string;
  trace_id: string;
  parent_id: string | null;
  module?: string;
  class?: string;
  method: string;
  lang: string;
  visibility?: string;
  depth: number;
  duration_ns: number | null;
  error?: { type: string; msg: string } | null;
  children: TreeNode[];
}

// Schema v2 has exactly two event variants: enter and exit. A failed call is an
// exit carrying a top-level `error`. There is no separate event="error" — the
// code that used to look for one was unreachable by construction.
function isEnter(e: TraceEvent): e is EnterEvent { return e.event === "enter"; }
function isExit(e: TraceEvent): e is ExitEvent { return e.event === "exit"; }

/** Build hierarchical call tree(s) for a given trace_id. Returns one root per
 *  parent_id=null span. */
export function traceTree(events: TraceEvent[], traceId: string): TreeNode[] {
  const scoped = events.filter(e => e.trace_id === traceId);
  const enters = scoped.filter(isEnter).sort((a, b) => a.ts - b.ts);

  // Index exits by span_id for O(1) duration lookup.
  const exitBySpan = new Map<string, ExitEvent>();
  for (const e of scoped) {
    if (isExit(e)) exitBySpan.set(e.span_id, e);
  }

  const nodeBySpan = new Map<string, TreeNode>();
  for (const e of enters) {
    const exit = exitBySpan.get(e.span_id);
    const node: TreeNode = {
      span_id: e.span_id,
      trace_id: e.trace_id,
      parent_id: e.parent_id,
      module: e.module,
      class: e.class,
      method: e.method,
      lang: e.lang,
      visibility: e.visibility,
      depth: e.depth ?? 0,
      duration_ns: exit?.duration_ns ?? null,
      error: exit?.error ? { type: exit.error.type, msg: exit.error.msg } : null,
      children: [],
    };
    nodeBySpan.set(e.span_id, node);
  }

  const roots: TreeNode[] = [];
  for (const node of nodeBySpan.values()) {
    if (node.parent_id && nodeBySpan.has(node.parent_id)) {
      nodeBySpan.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  // Stable order: children sorted by depth then no-op (insertion preserves ts).
  return roots;
}

export interface ErrorPath {
  trace_id: string;
  span_id: string;
  error: { type: string; msg: string; stack?: string[] };
  path: Array<{ span_id: string; class?: string; method: string; module?: string }>;
}

/** First exit event carrying an `error`. Walks parents to root and returns the
 *  call path. */
export function traceFindError(events: TraceEvent[]): ErrorPath | null {
  // Sort by ts so "first" is deterministic.
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  let target: { event: TraceEvent; err: { type: string; msg: string; stack?: string[] } } | null = null;
  for (const e of sorted) {
    if (isExit(e) && e.error) { target = { event: e, err: e.error }; break; }
  }
  if (!target) return null;

  // Index enters by span_id within the same trace to walk parents.
  const enters = events.filter(isEnter).filter(e => e.trace_id === target!.event.trace_id);
  const enterBySpan = new Map<string, EnterEvent>();
  for (const e of enters) enterBySpan.set(e.span_id, e);

  const path: ErrorPath["path"] = [];
  let cursor: string | null = target.event.span_id;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const en = enterBySpan.get(cursor);
    if (!en) break;
    path.unshift({ span_id: en.span_id, class: en.class, method: en.method, module: en.module });
    cursor = en.parent_id;
  }

  return {
    trace_id: target.event.trace_id,
    span_id: target.event.span_id,
    error: target.err,
    path,
  };
}

export interface PrivateCallEntry {
  class?: string;
  method: string;
  module?: string;
  count: number;
}

/** Filter events by visibility=private; group by class.method and count. */
export function tracePrivateCalls(events: TraceEvent[]): PrivateCallEntry[] {
  const counts = new Map<string, PrivateCallEntry>();
  for (const e of events) {
    if (!isEnter(e)) continue;
    if (e.visibility !== "private") continue;
    const key = `${e.module ?? ""}|${e.class ?? ""}|${e.method}`;
    const cur = counts.get(key);
    if (cur) cur.count++;
    else counts.set(key, { module: e.module, class: e.class, method: e.method, count: 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

export interface TraceDiff {
  only_in_a: string[];
  only_in_b: string[];
  duration_deltas: Array<{
    method: string;
    avg_a_ns: number;
    avg_b_ns: number;
    delta_pct: number;
  }>;
}

function methodKey(e: TraceEvent): string {
  return `${e.class ?? ""}.${e.method}`;
}

/** Compare two sessions: methods in only one side + avg duration deltas > 20%. */
export function traceDiff(a: TraceEvent[], b: TraceEvent[]): TraceDiff {
  const avgByMethod = (events: TraceEvent[]) => {
    const acc = new Map<string, { sum: number; n: number }>();
    for (const e of events) {
      if (!isExit(e)) continue;
      const k = methodKey(e);
      const cur = acc.get(k) ?? { sum: 0, n: 0 };
      cur.sum += e.duration_ns;
      cur.n += 1;
      acc.set(k, cur);
    }
    const out = new Map<string, number>();
    for (const [k, v] of acc) out.set(k, v.sum / v.n);
    return out;
  };

  const aAvg = avgByMethod(a);
  const bAvg = avgByMethod(b);
  const aMethods = new Set(aAvg.keys());
  const bMethods = new Set(bAvg.keys());

  const only_in_a = [...aMethods].filter(m => !bMethods.has(m)).sort();
  const only_in_b = [...bMethods].filter(m => !aMethods.has(m)).sort();

  const duration_deltas: TraceDiff["duration_deltas"] = [];
  for (const m of aMethods) {
    if (!bMethods.has(m)) continue;
    const av = aAvg.get(m)!;
    const bv = bAvg.get(m)!;
    if (av <= 0) continue;
    const delta = ((bv - av) / av) * 100;
    if (Math.abs(delta) > 20) {
      duration_deltas.push({
        method: m,
        avg_a_ns: Math.round(av),
        avg_b_ns: Math.round(bv),
        delta_pct: Math.round(delta * 10) / 10,
      });
    }
  }
  duration_deltas.sort((x, y) => Math.abs(y.delta_pct) - Math.abs(x.delta_pct));

  return { only_in_a, only_in_b, duration_deltas };
}
