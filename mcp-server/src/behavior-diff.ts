// Behavioural comparison of two traces of the same flow — the characterisation
// (golden master) gate. `traceDiff` in trace-tools.ts answers "which methods
// exist on one side, and how did their average duration move"; it cannot see a
// function that now returns something else for the same arguments, a call that
// moved, one that now throws, or one that runs a different number of times.
// This module compares STRUCTURE and VALUES and ignores what legitimately
// differs between two runs of unchanged code.
//
// Pure: no I/O, no globals. The only import is node:crypto, for subtree hashes.
// It is bundled twice — into plugin/mcp/server.bundle.js for the MCP tool and
// into flowtrace-cli/vendor/trace-diff/ for `flowtrace diff` — so it must stay
// free of anything the MCP server needs (the SDK, zod, sessions).
//
// How it works, in the order the cost is paid:
//
//   1. Each trace is folded, one event at a time, into a compact tree (no
//      event is retained). A node keeps its identity key, the canonical JSON of
//      its normalised args and result, and its error type / message.
//   2. Every node gets a hash of itself plus its children's hashes. Two
//      subtrees with the same hash are identical and are never walked, which is
//      what makes the common case — two runs of unchanged code — linear.
//   3. Where hashes differ, the two sibling lists are aligned: equal prefix and
//      suffix are trimmed, and the middle goes through a weighted LCS (an exact
//      match scores 2, a same-identity match 1), so one inserted call does not
//      turn every later sibling into a difference. The LCS is capped per list
//      and overall; past the cap it degrades to a greedy bounded-lookahead
//      alignment, which can over-report but never under-report, and says so.

import { createHash } from "node:crypto";

// -- options ---------------------------------------------------------------

export interface BehaviorDiffOptions {
  /** Globs (`*`, `?`) matched against `module.class.method`. A matching call
   *  is dropped together with everything it calls. */
  ignore_methods?: string[];
  /** Keys to drop from args/result before comparing. A bare name (`created_at`,
   *  or a glob like `*_at`) matches that key at any depth; a path anchored at
   *  `args.` or `result.` (`result.user.id`, `args.items.*.ts`) matches exactly
   *  there, `*` standing for one segment. `args` / `result` alone drop it all. */
  ignore_keys?: string[];
  /** Treat sibling order as irrelevant (concurrent flows). Default false. */
  ignore_order?: boolean;
  /** Compare error messages too, as their own category. Default true. */
  compare_error_msg?: boolean;
  /** Rewrite memory addresses (`0x7f3a…`) inside strings to `0x<addr>` before
   *  comparing, so two runs of the same program do not differ by where the
   *  allocator put an object. Default true; false compares them verbatim. */
  normalize_addresses?: boolean;
  /** Max samples returned per category. Default 10. Counts are always exact. */
  limit?: number;
  /** Max spans folded per trace. Past it the comparison is incomplete. */
  max_spans?: number;
  /** LCS budget (table cells) for one sibling list. */
  max_list_cells?: number;
  /** LCS budget (table cells) for the whole comparison. */
  max_align_cells?: number;
  /** Depth past which a value diff is reported as one clipped blob. */
  max_value_depth?: number;
  /** Max characters of any value shown in a sample. */
  max_string_length?: number;
}

const DEFAULTS = {
  limit: 10,
  max_spans: 2_000_000,
  max_list_cells: 4_000_000,
  max_align_cells: 50_000_000,
  max_value_depth: 6,
  max_string_length: 120,
};

/** Value-diff entries shown per sample; the rest are counted in `more`. */
const MAX_DIFF_ENTRIES = 6;
/** Call-path elements shown per sample before the middle is elided. */
const MAX_PATH = 12;
/** Lookahead of the greedy alignment used once the LCS budget is spent. */
const GREEDY_WINDOW = 32;

// -- result ----------------------------------------------------------------

export interface ValueChange {
  /** Dotted path of the differing key, rooted at `args` or `result`. */
  path: string;
  before: unknown;
  after: unknown;
  /** One side is a `<truncated:…>` marker: only the kept prefix was compared. */
  truncated?: true;
}

export interface CallSample {
  /** Calls from the root down to this one, as `module.class.method`. */
  path: string[];
  call: string;
  /** Spans in the added / removed subtree, this call included. */
  spans?: number;
  args?: string;
  diff?: ValueChange[];
  /** Value changes not listed in `diff`. */
  more?: number;
  truncated?: true;
  /** On an args_changed sample: the result differs as well. */
  result_changed?: true;
  before?: unknown;
  after?: unknown;
  /** calls_reordered: position among the siblings, before and after. */
  from?: number;
  to?: number;
}

export interface CountChange { method: string; before: number; after: number; }

export interface BehaviorSummary {
  calls_added: number;
  calls_removed: number;
  calls_reordered: number;
  args_changed: number;
  result_changed: number;
  error_changed: number;
  error_msg_changed: number;
  count_changed: number;
}

