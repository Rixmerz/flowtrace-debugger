// FlowTrace v2 trace_* tool implementations. Pure functions over TraceEvent[]
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
  /** Set when this node's own children were elided by maxDepth/maxNodes. */
  truncated?: boolean;
  /** Count of descendants elided under this node when `truncated` is set. */
  elidedCount?: number;
}

/** Default cap on total nodes returned by traceTree — a real 17.8k-event
 *  trace produced a 5,934-node / 1.79MB response, unusable over MCP. */
const DEFAULT_MAX_NODES = 2000;

export interface TraceTreeOptions {
  /** Max depth (relative to each root at depth 0) to expand children for. */
  maxDepth?: number;
  /** Max total nodes to emit across the whole result. Default 2000. */
  maxNodes?: number;
}

export interface TraceTreeResult {
  roots: TreeNode[];
  truncated: boolean;
  totalNodes: number;
}

// Schema v2 has exactly two event variants: enter and exit. A failed call is an
// exit carrying a top-level `error`. There is no separate event="error" — the
// code that used to look for one was unreachable by construction.
function isEnter(e: TraceEvent): e is EnterEvent { return e.event === "enter"; }
function isExit(e: TraceEvent): e is ExitEvent { return e.event === "exit"; }

/** Build hierarchical call tree(s) for a given trace_id. Returns one root per
 *  parent_id=null span, capped at `maxNodes` total emitted nodes (default
 *  2000) and optionally at `maxDepth`. Where a subtree is elided, its parent
 *  node carries `truncated: true` and `elidedCount`. */
export function traceTree(
  events: TraceEvent[],
  traceId: string,
  options: TraceTreeOptions = {}
): TraceTreeResult {
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const maxDepth = options.maxDepth;

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

  // Index by parent so we can walk it depth-first without mutating the
  // full-tree nodes built above (those get cloned per emitted copy).
  const childrenOf = new Map<string, TreeNode[]>();
  const roots: TreeNode[] = [];
  for (const node of nodeBySpan.values()) {
    if (node.parent_id && nodeBySpan.has(node.parent_id)) {
      const siblings = childrenOf.get(node.parent_id) ?? [];
      siblings.push(node);
      childrenOf.set(node.parent_id, siblings);
    } else {
      roots.push(node);
    }
  }

  function countDescendants(node: TreeNode): number {
    const kids = childrenOf.get(node.span_id) ?? [];
    let n = kids.length;
    for (const kid of kids) n += countDescendants(kid);
    return n;
  }

  let emitted = 0;
  let truncated = false;

  function build(node: TreeNode, depth: number): TreeNode {
    emitted++;
    const out: TreeNode = { ...node, children: [] };
    const kids = childrenOf.get(node.span_id) ?? [];

    if (maxDepth !== undefined && depth >= maxDepth && kids.length) {
      truncated = true;
      out.truncated = true;
      out.elidedCount = kids.reduce((n, k) => n + 1 + countDescendants(k), 0);
      return out;
    }

    for (const kid of kids) {
      if (emitted >= maxNodes) {
        truncated = true;
        out.truncated = true;
        out.elidedCount = (out.elidedCount ?? 0) + 1 + countDescendants(kid);
        continue;
      }
      out.children.push(build(kid, depth + 1));
    }
    return out;
  }

  const outRoots: TreeNode[] = [];
  for (const root of roots) {
    if (emitted >= maxNodes) {
      truncated = true;
      break;
    }
    outRoots.push(build(root, 0));
  }

  return { roots: outRoots, truncated, totalNodes: emitted };
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
    module?: string;
    class?: string;
    method: string;
    avg_a_ns: number;
    avg_b_ns: number;
    delta_ns: number;
    delta_pct: number;
  }>;
}

// Same key shape trace_private_calls already groups by — module + class +
// method. Grouping by `.method` alone (the old behaviour) averaged unrelated
// same-named methods from different modules/classes into one meaningless
// number (e.g. two unrelated `_loader` methods 14x apart in duration).
function methodKey(e: TraceEvent): string {
  return `${e.module ?? ""}|${e.class ?? ""}|${e.method}`;
}

/** Human-readable form of a methodKey — "module.class.method", dropping
 *  whichever parts are empty, instead of leaking the internal `|`-joined key. */
function formatMethodKey(key: string): string {
  return key.split("|").filter(Boolean).join(".");
}

// Sub-microsecond avg deltas (e.g. 750ns -> 1542ns, +106%) are noise next to
// a large absolute regression reported at a smaller percentage — exclude
// them from the default view.
const DEFAULT_MIN_ABS_DELTA_NS = 1000;

export interface TraceDiffOptions {
  /** Absolute duration-delta floor in ns; rows below it are excluded. */
  min_abs_delta_ns?: number;
}

/** Compare two sessions: methods in only one side + avg duration deltas,
 *  grouped by module+class+method and floored by an absolute delta so a tiny
 *  percentage swing on a near-zero duration doesn't outrank a real
 *  regression. */
export function traceDiff(a: TraceEvent[], b: TraceEvent[], options: TraceDiffOptions = {}): TraceDiff {
  const minAbsDeltaNs = options.min_abs_delta_ns ?? DEFAULT_MIN_ABS_DELTA_NS;

  const avgByMethod = (events: TraceEvent[]) => {
    const acc = new Map<string, { sum: number; n: number; module?: string; class?: string; method: string }>();
    for (const e of events) {
      if (!isExit(e)) continue;
      const k = methodKey(e);
      const cur = acc.get(k) ?? { sum: 0, n: 0, module: e.module, class: e.class, method: e.method };
      cur.sum += e.duration_ns;
      cur.n += 1;
      acc.set(k, cur);
    }
    const out = new Map<string, { avg: number; module?: string; class?: string; method: string }>();
    for (const [k, v] of acc) out.set(k, { avg: v.sum / v.n, module: v.module, class: v.class, method: v.method });
    return out;
  };

  const aAvg = avgByMethod(a);
  const bAvg = avgByMethod(b);
  const aMethods = new Set(aAvg.keys());
  const bMethods = new Set(bAvg.keys());

  const only_in_a = [...aMethods].filter(m => !bMethods.has(m)).map(formatMethodKey).sort();
  const only_in_b = [...bMethods].filter(m => !aMethods.has(m)).map(formatMethodKey).sort();

  const duration_deltas: TraceDiff["duration_deltas"] = [];
  for (const k of aMethods) {
    if (!bMethods.has(k)) continue;
    const av = aAvg.get(k)!;
    const bv = bAvg.get(k)!;
    if (av.avg <= 0) continue;
    const deltaNs = bv.avg - av.avg;
    if (Math.abs(deltaNs) < minAbsDeltaNs) continue;
    const deltaPct = (deltaNs / av.avg) * 100;
    duration_deltas.push({
      module: av.module,
      class: av.class,
      method: av.method,
      avg_a_ns: Math.round(av.avg),
      avg_b_ns: Math.round(bv.avg),
      delta_ns: Math.round(deltaNs),
      delta_pct: Math.round(deltaPct * 10) / 10,
    });
  }
  duration_deltas.sort((x, y) => Math.abs(y.delta_ns) - Math.abs(x.delta_ns));

  return { only_in_a, only_in_b, duration_deltas };
}
