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

// -- Layered trace tools ---------------------------------------------------
// Cheapest first, the way Jaeger's MCP tools are layered: trace_search returns
// one summary line per trace, trace_topology the shape of one trace with no
// payloads, trace_span_details the full events for spans the agent has
// already chosen. A single trace_tree call over a real capture can run to
// megabytes; this lets an agent spend context only where it has decided to.

interface Span {
  enter: EnterEvent;
  exit?: ExitEvent;
}

function spansOf(events: TraceEvent[], traceId?: string): Map<string, Span> {
  const spans = new Map<string, Span>();
  for (const e of events) {
    if (traceId !== undefined && e.trace_id !== traceId) continue;
    if (isEnter(e)) {
      const cur = spans.get(e.span_id);
      if (cur) cur.enter = e;
      else spans.set(e.span_id, { enter: e });
    }
  }
  for (const e of events) {
    if (traceId !== undefined && e.trace_id !== traceId) continue;
    if (isExit(e)) {
      const cur = spans.get(e.span_id);
      if (cur) cur.exit = e;
    }
  }
  return spans;
}

function label(e: TraceEvent): string {
  return [e.module, e.class, e.method].filter(Boolean).join(".");
}

export interface TraceSummary {
  trace_id: string;
  root: string | null;
  start_ts: number;
  duration_ns: number | null;
  span_count: number;
  error_count: number;
  threads: string[];
  langs: string[];
}

export interface TraceSearchOptions {
  has_error?: boolean;
  method?: string;
  min_duration_ns?: number;
  limit?: number;
}

export interface TraceSearchResult {
  total: number;
  returned: number;
  truncated: boolean;
  traces: TraceSummary[];
}

/** One summary per trace_id — no spans, no args. Ordered by start time. */
export function traceSearch(events: TraceEvent[], options: TraceSearchOptions = {}): TraceSearchResult {
  const limit = options.limit ?? 50;
  const acc = new Map<string, {
    start: number; end: number; spans: number; errors: number;
    root: EnterEvent | null; rootExit: ExitEvent | null;
    threads: Set<string>; langs: Set<string>; methods: Set<string>;
  }>();
  for (const e of events) {
    let a = acc.get(e.trace_id);
    if (!a) {
      a = { start: e.ts, end: e.ts, spans: 0, errors: 0, root: null, rootExit: null,
        threads: new Set(), langs: new Set(), methods: new Set() };
      acc.set(e.trace_id, a);
    }
    a.start = Math.min(a.start, e.ts);
    a.end = Math.max(a.end, e.ts);
    a.threads.add(e.thread);
    a.langs.add(e.lang);
    a.methods.add(label(e).toLowerCase());
    if (isEnter(e)) {
      a.spans++;
      if (e.parent_id === null && (!a.root || e.ts < a.root.ts)) a.root = e;
    } else if (isExit(e)) {
      if (e.error) a.errors++;
    }
  }
  // Root exits resolved after the scan so enter/exit order in the file does not matter.
  for (const e of events) {
    if (!isExit(e)) continue;
    const a = acc.get(e.trace_id);
    if (a?.root && a.root.span_id === e.span_id) a.rootExit = e;
  }

  const needle = options.method?.toLowerCase();
  const all: TraceSummary[] = [];
  for (const [trace_id, a] of acc) {
    if (options.has_error === true && a.errors === 0) continue;
    if (options.has_error === false && a.errors > 0) continue;
    if (needle && ![...a.methods].some(m => m.includes(needle))) continue;
    // A trace whose root never exited has no duration; the observed ts span
    // is a lower bound, not the answer, so it stays null.
    const duration = a.rootExit?.duration_ns ?? null;
    if (options.min_duration_ns !== undefined && (duration ?? 0) < options.min_duration_ns) continue;
    all.push({
      trace_id,
      root: a.root ? label(a.root) : null,
      start_ts: a.start,
      duration_ns: duration,
      span_count: a.spans,
      error_count: a.errors,
      threads: [...a.threads].sort(),
      langs: [...a.langs].sort(),
    });
  }
  all.sort((x, y) => x.start_ts - y.start_ts || x.trace_id.localeCompare(y.trace_id));
  const traces = all.slice(0, limit);
  return { total: all.length, returned: traces.length, truncated: traces.length < all.length, traces };
}

export interface TopologyEntry {
  span_id: string;
  /** Ancestry as slash-delimited span ids, root first, ending in this span. */
  path: string;
  depth: number;
  name: string;
  visibility?: string;
  duration_ns: number | null;
  self_ns: number | null;
  error: boolean;
}

