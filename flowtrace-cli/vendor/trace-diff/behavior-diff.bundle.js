// GENERATED FILE - DO NOT EDIT.
// Built from mcp-server/src/behavior-diff.ts by flowtrace-cli/scripts/bundle-diff.mjs.
// Run `make bundle-diff` after changing that file.

"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../mcp-server/src/behavior-diff.ts
var behavior_diff_exports = {};
__export(behavior_diff_exports, {
  BehaviorDiffer: () => BehaviorDiffer,
  BehaviorTree: () => BehaviorTree,
  traceBehaviorDiff: () => traceBehaviorDiff
});
module.exports = __toCommonJS(behavior_diff_exports);
var import_node_crypto = require("node:crypto");
var DEFAULTS = {
  limit: 10,
  max_spans: 2e6,
  max_list_cells: 4e6,
  max_align_cells: 5e7,
  max_value_depth: 6,
  max_string_length: 120
};
var MAX_DIFF_ENTRIES = 6;
var MAX_PATH = 12;
var GREEDY_WINDOW = 32;
var IDENTITY_HASH = /@[0-9a-f]{4,}\b/g;
var ADDRESS = /\b0x[0-9a-fA-F]{8,16}\b/g;
function normaliseString(s) {
  let out = s;
  if (out.indexOf("@") !== -1) out = out.replace(IDENTITY_HASH, "@<identity>");
  if (out.indexOf("0x") !== -1) out = out.replace(ADDRESS, "0x<addr>");
  return out;
}
function isTruncatedMarker(s) {
  return s.length > 15 && s.startsWith("<truncated:") && s.endsWith("...>");
}
function globToRegExp(glob) {
  let re = "";
  for (const ch of glob) {
    if (ch === "*") re += ".*";
    else if (ch === "?") re += ".";
    else re += ch.replace(/[\\^$+.()|[\]{}]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "s");
}
var IGNORED = 0;
var OVER_CAP = 1;
var KeyTable = class {
  constructor(ignoreMethods) {
    this.ignoreMethods = ignoreMethods;
  }
  ids = /* @__PURE__ */ new Map();
  display = [];
  ignored = [];
  id(lang, module2, cls, method) {
    const m = typeof module2 === "string" ? module2 : "";
    const c = typeof cls === "string" ? cls : "";
    const f = typeof method === "string" ? method : "";
    const raw = `${typeof lang === "string" ? lang : ""}${m}${c}${f}`;
    let id = this.ids.get(raw);
    if (id === void 0) {
      id = this.display.length;
      this.ids.set(raw, id);
      const name = [m, c, f].filter(Boolean).join(".");
      this.display.push(name);
      this.ignored.push(this.ignoreMethods.some((re) => re.test(name)));
    }
    return id;
  }
};
function compileKeyRules(specs) {
  const rules = { names: /* @__PURE__ */ new Set(), globs: [], paths: [], dropArgs: false, dropResult: false };
  for (const raw of specs) {
    const spec = typeof raw === "string" ? raw.trim() : "";
    if (!spec) continue;
    if (spec === "args") {
      rules.dropArgs = true;
      continue;
    }
    if (spec === "result") {
      rules.dropResult = true;
      continue;
    }
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
function pathMatches(pattern, path, last) {
  if (pattern.length !== path.length + 1) return false;
  for (let i = 0; i < path.length; i++) {
    if (pattern[i] !== "*" && pattern[i] !== path[i]) return false;
  }
  const tail = pattern[pattern.length - 1];
  return tail === "*" || tail === last;
}
var BehaviorTree = class {
  constructor(keys, rules, maxSpans, compareErrorMsg, ignoreOrder) {
    this.keys = keys;
    this.rules = rules;
    this.maxSpans = maxSpans;
    this.compareErrorMsg = compareErrorMsg;
    this.ignoreOrder = ignoreOrder;
  }
  /** Every kept node, in enter order — children always after their parent. */
  nodes = [];
  roots = [];
  /** Calls per method key, over the whole trace (not capped). */
  counts = /* @__PURE__ */ new Map();
  spans = /* @__PURE__ */ new Map();
  threads = /* @__PURE__ */ new Set();
  ignoredSpans = 0;
  ignoredKeys = 0;
  overCap = 0;
  orphanExits = 0;
  unfinished = 0;
  events = 0;
  finished = false;
  // Scratch for the value being canonicalised.
  trunc = 0;
  get threadCount() {
    return this.threads.size;
  }
  /** Fold one parsed event. Anything that is not a v2 enter/exit is skipped. */
  add(ev) {
    if (ev === null || typeof ev !== "object") return;
    const e = ev;
    const span = e.span_id;
    if (typeof span !== "string") return;
    this.events++;
    if (e.event === "enter") {
      const key = this.keys.id(e.lang, e.module, e.class, e.method);
      const parentId = e.parent_id;
      const parent = typeof parentId === "string" ? this.spans.get(parentId) : void 0;
      if (parent === IGNORED || this.keys.ignored[key]) {
        this.spans.set(span, IGNORED);
        this.ignoredSpans++;
        return;
      }
      this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
      if (parent === OVER_CAP || this.nodes.length >= this.maxSpans) {
        this.spans.set(span, OVER_CAP);
        this.overCap++;
        return;
      }
      if (typeof e.thread === "string" && this.threads.size < 4096) this.threads.add(e.thread);
      this.trunc = 0;
      const args = this.rules.dropArgs || e.args === void 0 ? "" : this.canon(e.args, "args");
      const node = {
        key,
        args,
        result: null,
        errType: "",
        errMsg: "",
        parent: parent ?? null,
        kids: null,
        hash: "",
        size: 1,
        truncArgs: this.trunc,
        truncResult: 0,
        truncSub: 0,
        index: 0
      };
      const siblings = parent ? parent.kids ??= [] : this.roots;
      node.index = siblings.length;
      siblings.push(node);
      this.nodes.push(node);
      this.spans.set(span, node);
      return;
    }
    if (e.event === "exit") {
      const node = this.spans.get(span);
      if (node === IGNORED || node === OVER_CAP) return;
      if (node === void 0) {
        this.orphanExits++;
        return;
      }
      this.trunc = 0;
      node.result = this.rules.dropResult || e.result === void 0 ? "" : this.canon(e.result, "result");
      node.truncResult = this.trunc;
      const err = e.error;
      if (err !== null && typeof err === "object") {
        const { type, msg } = err;
        node.errType = typeof type === "string" && type ? type : "<error>";
        node.errMsg = typeof msg === "string" ? normaliseString(msg) : "";
      }
    }
  }
  /** Canonical JSON: keys sorted, ignored keys dropped, unstable renderings
   *  normalised. Two values are behaviourally equal iff these strings are. */
  canon(value, root) {
    const anchored = this.rules.paths.length > 0;
    return this.canonValue(value, anchored ? [root] : null, 0);
  }
  canonValue(v, path, depth) {
    if (typeof v === "string") {
      if (isTruncatedMarker(v)) this.trunc++;
      return JSON.stringify(normaliseString(v));
    }
    if (v === null || v === void 0) return "null";
    if (typeof v !== "object") return JSON.stringify(v) ?? "null";
    if (depth > 200) return JSON.stringify(normaliseString(JSON.stringify(v)));
    if (Array.isArray(v)) {
      let out2 = "[";
      for (let i = 0; i < v.length; i++) {
        if (i) out2 += ",";
        if (path) path.push(String(i));
        out2 += this.canonValue(v[i], path, depth + 1);
        if (path) path.pop();
      }
      return out2 + "]";
    }
    const obj = v;
    const names = Object.keys(obj).sort();
    let out = "{";
    let first = true;
    for (const name of names) {
      if (this.isIgnoredKey(name, path)) {
        this.ignoredKeys++;
        continue;
      }
      if (!first) out += ",";
      first = false;
      if (path) path.push(name);
      out += JSON.stringify(name) + ":" + this.canonValue(obj[name], path, depth + 1);
      if (path) path.pop();
    }
    return out + "}";
  }
  isIgnoredKey(name, path) {
    const r = this.rules;
    if (r.names.has(name)) return true;
    for (const re of r.globs) if (re.test(name)) return true;
    if (path) {
      for (const p of r.paths) if (pathMatches(p, path, name)) return true;
    }
    return false;
  }
  /** Hash every subtree. Idempotent; called by `BehaviorDiffer.diff`. */
  finish() {
    if (this.finished) return;
    this.finished = true;
    this.spans = /* @__PURE__ */ new Map();
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i];
      if (n.result === null) this.unfinished++;
      const h = (0, import_node_crypto.createHash)("md5");
      h.update(String(n.key));
      h.update("");
      h.update(n.args);
      h.update(n.result === null ? "\0noexit" : "" + n.result);
      h.update("");
      h.update(n.errType);
      if (this.compareErrorMsg) {
        h.update("");
        h.update(n.errMsg);
      }
      let trunc = n.truncArgs + n.truncResult;
      let size = 1;
      if (n.kids) {
        h.update("");
        if (this.ignoreOrder) {
          const hashes = n.kids.map((k) => k.hash).sort();
          for (const kh of hashes) h.update(kh);
        } else {
          for (const k of n.kids) h.update(k.hash);
        }
        for (const k of n.kids) {
          size += k.size;
          trunc += k.truncSub;
        }
      }
      n.hash = h.digest("base64");
      n.size = size;
      n.truncSub = trunc;
    }
  }
};
var NO_KIDS = [];
var BehaviorDiffer = class {
  opts;
  keys;
  rules;
  constructor(options = {}) {
    const positive = (v, d) => typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : d;
    this.opts = {
      ignore_order: options.ignore_order === true,
      compare_error_msg: options.compare_error_msg !== false,
      limit: typeof options.limit === "number" && options.limit >= 0 ? Math.floor(options.limit) : DEFAULTS.limit,
      max_spans: positive(options.max_spans, DEFAULTS.max_spans),
      max_list_cells: positive(options.max_list_cells, DEFAULTS.max_list_cells),
      max_align_cells: positive(options.max_align_cells, DEFAULTS.max_align_cells),
      max_value_depth: positive(options.max_value_depth, DEFAULTS.max_value_depth),
      max_string_length: positive(options.max_string_length, DEFAULTS.max_string_length)
    };
    this.keys = new KeyTable((options.ignore_methods ?? []).filter((g) => typeof g === "string" && g).map(globToRegExp));
    this.rules = compileKeyRules(options.ignore_keys ?? []);
  }
  /** A fresh, empty tree. Feed it one trace with `add`, in file order. */
  tree() {
    return new BehaviorTree(this.keys, this.rules, this.opts.max_spans, this.opts.compare_error_msg, this.opts.ignore_order);
  }
  /** Compare a baseline tree (A) against a current one (B). */
  diff(a, b) {
    a.finish();
    b.finish();
    const o = this.opts;
    const names = this.keys.display;
    const summary = {
      calls_added: 0,
      calls_removed: 0,
      calls_reordered: 0,
      args_changed: 0,
      result_changed: 0,
      error_changed: 0,
      error_msg_changed: 0,
      count_changed: 0
    };
    const samples = {
      calls_added: [],
      calls_removed: [],
      calls_reordered: [],
      args_changed: [],
      result_changed: [],
      error_changed: [],
      error_msg_changed: [],
      count_changed: []
    };
    let compared = 0;
    let truncatedValues = 0;
    let cellsUsed = 0;
    let approximate = 0;
    const wants = (cat) => samples[cat].length < o.limit;
    const pathOf = (n) => {
      const out = [];
      for (let c = n; c; c = c.parent) out.push(names[c.key]);
      out.reverse();
      if (out.length <= MAX_PATH) return out;
      const head = out.slice(0, 3);
      const tail = out.slice(out.length - (MAX_PATH - 4));
      return [...head, `\u2026(+${out.length - head.length - tail.length})`, ...tail];
    };
    const clip = (s) => s.length <= o.max_string_length ? s : `${s.slice(0, o.max_string_length)}\u2026(+${s.length - o.max_string_length} chars)`;
    const clipPair = (x, y) => {
      const max = o.max_string_length;
      if (x.length <= max && y.length <= max) return [x, y];
      let d = 0;
      const lim = Math.min(x.length, y.length);
      while (d < lim && x.charCodeAt(d) === y.charCodeAt(d)) d++;
      const start = Math.max(0, d - Math.floor(max / 4));
      const cut = (s) => {
        const body = s.slice(start, start + max);
        const rest = s.length - (start + body.length);
        return (start > 0 ? `\u2026(${start} chars)` : "") + body + (rest > 0 ? `\u2026(+${rest} chars)` : "");
      };
      return [cut(x), cut(y)];
    };
    const show = (v) => {
      if (v === void 0) return "<absent>";
      if (typeof v === "string") return clip(v);
      if (v === null || typeof v !== "object") return v;
      return clip(JSON.stringify(v));
    };
    const isMarker = (v) => typeof v === "string" && isTruncatedMarker(v);
    const valueDiff = (x, y, path, depth, out, state) => {
      const push = (before, after) => {
        if (out.length >= MAX_DIFF_ENTRIES) {
          state.more++;
          return;
        }
        const entry = { path, before, after };
        if (isMarker(x) || isMarker(y)) entry.truncated = true;
        out.push(entry);
      };
      const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
      if (depth < o.max_value_depth) {
        if (isObj(x) && isObj(y)) {
          const all = [.../* @__PURE__ */ new Set([...Object.keys(x), ...Object.keys(y)])].sort();
          for (const k of all) {
            const xv = x[k], yv = y[k];
            if (xv === yv) continue;
            if (xv !== void 0 && yv !== void 0 && JSON.stringify(xv) === JSON.stringify(yv)) continue;
            valueDiff(xv, yv, `${path}.${k}`, depth + 1, out, state);
          }
          return;
        }
        if (Array.isArray(x) && Array.isArray(y)) {
          const len = Math.max(x.length, y.length);
          for (let i = 0; i < len; i++) {
            const xv = x[i], yv = y[i];
            if (i < x.length && i < y.length && JSON.stringify(xv) === JSON.stringify(yv)) continue;
            valueDiff(i < x.length ? xv : void 0, i < y.length ? yv : void 0, `${path}.${i}`, depth + 1, out, state);
          }
          return;
        }
      }
      const composite = (v) => v !== null && typeof v === "object";
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
    const parse = (canon) => {
      if (canon === null) return "<no exit>";
      if (canon === "") return void 0;
      return JSON.parse(canon);
    };
    const diffCanon = (x, y, root) => {
      const out = [];
      const state = { more: 0 };
      valueDiff(parse(x), parse(y), root, 0, out, state);
      return { out, more: state.more };
    };
    const callSample = (n) => ({ path: pathOf(n), call: names[n.key] });
    const comparePair = (x, y) => {
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
    const gone = (cat, n) => {
      summary[cat]++;
      if (!wants(cat)) return;
      const s = callSample(n);
      s.spans = n.size;
      if (n.args) s.args = clip(n.args);
      samples[cat].push(s);
    };
    const lcs = (A, B, ai, bi, exact, pairs) => {
      const m = ai.length, n = bi.length;
      const w = n + 1;
      const table = 2 * Math.min(m, n) < 65535 ? new Uint16Array((m + 1) * w) : new Uint32Array((m + 1) * w);
      const score = (x, y) => exact ? x.hash === y.hash ? 1 : 0 : x.key !== y.key ? 0 : x.hash === y.hash ? 2 : 1;
      for (let i2 = m - 1; i2 >= 0; i2--) {
        const x = A[ai[i2]];
        const row = i2 * w, next = row + w;
        for (let j2 = n - 1; j2 >= 0; j2--) {
          let best = table[next + j2];
          const right = table[row + j2 + 1];
          if (right > best) best = right;
          const s = score(x, B[bi[j2]]);
          if (s) {
            const diag = table[next + j2 + 1] + s;
            if (diag > best) best = diag;
          }
          table[row + j2] = best;
        }
      }
      let i = 0, j = 0;
      while (i < m && j < n) {
        const s = score(A[ai[i]], B[bi[j]]);
        if (s && table[i * w + j] === table[(i + 1) * w + j + 1] + s) {
          pairs.push(ai[i], bi[j]);
          i++;
          j++;
        } else if (table[(i + 1) * w + j] >= table[i * w + j + 1]) {
          i++;
        } else {
          j++;
        }
      }
    };
    const greedy = (A, B, ai, bi, pairs) => {
      const a1 = ai.length, b1 = bi.length;
      let i = 0, j = 0;
      while (i < a1 && j < b1) {
        const ka = A[ai[i]].key, kb = B[bi[j]].key;
        if (ka === kb) {
          pairs.push(ai[i], bi[j]);
          i++;
          j++;
          continue;
        }
        let dj = 0, di = 0;
        for (let d = 1; d <= GREEDY_WINDOW && j + d < b1; d++) if (B[bi[j + d]].key === ka) {
          dj = d;
          break;
        }
        for (let d = 1; d <= GREEDY_WINDOW && i + d < a1; d++) if (A[ai[i + d]].key === kb) {
          di = d;
          break;
        }
        if (!dj && !di) {
          i++;
          j++;
        } else if (dj && (!di || dj <= di)) j += dj;
        else i += di;
      }
    };
    const afford = (m, n) => {
      const cells = (m + 1) * (n + 1);
      if (cells > o.max_list_cells || cellsUsed + cells > o.max_align_cells) return false;
      cellsUsed += cells;
      return true;
    };
    const alignByKey = (A, B, ai, bi, pairs) => {
      if (ai.length === 0 || bi.length === 0) return true;
      if (ai.length === 1 && bi.length === 1) {
        if (A[ai[0]].key === B[bi[0]].key) pairs.push(ai[0], bi[0]);
        return true;
      }
      if (afford(ai.length, bi.length)) {
        lcs(A, B, ai, bi, false, pairs);
        return true;
      }
      greedy(A, B, ai, bi, pairs);
      return false;
    };
    const range = (from, to) => {
      const out = new Array(to - from);
      for (let i = from; i < to; i++) out[i - from] = i;
      return out;
    };
    const work = [[a.roots, b.roots]];
    for (let frame = work.pop(); frame; frame = work.pop()) {
      let [A, B] = frame;
      let lo = 0;
      const minLen = Math.min(A.length, B.length);
      while (lo < minLen && A[lo].hash === B[lo].hash) {
        compared += A[lo].size;
        truncatedValues += A[lo].truncSub;
        lo++;
      }
      let ea = A.length, eb = B.length;
      while (ea > lo && eb > lo && A[ea - 1].hash === B[eb - 1].hash) {
        ea--;
        eb--;
        compared += A[ea].size;
        truncatedValues += A[ea].truncSub;
      }
      if (lo === ea && lo === eb) continue;
      if (o.ignore_order && ea > lo && eb > lo) {
        const byHash = /* @__PURE__ */ new Map();
        for (let j = eb - 1; j >= lo; j--) {
          const list = byHash.get(B[j].hash);
          if (list) list.push(j);
          else byHash.set(B[j].hash, [j]);
        }
        const usedB = /* @__PURE__ */ new Set();
        const restA = [];
        for (let i = lo; i < ea; i++) {
          const j = byHash.get(A[i].hash)?.pop();
          if (j === void 0) {
            restA.push(A[i]);
            continue;
          }
          usedB.add(j);
          compared += A[i].size;
          truncatedValues += A[i].truncSub;
        }
        const restB = [];
        for (let j = lo; j < eb; j++) if (!usedB.has(j)) restB.push(B[j]);
        A = restA;
        B = restB;
        lo = 0;
        ea = A.length;
        eb = B.length;
      }
      const sizeA = ea - lo, sizeB = eb - lo;
      const matchedA = new Uint8Array(sizeA);
      const matchedB = new Uint8Array(sizeB);
      const same = (x) => {
        compared += x.size;
        truncatedValues += x.truncSub;
      };
      const pairs = [];
      let degraded = false;
      if (sizeA > 0 && sizeB > 0 && !o.ignore_order) {
        const inB = /* @__PURE__ */ new Set();
        for (let j = lo; j < eb; j++) inB.add(B[j].hash);
        let shared = false;
        for (let i = lo; i < ea && !shared; i++) shared = inB.has(A[i].hash);
        if (shared) {
          const anchors = [];
          if (afford(sizeA, sizeB)) {
            lcs(A, B, range(lo, ea), range(lo, eb), true, anchors);
          } else {
            degraded = true;
            greedy(A, B, range(lo, ea), range(lo, eb), pairs);
          }
          for (let p = 0; p < anchors.length; p += 2) {
            matchedA[anchors[p] - lo] = 2;
            matchedB[anchors[p + 1] - lo] = 2;
            same(A[anchors[p]]);
          }
          if (!degraded) {
            const leftB = /* @__PURE__ */ new Map();
            for (let j = eb - 1; j >= lo; j--) {
              if (matchedB[j - lo]) continue;
              const list = leftB.get(B[j].hash);
              if (list) list.push(j);
              else leftB.set(B[j].hash, [j]);
            }
            for (let i = lo; i < ea; i++) {
              if (matchedA[i - lo]) continue;
              const x = A[i];
              const j = leftB.get(x.hash)?.pop();
              if (j === void 0) continue;
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
        let i = lo, j = lo;
        while (i < ea || j < eb) {
          const ga = [], gb = [];
          for (; i < ea; i++) {
            if (!matchedA[i - lo]) ga.push(i);
            else if (matchedA[i - lo] === 2) break;
          }
          for (; j < eb; j++) {
            if (!matchedB[j - lo]) gb.push(j);
            else if (matchedB[j - lo] === 2) break;
          }
          if (!alignByKey(A, B, ga, gb, pairs)) degraded = true;
          i++;
          j++;
        }
      }
      if (degraded) approximate++;
      for (let p = 0; p < pairs.length; p += 2) {
        const x = A[pairs[p]], y = B[pairs[p + 1]];
        matchedA[pairs[p] - lo] = 1;
        matchedB[pairs[p + 1] - lo] = 1;
        if (x.hash === y.hash) {
          same(x);
          continue;
        }
        comparePair(x, y);
        if (x.kids || y.kids) work.push([x.kids ?? NO_KIDS, y.kids ?? NO_KIDS]);
      }
      for (let i = lo; i < ea; i++) if (!matchedA[i - lo]) gone("calls_removed", A[i]);
      for (let j = lo; j < eb; j++) if (!matchedB[j - lo]) gone("calls_added", B[j]);
    }
    const countRows = [];
    const seen = /* @__PURE__ */ new Set([...a.counts.keys(), ...b.counts.keys()]);
    for (const key of seen) {
      const before = a.counts.get(key) ?? 0;
      const after = b.counts.get(key) ?? 0;
      if (before !== after) countRows.push({ method: names[key], before, after });
    }
    countRows.sort((x, y) => Math.abs(y.after - y.before) - Math.abs(x.after - x.before) || (x.method < y.method ? -1 : x.method > y.method ? 1 : 0));
    summary.count_changed = countRows.length;
    samples.count_changed = countRows.slice(0, o.limit);
    const reasons = [];
    const complete = a.overCap === 0 && b.overCap === 0;
    if (!complete) {
      reasons.push(
        `span cap (${o.max_spans}) reached: ${a.overCap} span(s) of the baseline and ${b.overCap} of the current trace were not compared structurally (call counts still cover them)`
      );
    }
    if (approximate > 0) {
      reasons.push(
        `alignment budget exhausted on ${approximate} sibling list(s): aligned greedily, so some differences may be reported as remove+add instead of a change`
      );
    }
    const notes = [];
    if (truncatedValues > 0) {
      notes.push(
        `${truncatedValues} value(s) compared equal while truncated by the capture layer: equal up to the kept prefix only. Re-capture with a higher max-arg-length to compare them in full.`
      );
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
        `the traces span several threads (${a.threadCount} / ${b.threadCount}): the order of calls across threads is not deterministic, so reordered or added/removed pairs may be scheduling, not behaviour. Compare with ignore_order to rule that out.`
      );
    }
    const omitted = {};
    for (const cat of Object.keys(summary)) {
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
      ...reasons.length ? { truncated_reasons: reasons } : {},
      truncated_values: truncatedValues,
      approximate_alignments: approximate,
      order: o.ignore_order ? "ignored" : "strict",
      ignored: { spans_a: a.ignoredSpans, spans_b: b.ignoredSpans, keys_a: a.ignoredKeys, keys_b: b.ignoredKeys },
      samples,
      omitted,
      notes
    };
  }
};
function traceBehaviorDiff(a, b, options = {}) {
  const differ = new BehaviorDiffer(options);
  const ta = differ.tree();
  for (const ev of a) ta.add(ev);
  const tb = differ.tree();
  for (const ev of b) tb.add(ev);
  return differ.diff(ta, tb);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BehaviorDiffer,
  BehaviorTree,
  traceBehaviorDiff
});