export interface BehaviorDiff {
  verdict: "same" | "different";
  summary: BehaviorSummary;
  spans_a: number;
  spans_b: number;
  /** Span pairs actually compared (identical subtrees count in full). */
  compared_spans: number;
  /** False when a cap left part of a trace out: "same" is then unproven. */
  complete: boolean;
  /** A cap was hit — see `truncated_reasons`. */
  truncated: boolean;
  truncated_reasons?: string[];
  /** Values that compared equal while clipped by the capture layer: equal as
   *  far as the kept prefix goes, unknown beyond it. */
  truncated_values: number;
  /** Sibling lists aligned greedily because the LCS budget ran out. */
  approximate_alignments: number;
  order: "strict" | "ignored";
  ignored: { spans_a: number; spans_b: number; keys_a: number; keys_b: number };
  samples: {
    calls_added: CallSample[];
    calls_removed: CallSample[];
    calls_reordered: CallSample[];
    args_changed: CallSample[];
    result_changed: CallSample[];
    error_changed: CallSample[];
    error_msg_changed: CallSample[];
    count_changed: CountChange[];
  };
  /** Differences counted in `summary` but not shown in `samples`. */
  omitted: Partial<Record<keyof BehaviorSummary, number>>;
  notes: string[];
}

// -- normalisation ---------------------------------------------------------

// Mirrors IDENTITY_HASH in scripts/golden/normalize.mjs — Java's default
// Object.toString() renders `com.foo.Bar@1b6d3586`, and the suffix changes on
// every JVM run. That file is plain ESM run from the repo root and this one is
// TypeScript bundled into two shipped artifacts, so the rule is mirrored rather
// than imported; change them together.
const IDENTITY_HASH = /@[0-9a-f]{4,}\b/g;
// Memory addresses in opaque renderings: Python's `<Foo object at 0x7f3a…>`,
// Go's and Rust's printed pointers. Eight or more hex digits, so a small hex
// constant (`0xff`, `0x1F4`) is still compared verbatim.
// `... at 0x<hex>` of any length is one too: static objects sit low in the
// image (`<built-in method finditer ... at 0xbc0d210>`, seven digits).
const ADDRESS = /\b0x[0-9a-fA-F]{8,16}\b|(?<=\bat )0x[0-9a-fA-F]+\b/g;
// An address the capture layer's truncation cut in half: `...at 0x7f727...>`.
// The cut lands at the same offset in both runs but after a different number
// of digits' worth of entropy, so the prefix differs and is shorter than
// ADDRESS requires. Only at the very end of a truncation marker, where the
// text is an arbitrary prefix anyway.
const CUT_ADDRESS = /\b0x[0-9a-fA-F]*(?=\.\.\.>$)/;

function normaliseString(s: string, addresses = true): string {
  let out = s;
  if (out.indexOf("@") !== -1) out = out.replace(IDENTITY_HASH, "@<identity>");
  if (addresses && out.indexOf("0x") !== -1) {
    out = out.replace(ADDRESS, "0x<addr>");
    if (isTruncatedMarker(out)) out = out.replace(CUT_ADDRESS, "0x<addr>");
  }
  return out;
}

/** The marker documented in TRUNCATION_SYSTEM.md: `<truncated:{prefix}...>`. */
function isTruncatedMarker(s: string): boolean {
  return s.length > 15 && s.startsWith("<truncated:") && s.endsWith("...>");
}