export interface TopologyResult {
  trace_id: string;
  total: number;
  returned: number;
  truncated: boolean;
  spans: TopologyEntry[];
}

/** Children indexed by parent, each list ordered by entry time. Spans whose
 *  parent is absent from the trace are roots. */
function childIndex(spans: Map<string, Span>): { roots: Span[]; childrenOf: Map<string, Span[]> } {
  const childrenOf = new Map<string, Span[]>();
  const roots: Span[] = [];
  for (const s of spans.values()) {
    const p = s.enter.parent_id;
    if (p && spans.has(p)) {
      const list = childrenOf.get(p) ?? [];
      list.push(s);
      childrenOf.set(p, list);
    } else roots.push(s);
  }
  const byTs = (a: Span, b: Span) => a.enter.ts - b.enter.ts;
  roots.sort(byTs);
  for (const list of childrenOf.values()) list.sort(byTs);
  return { roots, childrenOf };
}

function selfNs(s: Span, childrenOf: Map<string, Span[]>): number | null {
  if (!s.exit) return null;
  let kids = 0;
  for (const c of childrenOf.get(s.enter.span_id) ?? []) kids += c.exit?.duration_ns ?? 0;
  // Unawaited async children can outlive the parent; never report negative self time.
  return Math.max(0, s.exit.duration_ns - kids);
}

/** Flat depth-first list of one trace's spans: structure and timing only,
 *  no args, results or stacks. */
export function traceTopology(events: TraceEvent[], traceId: string, options: { limit?: number } = {}): TopologyResult {
  const limit = options.limit ?? 2000;
  const spans = spansOf(events, traceId);
  const { roots, childrenOf } = childIndex(spans);
  const out: TopologyEntry[] = [];
  // Iterative: a deeply recursive program must not overflow this server's stack.
  const stack: Array<{ s: Span; prefix: string; depth: number }> =
    roots.slice().reverse().map(s => ({ s, prefix: "", depth: 0 }));
  while (stack.length && out.length < limit) {
    const { s, prefix, depth } = stack.pop()!;
    const path = prefix ? `${prefix}/${s.enter.span_id}` : s.enter.span_id;
    out.push({
      span_id: s.enter.span_id,
      path,
      depth,
      name: label(s.enter),
      visibility: s.enter.visibility,
      duration_ns: s.exit?.duration_ns ?? null,
      self_ns: selfNs(s, childrenOf),
      error: Boolean(s.exit?.error),
    });
    const kids = childrenOf.get(s.enter.span_id) ?? [];
    for (let i = kids.length - 1; i >= 0; i--) stack.push({ s: kids[i], prefix: path, depth: depth + 1 });
  }
  return { trace_id: traceId, total: spans.size, returned: out.length, truncated: out.length < spans.size, spans: out };
}

export interface SpanDetail {
  span_id: string;
  enter: EnterEvent;
  exit: ExitEvent | null;
}

export interface SpanDetailsResult {
  requested: number;
  returned: number;
  truncated: boolean;
  not_found: string[];
  spans: SpanDetail[];
}

/** Full enter/exit events (args, result, error with stack) for chosen spans. */
export function traceSpanDetails(events: TraceEvent[], spanIds: string[], options: { limit?: number } = {}): SpanDetailsResult {
  const limit = options.limit ?? 20;
  const wanted = [...new Set(spanIds)];
  const spans = spansOf(events.filter(e => wanted.includes(e.span_id)));
  const not_found = wanted.filter(id => !spans.has(id));
  const found = wanted.filter(id => spans.has(id));
  const picked = found.slice(0, limit).map(id => {
    const s = spans.get(id)!;
    return { span_id: id, enter: s.enter, exit: s.exit ?? null };
  });
  return { requested: wanted.length, returned: picked.length, truncated: picked.length < found.length, not_found, spans: picked };
}

export interface TraceErrorsResult {
  total_error_count: number;
  returned: number;
  truncated: boolean;
  errors: Array<ErrorPath & { method: string; args?: unknown }>;
}

/** Every failing exit (optionally within one trace), each with its path to
 *  the root. trace_find_error answers "the first one"; this answers "all of
 *  them", and says how many there were when it had to cut the list. */