function globToRegExp(glob: string): RegExp {
  let re = "";
  for (const ch of glob) {
    if (ch === "*") re += ".*";
    else if (ch === "?") re += ".";
    else re += ch.replace(/[\\^$+.()|[\]{}]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "s");
}

// -- tree ------------------------------------------------------------------

interface Node {
  key: number;
  /** Canonical JSON of the normalised args ("" when absent or ignored). */
  args: string;
  /** Canonical JSON of the normalised result; null until the exit is seen. */
  result: string | null;
  errType: string;
  errMsg: string;
  parent: Node | null;
  kids: Node[] | null;
  hash: string;
  /** Spans in this subtree, this node included. */
  size: number;
  /** `<truncated:…>` markers in this node's own args / result. */
  truncArgs: number;
  truncResult: number;
  /** Markers in the whole subtree. */
  truncSub: number;
  /** Position among its siblings. */
  index: number;
}

/** Sentinels in the span table: the span was dropped — by an ignore rule or by
 *  the span cap — so everything under it is dropped too, for the same reason. */
const IGNORED = 0;
const OVER_CAP = 1;
type Slot = Node | typeof IGNORED | typeof OVER_CAP;

/** Method keys shared by the two trees of one comparison, so identity is an
 *  integer compare inside the alignment loop. */
class KeyTable {
  private ids = new Map<string, number>();
  readonly display: string[] = [];
  readonly ignored: boolean[] = [];
  constructor(private readonly ignoreMethods: RegExp[]) {}

  id(lang: unknown, module: unknown, cls: unknown, method: unknown): number {
    const m = typeof module === "string" ? module : "";
    const c = typeof cls === "string" ? cls : "";
    const f = typeof method === "string" ? method : "";
    const raw = `${typeof lang === "string" ? lang : ""}\u001f${m}\u001f${c}\u001f${f}`;
    let id = this.ids.get(raw);
    if (id === undefined) {
      id = this.display.length;
      this.ids.set(raw, id);
      // Same rendering trace_diff uses: empty parts dropped.
      const name = [m, c, f].filter(Boolean).join(".");
      this.display.push(name);
      this.ignored.push(this.ignoreMethods.some((re) => re.test(name)));
    }
    return id;
  }
}

interface KeyRules {
  /** Bare names, matched at any depth. */
  names: Set<string>;
  /** Bare globs, matched at any depth. */
  globs: RegExp[];
  /** Anchored paths, as segments; `*` matches one segment. */
  paths: string[][];
  dropArgs: boolean;
  dropResult: boolean;
}

function compileKeyRules(specs: string[]): KeyRules {
  const rules: KeyRules = { names: new Set(), globs: [], paths: [], dropArgs: false, dropResult: false };
  for (const raw of specs) {
    const spec = typeof raw === "string" ? raw.trim() : "";
    if (!spec) continue;
    if (spec === "args") { rules.dropArgs = true; continue; }
    if (spec === "result") { rules.dropResult = true; continue; }
    if (spec.startsWith("args.") || spec.startsWith("result.")) {
      rules.paths.push(spec.split("."));
    } else if (spec.includes("*") || spec.includes("?")) {
      rules.globs.push(globToRegExp(spec));
    } else {
      rules.names.add(spec);
    }
  }
  return rules;
}

function pathMatches(pattern: string[], path: string[], last: string): boolean {
  if (pattern.length !== path.length + 1) return false;
  for (let i = 0; i < path.length; i++) {
    if (pattern[i] !== "*" && pattern[i] !== path[i]) return false;
  }
  const tail = pattern[pattern.length - 1];
  return tail === "*" || tail === last;
}

/** One trace, folded event by event. Obtain it from `BehaviorDiffer.tree()`. */
export class BehaviorTree {
  /** Every kept node, in enter order — children always after their parent. */
  readonly nodes: Node[] = [];
  readonly roots: Node[] = [];
  /** Calls per method key, over the whole trace (not capped). */
  readonly counts = new Map<number, number>();
  private spans = new Map<string, Slot>();
  private threads = new Set<string>();
  ignoredSpans = 0;
  ignoredKeys = 0;
  overCap = 0;
  orphanExits = 0;
  unfinished = 0;
  events = 0;
  private finished = false;
  // Scratch for the value being canonicalised.
  private trunc = 0;

  constructor(
    private readonly keys: KeyTable,
    private readonly rules: KeyRules,
    private readonly maxSpans: number,
    private readonly compareErrorMsg: boolean,
    private readonly ignoreOrder: boolean,
    private readonly addresses: boolean = true,
  ) {}

  get threadCount(): number { return this.threads.size; }

  /** Fold one parsed event. Anything that is not a v2 enter/exit is skipped. */
  add(ev: unknown): void {
    if (ev === null || typeof ev !== "object") return;
    const e = ev as Record<string, unknown>;
    const span = e.span_id;
    if (typeof span !== "string") return;
    this.events++;

    if (e.event === "enter") {
      const key = this.keys.id(e.lang, e.module, e.class, e.method);
      const parentId = e.parent_id;
      const parent = typeof parentId === "string" ? this.spans.get(parentId) : undefined;
      // A parent this file never saw (a remote caller, or a clipped trace)
      // makes the span a root. A parent that was dropped drops the child.
      if (parent === IGNORED || this.keys.ignored[key]) { this.spans.set(span, IGNORED); this.ignoredSpans++; return; }
      this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
      if (parent === OVER_CAP || this.nodes.length >= this.maxSpans) { this.spans.set(span, OVER_CAP); this.overCap++; return; }
      if (typeof e.thread === "string" && this.threads.size < 4096) this.threads.add(e.thread);

      this.trunc = 0;
      const args = this.rules.dropArgs || e.args === undefined ? "" : this.canon(e.args, "args");
      const node: Node = {
        key, args, result: null, errType: "", errMsg: "",
        parent: parent ?? null, kids: null, hash: "", size: 1,
        truncArgs: this.trunc, truncResult: 0, truncSub: 0, index: 0,
      };
      const siblings = parent ? (parent.kids ??= []) : this.roots;
      node.index = siblings.length;
      siblings.push(node);
      this.nodes.push(node);
      this.spans.set(span, node);
      return;
    }

    if (e.event === "exit") {
      const node = this.spans.get(span);
      if (node === IGNORED || node === OVER_CAP) return;
      if (node === undefined) { this.orphanExits++; return; }
      this.trunc = 0;
      node.result = this.rules.dropResult || e.result === undefined ? "" : this.canon(e.result, "result");
      node.truncResult = this.trunc;
      const err = e.error;
      if (err !== null && typeof err === "object") {
        const { type, msg } = err as Record<string, unknown>;
        // `stack` is never compared: frames carry line numbers and absolute
        // paths, which a refactor and a different machine both change.
        node.errType = typeof type === "string" && type ? type : "<error>";
        node.errMsg = typeof msg === "string" ? normaliseString(msg, this.addresses) : "";
      }
    }
  }

  /** Canonical JSON: keys sorted, ignored keys dropped, unstable renderings
   *  normalised. Two values are behaviourally equal iff these strings are. */
  private canon(value: unknown, root: string): string {
    const anchored = this.rules.paths.length > 0;
    return this.canonValue(value, anchored ? [root] : null, 0);
  }

  private canonValue(v: unknown, path: string[] | null, depth: number): string {
    if (typeof v === "string") {
      if (isTruncatedMarker(v)) this.trunc++;
      return JSON.stringify(normaliseString(v, this.addresses));
    }
    if (v === null || v === undefined) return "null";
    if (typeof v !== "object") return JSON.stringify(v) ?? "null";
    // Parsed JSON cannot be cyclic, but it can be absurdly deep.
    if (depth > 200) return JSON.stringify(normaliseString(JSON.stringify(v), this.addresses));
    if (Array.isArray(v)) {
      let out = "[";
      for (let i = 0; i < v.length; i++) {
        if (i) out += ",";
        if (path) path.push(String(i));
        out += this.canonValue(v[i], path, depth + 1);
        if (path) path.pop();
      }
      return out + "]";
    }
    const obj = v as Record<string, unknown>;
    const names = Object.keys(obj).sort();
    let out = "{";
    let first = true;
    for (const name of names) {
      if (this.isIgnoredKey(name, path)) { this.ignoredKeys++; continue; }
      if (!first) out += ",";
      first = false;
      if (path) path.push(name);
      out += JSON.stringify(name) + ":" + this.canonValue(obj[name], path, depth + 1);
      if (path) path.pop();
    }
    return out + "}";
  }

  private isIgnoredKey(name: string, path: string[] | null): boolean {
    const r = this.rules;
    if (r.names.has(name)) return true;
    for (const re of r.globs) if (re.test(name)) return true;
    if (path) for (const p of r.paths) if (pathMatches(p, path, name)) return true;
    return false;
  }

  /** Hash every subtree. Idempotent; called by `BehaviorDiffer.diff`. */
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.spans = new Map();
    // Children always sit after their parent in `nodes`, so a reverse pass
    // sees every child before its parent — no recursion, whatever the depth.
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i];
      if (n.result === null) this.unfinished++;
      const h = createHash("md5");
      h.update(String(n.key));
      h.update("\u0001");
      h.update(n.args);
      h.update(n.result === null ? "\u0000noexit" : "\u0001" + n.result);
      h.update("\u0001");
      h.update(n.errType);
      if (this.compareErrorMsg) { h.update("\u0001"); h.update(n.errMsg); }
      let trunc = n.truncArgs + n.truncResult;
      let size = 1;
      if (n.kids) {
        h.update("\u0002");
        if (this.ignoreOrder) {
          const hashes = n.kids.map((k) => k.hash).sort();
          for (const kh of hashes) h.update(kh);
        } else {
          for (const k of n.kids) h.update(k.hash);
        }
        for (const k of n.kids) { size += k.size; trunc += k.truncSub; }
      }
      n.hash = h.digest("base64");
      n.size = size;
      n.truncSub = trunc;
    }
  }
}

// -- comparison ------------------------------------------------------------

const NO_KIDS: Node[] = [];

export class BehaviorDiffer {
  private readonly opts: Required<Omit<BehaviorDiffOptions, "ignore_methods" | "ignore_keys">>;
  private readonly keys: KeyTable;
  private readonly rules: KeyRules;

  constructor(options: BehaviorDiffOptions = {}) {
    const positive = (v: unknown, d: number) =>
      typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : d;
    this.opts = {
      ignore_order: options.ignore_order === true,
      compare_error_msg: options.compare_error_msg !== false,
      normalize_addresses: options.normalize_addresses !== false,
      limit: typeof options.limit === "number" && options.limit >= 0 ? Math.floor(options.limit) : DEFAULTS.limit,
      max_spans: positive(options.max_spans, DEFAULTS.max_spans),
      max_list_cells: positive(options.max_list_cells, DEFAULTS.max_list_cells),
      max_align_cells: positive(options.max_align_cells, DEFAULTS.max_align_cells),
      max_value_depth: positive(options.max_value_depth, DEFAULTS.max_value_depth),
      max_string_length: positive(options.max_string_length, DEFAULTS.max_string_length),
    };
    this.keys = new KeyTable((options.ignore_methods ?? []).filter((g) => typeof g === "string" && g).map(globToRegExp));
    this.rules = compileKeyRules(options.ignore_keys ?? []);
  }

  /** A fresh, empty tree. Feed it one trace with `add`, in file order. */
  tree(): BehaviorTree {
    return new BehaviorTree(this.keys, this.rules, this.opts.max_spans, this.opts.compare_error_msg, this.opts.ignore_order, this.opts.normalize_addresses);
  }