export function traceErrors(events: TraceEvent[], options: { trace_id?: string; limit?: number } = {}): TraceErrorsResult {
  const limit = options.limit ?? 20;
  const scoped = options.trace_id ? events.filter(e => e.trace_id === options.trace_id) : events;
  const failing = scoped.filter((e): e is ExitEvent => isExit(e) && Boolean(e.error)).sort((a, b) => a.ts - b.ts);
  const enterByKey = new Map<string, EnterEvent>();
  for (const e of scoped) if (isEnter(e)) enterByKey.set(`${e.trace_id}|${e.span_id}`, e);

  const errors = failing.slice(0, limit).map(x => {
    const path: ErrorPath["path"] = [];
    let cursor: string | null = x.span_id;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const en = enterByKey.get(`${x.trace_id}|${cursor}`);
      if (!en) break;
      path.unshift({ span_id: en.span_id, class: en.class, method: en.method, module: en.module });
      cursor = en.parent_id;
    }
    return {
      trace_id: x.trace_id,
      span_id: x.span_id,
      method: label(x),
      args: enterByKey.get(`${x.trace_id}|${x.span_id}`)?.args,
      error: x.error!,
      path,
    };
  });
  return { total_error_count: failing.length, returned: errors.length, truncated: errors.length < failing.length, errors };
}

export interface CriticalPathSection {
  span_id: string;
  name: string;
  depth: number;
  /** Time on the critical path attributed to this span itself. */
  self_ns: number;
  start_ns: number;
  end_ns: number;
}

export interface CriticalPathResult {
  trace_id: string;
  root: string | null;
  total_ns: number;
  sections: CriticalPathSection[];
  /** Critical-path time summed per span, largest first. */
  by_span: Array<{ span_id: string; name: string; self_ns: number; pct: number }>;
}

/**
 * The chain of spans that determined end-to-end duration, following Jaeger's
 * "last finishing child" algorithm: starting at the root's end, walk back
 * through the child that finished last before the cursor, recurse into it,
 * and move the cursor to that child's start. Gaps where no child was running
 * are the parent's own time.
 *
 * Times are reconstructed from `ts` (epoch seconds) for starts and
 * `duration_ns` for lengths — `ts` alone is too coarse for sub-microsecond
 * spans once it has been through a float.
 */
export function traceCriticalPath(events: TraceEvent[], traceId: string): CriticalPathResult {
  const spans = spansOf(events, traceId);
  const { roots, childrenOf } = childIndex(spans);
  const rootSpan = roots.find(r => r.exit) ?? null;
  if (!rootSpan) return { trace_id: traceId, root: null, total_ns: 0, sections: [], by_span: [] };

  const t0 = rootSpan.enter.ts;
  const startNs = (s: Span) => Math.round((s.enter.ts - t0) * 1e9);
  const endNs = (s: Span) => startNs(s) + (s.exit?.duration_ns ?? 0);

  const sections: CriticalPathSection[] = [];
  const emit = (s: Span, depth: number, from: number, to: number) => {
    if (to > from) sections.push({ span_id: s.enter.span_id, name: label(s.enter), depth, self_ns: to - from, start_ns: from, end_ns: to });
  };

  // Recursion depth equals the critical path's depth, bounded by call depth. Each frame walks one span's
  // children backwards from `cursor`.
  const walk = (span: Span, depth: number, spanEnd: number) => {
    const spanStart = startNs(span);
    let cursor = Math.min(spanEnd, endNs(span));
    // Only children that completed; clip each to the parent's window.
    const kids = (childrenOf.get(span.enter.span_id) ?? []).filter(k => k.exit);
    while (cursor > spanStart) {
      let lfc: Span | null = null;
      let lfcEnd = -Infinity;
      for (const k of kids) {
        const kEnd = Math.min(endNs(k), cursor);
        if (startNs(k) < cursor && kEnd > lfcEnd) { lfc = k; lfcEnd = kEnd; }
      }
      if (!lfc) { emit(span, depth, spanStart, cursor); break; }
      emit(span, depth, lfcEnd, cursor);
      walk(lfc, depth + 1, lfcEnd);
      cursor = Math.max(spanStart, startNs(lfc));
    }
  };
  walk(rootSpan, 0, endNs(rootSpan));
  sections.sort((a, b) => a.start_ns - b.start_ns);

  const total = rootSpan.exit!.duration_ns;
  const per = new Map<string, { name: string; self_ns: number }>();
  for (const s of sections) {
    const cur = per.get(s.span_id) ?? { name: s.name, self_ns: 0 };
    cur.self_ns += s.self_ns;
    per.set(s.span_id, cur);
  }
  const by_span = [...per.entries()]
    .map(([span_id, v]) => ({ span_id, name: v.name, self_ns: v.self_ns, pct: total ? Math.round((v.self_ns / total) * 1000) / 10 : 0 }))
    .sort((a, b) => b.self_ns - a.self_ns);
  return { trace_id: traceId, root: label(rootSpan.enter), total_ns: total, sections, by_span };
}