  /** Compare a baseline tree (A) against a current one (B). */
  diff(a: BehaviorTree, b: BehaviorTree): BehaviorDiff {
    a.finish();
    b.finish();
    const o = this.opts;
    const names = this.keys.display;

    const summary: BehaviorSummary = {
      calls_added: 0, calls_removed: 0, calls_reordered: 0, args_changed: 0,
      result_changed: 0, error_changed: 0, error_msg_changed: 0, count_changed: 0,
    };
    const samples: BehaviorDiff["samples"] = {
      calls_added: [], calls_removed: [], calls_reordered: [], args_changed: [],
      result_changed: [], error_changed: [], error_msg_changed: [], count_changed: [],
    };
    let compared = 0;
    let truncatedValues = 0;
    let cellsUsed = 0;
    let approximate = 0;

    const wants = (cat: keyof BehaviorDiff["samples"]) => samples[cat].length < o.limit;

    const pathOf = (n: Node): string[] => {
      const out: string[] = [];
      for (let c: Node | null = n; c; c = c.parent) out.push(names[c.key]);
      out.reverse();
      if (out.length <= MAX_PATH) return out;
      const head = out.slice(0, 3);
      const tail = out.slice(out.length - (MAX_PATH - 4));
      return [...head, `…(+${out.length - head.length - tail.length})`, ...tail];
    };

    const clip = (s: string): string =>
      s.length <= o.max_string_length ? s : `${s.slice(0, o.max_string_length)}…(+${s.length - o.max_string_length} chars)`;

    /** Two long strings usually differ far past the clip point; show the
     *  window around the first difference instead of two identical heads. */
    const clipPair = (x: string, y: string): [string, string] => {
      const max = o.max_string_length;
      if (x.length <= max && y.length <= max) return [x, y];
      let d = 0;
      const lim = Math.min(x.length, y.length);
      while (d < lim && x.charCodeAt(d) === y.charCodeAt(d)) d++;
      const start = Math.max(0, d - Math.floor(max / 4));
      const cut = (s: string) => {
        const body = s.slice(start, start + max);
        const rest = s.length - (start + body.length);
        return (start > 0 ? `…(${start} chars)` : "") + body + (rest > 0 ? `…(+${rest} chars)` : "");
      };
      return [cut(x), cut(y)];
    };

    const show = (v: unknown): unknown => {
      if (v === undefined) return "<absent>";
      if (typeof v === "string") return clip(v);
      if (v === null || typeof v !== "object") return v;
      return clip(JSON.stringify(v));
    };

    const isMarker = (v: unknown) => typeof v === "string" && isTruncatedMarker(v);

    const valueDiff = (x: unknown, y: unknown, path: string, depth: number, out: ValueChange[], state: { more: number }) => {
      const push = (before: unknown, after: unknown) => {
        if (out.length >= MAX_DIFF_ENTRIES) { state.more++; return; }
        const entry: ValueChange = { path, before, after };
        if (isMarker(x) || isMarker(y)) entry.truncated = true;
        out.push(entry);
      };
      const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
      if (depth < o.max_value_depth) {
        if (isObj(x) && isObj(y)) {
          const all = [...new Set([...Object.keys(x), ...Object.keys(y)])].sort();
          for (const k of all) {
            const xv = x[k], yv = y[k];
            if (xv === yv) continue;
            if (xv !== undefined && yv !== undefined && JSON.stringify(xv) === JSON.stringify(yv)) continue;
            valueDiff(xv, yv, `${path}.${k}`, depth + 1, out, state);
          }
          return;
        }
        if (Array.isArray(x) && Array.isArray(y)) {
          const len = Math.max(x.length, y.length);
          for (let i = 0; i < len; i++) {
            const xv = x[i], yv = y[i];
            if (i < x.length && i < y.length && JSON.stringify(xv) === JSON.stringify(yv)) continue;
            valueDiff(i < x.length ? xv : undefined, i < y.length ? yv : undefined, `${path}.${i}`, depth + 1, out, state);
          }
          return;
        }
      }
      const composite = (v: unknown) => v !== null && typeof v === "object";
      if (typeof x === "string" && typeof y === "string") {
        const [bx, by] = clipPair(x, y);
        push(bx, by);
      } else if (composite(x) && composite(y)) {
        const [bx, by] = clipPair(JSON.stringify(x), JSON.stringify(y));
        push(bx, by);
      } else {
        push(show(x), show(y));
      }
    };

    const parse = (canon: string | null): unknown => {
      if (canon === null) return "<no exit>";
      if (canon === "") return undefined;
      return JSON.parse(canon);
    };

    const diffCanon = (x: string | null, y: string | null, root: string) => {
      const out: ValueChange[] = [];
      const state = { more: 0 };
      valueDiff(parse(x), parse(y), root, 0, out, state);
      return { out, more: state.more };
    };

    const callSample = (n: Node): CallSample => ({ path: pathOf(n), call: names[n.key] });

    /** One aligned pair whose hashes differ: compare the calls themselves.
     *  The children are the caller's business. */
    const comparePair = (x: Node, y: Node) => {
      compared++;
      const argsEqual = x.args === y.args;
      const resultEqual = x.result === y.result;
      const errTypeEqual = x.errType === y.errType;

      if (argsEqual) truncatedValues += x.truncArgs;
      if (resultEqual) truncatedValues += x.truncResult;

      if (!argsEqual) {
        summary.args_changed++;
        if (wants("args_changed")) {
          const { out, more } = diffCanon(x.args, y.args, "args");
          const s = callSample(x);
          s.diff = out;
          if (more) s.more = more;
          if (x.truncArgs || y.truncArgs) s.truncated = true;
          if (!resultEqual) s.result_changed = true;
          samples.args_changed.push(s);
        }
      }

      if (!errTypeEqual) {
        summary.error_changed++;
        if (wants("error_changed")) {
          const s = callSample(x);
          s.before = x.errType ? { type: x.errType, msg: clip(x.errMsg) } : null;
          s.after = y.errType ? { type: y.errType, msg: clip(y.errMsg) } : null;
          if (x.args) s.args = clip(x.args);
          samples.error_changed.push(s);
        }
      } else if (o.compare_error_msg && x.errMsg !== y.errMsg) {
        summary.error_msg_changed++;
        if (wants("error_msg_changed")) {
          const s = callSample(x);
          const [bx, by] = clipPair(x.errMsg, y.errMsg);
          s.before = { type: x.errType, msg: bx };
          s.after = { type: y.errType, msg: by };
          samples.error_msg_changed.push(s);
        }
      }

      // Only "same arguments, different answer" is a result change. With the
      // arguments already different, or a call that now fails, a different
      // result is the consequence and is reported there.
      if (argsEqual && errTypeEqual && !resultEqual) {
        summary.result_changed++;
        if (wants("result_changed")) {
          const { out, more } = diffCanon(x.result, y.result, "result");
          const s = callSample(x);
          s.diff = out;
          if (more) s.more = more;
          if (x.truncResult || y.truncResult) s.truncated = true;
          if (x.args) s.args = clip(x.args);
          samples.result_changed.push(s);
        }
      }
    };

    const gone = (cat: "calls_added" | "calls_removed", n: Node) => {
      summary[cat]++;
      if (!wants(cat)) return;
      const s = callSample(n);
      s.spans = n.size;
      if (n.args) s.args = clip(n.args);
      samples[cat].push(s);
    };

    /**
     * LCS over two index lists into sibling arrays, appending matched index
     * pairs. `exact` matches identical subtrees only; otherwise calls of the
     * same identity match, an identical one scoring double.
     */
    const lcs = (A: Node[], B: Node[], ai: number[], bi: number[], exact: boolean, pairs: number[]) => {
      const m = ai.length, n = bi.length;
      const w = n + 1;
      const table = 2 * Math.min(m, n) < 65535 ? new Uint16Array((m + 1) * w) : new Uint32Array((m + 1) * w);
      const score = (x: Node, y: Node): number =>
        exact ? (x.hash === y.hash ? 1 : 0) : x.key !== y.key ? 0 : x.hash === y.hash ? 2 : 1;
      for (let i = m - 1; i >= 0; i--) {
        const x = A[ai[i]];
        const row = i * w, next = row + w;
        for (let j = n - 1; j >= 0; j--) {
          let best = table[next + j];
          const right = table[row + j + 1];
          if (right > best) best = right;
          const s = score(x, B[bi[j]]);
          if (s) {
            const diag = table[next + j + 1] + s;
            if (diag > best) best = diag;
          }
          table[row + j] = best;
        }
      }
      let i = 0, j = 0;
      while (i < m && j < n) {
        const s = score(A[ai[i]], B[bi[j]]);
        if (s && table[i * w + j] === table[(i + 1) * w + j + 1] + s) {
          pairs.push(ai[i], bi[j]);
          i++; j++;
        } else if (table[(i + 1) * w + j] >= table[i * w + j + 1]) {
          i++;
        } else {
          j++;
        }
      }
    };

    /** Linear fallback once the LCS budget is spent. It may pair calls an
     *  optimal alignment would not — over-reporting — but it never reports
     *  two different lists as equal. */
    const greedy = (A: Node[], B: Node[], ai: number[], bi: number[], pairs: number[]) => {
      const a1 = ai.length, b1 = bi.length;
      let i = 0, j = 0;
      while (i < a1 && j < b1) {
        const ka = A[ai[i]].key, kb = B[bi[j]].key;
        if (ka === kb) { pairs.push(ai[i], bi[j]); i++; j++; continue; }
        let dj = 0, di = 0;
        for (let d = 1; d <= GREEDY_WINDOW && j + d < b1; d++) if (B[bi[j + d]].key === ka) { dj = d; break; }
        for (let d = 1; d <= GREEDY_WINDOW && i + d < a1; d++) if (A[ai[i + d]].key === kb) { di = d; break; }
        if (!dj && !di) { i++; j++; }
        else if (dj && (!di || dj <= di)) j += dj;
        else i += di;
      }
    };

    /** Reserve LCS table cells; false once a budget would be exceeded. */
    const afford = (m: number, n: number): boolean => {
      const cells = (m + 1) * (n + 1);
      if (cells > o.max_list_cells || cellsUsed + cells > o.max_align_cells) return false;
      cellsUsed += cells;
      return true;
    };

    /** Align by identity, within budget; a 1x1 list needs no table. */
    const alignByKey = (A: Node[], B: Node[], ai: number[], bi: number[], pairs: number[]): boolean => {
      if (ai.length === 0 || bi.length === 0) return true;
      if (ai.length === 1 && bi.length === 1) {
        if (A[ai[0]].key === B[bi[0]].key) pairs.push(ai[0], bi[0]);
        return true;
      }
      if (afford(ai.length, bi.length)) { lcs(A, B, ai, bi, false, pairs); return true; }
      greedy(A, B, ai, bi, pairs);
      return false;
    };

    const range = (from: number, to: number): number[] => {
      const out = new Array<number>(to - from);
      for (let i = from; i < to; i++) out[i - from] = i;
      return out;
    };

    // Explicit work stack: a recursion as deep as the call tree would overflow
    // on exactly the traces (deep recursion) this has to survive.
    const work: Array<[Node[], Node[]]> = [[a.roots, b.roots]];
    for (let frame = work.pop(); frame; frame = work.pop()) {
      let [A, B] = frame;

      // Identical prefix and suffix, by subtree hash.
      let lo = 0;
      const minLen = Math.min(A.length, B.length);
      while (lo < minLen && A[lo].hash === B[lo].hash) {
        compared += A[lo].size; truncatedValues += A[lo].truncSub; lo++;
      }
      let ea = A.length, eb = B.length;
      while (ea > lo && eb > lo && A[ea - 1].hash === B[eb - 1].hash) {
        ea--; eb--;
        compared += A[ea].size; truncatedValues += A[ea].truncSub;
      }
      if (lo === ea && lo === eb) continue;

      if (o.ignore_order && ea > lo && eb > lo) {
        // Order is not part of the contract: pair identical subtrees wherever
        // they sit, then align what is left.
        const byHash = new Map<string, number[]>();
        for (let j = eb - 1; j >= lo; j--) {
          const list = byHash.get(B[j].hash);
          if (list) list.push(j); else byHash.set(B[j].hash, [j]);
        }
        const usedB = new Set<number>();
        const restA: Node[] = [];
        for (let i = lo; i < ea; i++) {
          const j = byHash.get(A[i].hash)?.pop();
          if (j === undefined) { restA.push(A[i]); continue; }
          usedB.add(j);
          compared += A[i].size; truncatedValues += A[i].truncSub;
        }
        const restB: Node[] = [];
        for (let j = lo; j < eb; j++) if (!usedB.has(j)) restB.push(B[j]);
        A = restA; B = restB; lo = 0; ea = A.length; eb = B.length;
      }

      // The middle. In three steps, because one weighted alignment cannot do
      // it: (1) anchor on identical subtrees in order; (2) an identical
      // subtree left over on both sides is a move — the one reordering that
      // can be told from a remove plus an add without guessing; (3) only then
      // pair what remains by identity, inside each gap between anchors, and
      // compare those pairs. Pairing by identity first would read a permuted
      // list of `task(n)` calls as five changed arguments.
      const sizeA = ea - lo, sizeB = eb - lo;
      const matchedA = new Uint8Array(sizeA);
      const matchedB = new Uint8Array(sizeB);
      const same = (x: Node) => { compared += x.size; truncatedValues += x.truncSub; };
      const pairs: number[] = [];
      let degraded = false;

      if (sizeA > 0 && sizeB > 0 && !o.ignore_order) {
        const inB = new Set<string>();
        for (let j = lo; j < eb; j++) inB.add(B[j].hash);
        let shared = false;
        for (let i = lo; i < ea && !shared; i++) shared = inB.has(A[i].hash);
        if (shared) {
          const anchors: number[] = [];
          if (afford(sizeA, sizeB)) {
            lcs(A, B, range(lo, ea), range(lo, eb), true, anchors);
          } else {
            // No budget for the anchors: one greedy pass by identity instead.
            degraded = true;
            greedy(A, B, range(lo, ea), range(lo, eb), pairs);
          }
          for (let p = 0; p < anchors.length; p += 2) {
            matchedA[anchors[p] - lo] = 2;          // 2 = anchor, a gap boundary
            matchedB[anchors[p + 1] - lo] = 2;
            same(A[anchors[p]]);
          }
          if (!degraded) {
            const leftB = new Map<string, number[]>();
            for (let j = eb - 1; j >= lo; j--) {
              if (matchedB[j - lo]) continue;
              const list = leftB.get(B[j].hash);
              if (list) list.push(j); else leftB.set(B[j].hash, [j]);
            }
            for (let i = lo; i < ea; i++) {
              if (matchedA[i - lo]) continue;
              const x = A[i];
              const j = leftB.get(x.hash)?.pop();
              if (j === undefined) continue;
              matchedA[i - lo] = 1;
              matchedB[j - lo] = 1;
              same(x);
              summary.calls_reordered++;
              if (wants("calls_reordered")) {
                const s = callSample(x);
                s.spans = x.size;
                s.from = x.index;
                s.to = B[j].index;
                if (x.args) s.args = clip(x.args);
                samples.calls_reordered.push(s);
              }
            }
          }
        }
      }

      if (!degraded && sizeA > 0 && sizeB > 0) {
        // Walk the gaps between anchors; the anchors are in order on both sides.
        let i = lo, j = lo;
        while (i < ea || j < eb) {
          const ga: number[] = [], gb: number[] = [];
          for (; i < ea; i++) {
            if (!matchedA[i - lo]) ga.push(i);
            else if (matchedA[i - lo] === 2) break;
          }
          for (; j < eb; j++) {
            if (!matchedB[j - lo]) gb.push(j);
            else if (matchedB[j - lo] === 2) break;
          }
          if (!alignByKey(A, B, ga, gb, pairs)) degraded = true;
          i++; j++;
        }
      }
      if (degraded) approximate++;

      for (let p = 0; p < pairs.length; p += 2) {
        const x = A[pairs[p]], y = B[pairs[p + 1]];
        matchedA[pairs[p] - lo] = 1;
        matchedB[pairs[p + 1] - lo] = 1;
        if (x.hash === y.hash) { same(x); continue; }
        comparePair(x, y);
        if (x.kids || y.kids) work.push([x.kids ?? NO_KIDS, y.kids ?? NO_KIDS]);
      }
      for (let i = lo; i < ea; i++) if (!matchedA[i - lo]) gone("calls_removed", A[i]);
      for (let j = lo; j < eb; j++) if (!matchedB[j - lo]) gone("calls_added", B[j]);
    }

    // Per-method call counts. Derived from the same facts as added/removed,
    // but counted over the WHOLE trace, so it still holds where a cap stopped
    // the structural comparison.
    const countRows: CountChange[] = [];
    const seen = new Set<number>([...a.counts.keys(), ...b.counts.keys()]);
    for (const key of seen) {
      const before = a.counts.get(key) ?? 0;
      const after = b.counts.get(key) ?? 0;
      if (before !== after) countRows.push({ method: names[key], before, after });
    }
    countRows.sort((x, y) =>
      Math.abs(y.after - y.before) - Math.abs(x.after - x.before) || (x.method < y.method ? -1 : x.method > y.method ? 1 : 0));
    summary.count_changed = countRows.length;
    samples.count_changed = countRows.slice(0, o.limit);

    const reasons: string[] = [];
    const complete = a.overCap === 0 && b.overCap === 0;
    if (!complete) {
      reasons.push(
        `span cap (${o.max_spans}) reached: ${a.overCap} span(s) of the baseline and ${b.overCap} of the current trace were not compared structurally (call counts still cover them)`);
    }
    if (approximate > 0) {
      reasons.push(
        `alignment budget exhausted on ${approximate} sibling list(s): aligned greedily, so some differences may be reported as remove+add instead of a change`);
    }

    const notes: string[] = [];
    if (truncatedValues > 0) {
      notes.push(
        `${truncatedValues} value(s) compared equal while truncated by the capture layer: equal up to the kept prefix only. Re-capture with a higher max-arg-length to compare them in full.`);
    }
    if (a.unfinished || b.unfinished) {
      notes.push(`spans with no exit event (still running or killed): ${a.unfinished} in the baseline, ${b.unfinished} in the current trace`);
    }
    if (a.orphanExits || b.orphanExits) {
      notes.push(`exit events with no matching enter were skipped: ${a.orphanExits} in the baseline, ${b.orphanExits} in the current trace`);
    }
    const structural = summary.calls_added + summary.calls_removed + summary.calls_reordered;
    if (!o.ignore_order && structural > 0 && (a.threadCount > 1 || b.threadCount > 1)) {
      notes.push(
        `the traces span several threads (${a.threadCount} / ${b.threadCount}): the order of calls across threads is not deterministic, so reordered or added/removed pairs may be scheduling, not behaviour. Compare with ignore_order to rule that out.`);
    }

    const omitted: BehaviorDiff["omitted"] = {};
    for (const cat of Object.keys(summary) as Array<keyof BehaviorSummary>) {
      const hidden = summary[cat] - samples[cat].length;
      if (hidden > 0) omitted[cat] = hidden;
    }

    const different = Object.values(summary).some((n) => n > 0);
    return {
      verdict: different ? "different" : "same",
      summary,
      spans_a: a.nodes.length + a.overCap,
      spans_b: b.nodes.length + b.overCap,
      compared_spans: compared,
      complete,
      truncated: reasons.length > 0,
      ...(reasons.length ? { truncated_reasons: reasons } : {}),
      truncated_values: truncatedValues,
      approximate_alignments: approximate,
      order: o.ignore_order ? "ignored" : "strict",
      ignored: { spans_a: a.ignoredSpans, spans_b: b.ignoredSpans, keys_a: a.ignoredKeys, keys_b: b.ignoredKeys },
      samples,
      omitted,
      notes,
    };
  }
}

/** Compare two traces held in memory. `a` is the baseline, `b` the current
 *  run. For traces too large to hold, feed `BehaviorDiffer.tree()` line by
 *  line instead — that is what `flowtrace diff` does. */
export function traceBehaviorDiff(
  a: Iterable<unknown>,
  b: Iterable<unknown>,
  options: BehaviorDiffOptions = {},
): BehaviorDiff {
  const differ = new BehaviorDiffer(options);
  const ta = differ.tree();
  for (const ev of a) ta.add(ev);
  const tb = differ.tree();
  for (const ev of b) tb.add(ev);
  return differ.diff(ta, tb);
}
