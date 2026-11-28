// FlowTrace v2 — unit tests for the behavioural comparison (trace_behavior_diff).
// Run with: node test/test-behavior-diff.mjs (after `npm run build`).
//
// These use hand-built events. The claims that matter most — two real runs of
// unchanged code compare "same", and a real behaviour change is named exactly —
// are in test-behavior-diff-capture.mjs, against the real capture layers.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { traceBehaviorDiff, BehaviorDiffer } from '../dist/behavior-diff.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

/**
 * Renders a nested call spec into the event stream a capture layer would
 * write: fresh random ids, a moving clock, random durations, shifted line
 * numbers — everything that legitimately differs between two runs.
 *
 * A call is { m: 'Class.method', args, result, error, kids, module, noExit }.
 */
function render(roots, { thread = 'main' } = {}) {
  const trace_id = randomBytes(16).toString('hex');
  let ts = 1.7e9 + Math.random() * 1e6;
  const events = [];
  const walk = (call, parent, depth) => {
    const span_id = randomBytes(8).toString('hex');
    const [cls, method] = call.m.includes('.') ? call.m.split('.') : ['', call.m];
    const base = {
      trace_id, span_id, parent_id: parent, thread: call.thread ?? thread, lang: call.lang ?? 'node',
      module: call.module ?? 'app', class: cls, method, visibility: 'public', depth,
    };
    ts += Math.random();
    events.push({
      ts, ...base, event: 'enter', args: call.args ?? {},
      file: 'src/app.js', line: Math.floor(Math.random() * 500),
    });
    for (const kid of call.kids ?? []) walk(kid, span_id, depth + 1);
    if (call.noExit) return;
    ts += Math.random();
    events.push({
      ts, ...base, event: 'exit', args: call.args ?? {}, result: call.result ?? {},
      duration_ns: Math.floor(Math.random() * 1e6),
      ...(call.error ? { error: { ...call.error, stack: [`at x (app.js:${Math.random()})`] } } : {}),
    });
  };
  for (const r of roots) walk(r, null, 0);
  return events;
}

const c = (m, args, result, kids, extra = {}) => ({ m, args, result, kids, ...extra });

/** A small order flow, used as the baseline by most tests. */
function flow(mutate = (x) => x) {
  return [mutate(c('Orders.create', { id: 7 }, { ok: true }, [
    c('Orders.validate', { id: 7 }, {}),
    c('Pricing.total', { items: [1, 2] }, { value: 30 }, [
      c('Pricing.tax', { amount: 30 }, { value: 3 }),
    ]),
    c('Repo.save', { order: { id: 7, total: 33 } }, { value: 'saved' }),
    c('Mailer.send', { to: 'ops' }, {}),
  ]))];
}

const ZERO = {
  calls_added: 0, calls_removed: 0, calls_reordered: 0, args_changed: 0,
  result_changed: 0, error_changed: 0, error_msg_changed: 0, count_changed: 0,
};

// -- identity --------------------------------------------------------------

test('two runs of the same flow (different ids, ts, durations, lines, threads) are the same', () => {
  const d = traceBehaviorDiff(render(flow()), render(flow(), { thread: 'worker-9' }));
  assert.equal(d.verdict, 'same');
  assert.deepEqual(d.summary, ZERO);
  assert.equal(d.spans_a, 6);
  assert.equal(d.spans_b, 6);
  assert.equal(d.compared_spans, 6, 'every span was compared');
  assert.equal(d.complete, true);
  assert.equal(d.truncated, false);
});

test('empty traces compare same with zero spans', () => {
  const d = traceBehaviorDiff([], []);
  assert.equal(d.verdict, 'same');
  assert.equal(d.spans_a, 0);
});

// -- value changes ---------------------------------------------------------

test('a changed result for the same args is result_changed, with only the differing key', () => {
  const b = flow((root) => {
    root.kids[1].kids[0].result = { value: 4, currency: 'EUR' };
    return root;
  });
  const a = flow((root) => {
    root.kids[1].kids[0].result = { value: 3, currency: 'EUR' };
    return root;
  });
  const d = traceBehaviorDiff(render(a), render(b));
  assert.equal(d.verdict, 'different');
  assert.deepEqual(d.summary, { ...ZERO, result_changed: 1 });
  const [s] = d.samples.result_changed;
  assert.deepEqual(s.path, ['app.Orders.create', 'app.Pricing.total', 'app.Pricing.tax']);
  assert.equal(s.call, 'app.Pricing.tax');
  assert.deepEqual(s.diff, [{ path: 'result.value', before: 3, after: 4 }], 'currency is equal and is not listed');
});

test('changed args are args_changed, and the dependent result is not double-counted', () => {
  const b = flow((root) => {
    root.kids[2].args = { order: { id: 7, total: 34 } };
    root.kids[2].result = { value: 'saved-34' };
    return root;
  });
  const d = traceBehaviorDiff(render(flow()), render(b));
  assert.deepEqual(d.summary, { ...ZERO, args_changed: 1 });
  const [s] = d.samples.args_changed;
  assert.equal(s.call, 'app.Repo.save');
  assert.deepEqual(s.diff, [{ path: 'args.order.total', before: 33, after: 34 }]);
  assert.equal(s.result_changed, true);
});

test('a key present on one side only is reported as <absent>', () => {
  const b = flow((root) => { root.result = { ok: true, warning: 'slow' }; return root; });
  const d = traceBehaviorDiff(render(flow()), render(b));
  assert.deepEqual(d.samples.result_changed[0].diff, [{ path: 'result.warning', before: '<absent>', after: 'slow' }]);
});

test('array element changes are reported by index', () => {
  const b = flow((root) => { root.kids[1].args = { items: [1, 5] }; return root; });
  const d = traceBehaviorDiff(render(flow()), render(b));
  assert.deepEqual(d.samples.args_changed[0].diff, [{ path: 'args.items.1', before: 2, after: 5 }]);
});

test('long values are clipped around the first difference, and deep values past max_value_depth as one blob', () => {
  const long = (ch) => 'x'.repeat(500) + ch + 'y'.repeat(500);
  const a = [c('f', { blob: long('A') }, {})];
  const b = [c('f', { blob: long('B') }, {})];
  const d = traceBehaviorDiff(render(a), render(b), { max_string_length: 40 });
  const [e] = d.samples.args_changed[0].diff;
  assert.ok(e.before.includes('A') && e.after.includes('B'), 'the window shows the differing character');
  assert.ok(e.before.length < 100, `clipped (${e.before.length})`);

  const deep = (v) => ({ a: { b: { c: { d: v } } } });
  const d2 = traceBehaviorDiff(render([c('f', deep(1), {})]), render([c('f', deep(2), {})]), { max_value_depth: 2 });
  assert.deepEqual(d2.samples.args_changed[0].diff, [{ path: 'args.a.b', before: '{"c":{"d":1}}', after: '{"c":{"d":2}}' }]);
});

test('key order inside args/result is irrelevant', () => {
  const a = [c('f', { a: 1, b: { x: 1, y: 2 } }, {})];
  const b = [c('f', { b: { y: 2, x: 1 }, a: 1 }, {})];
  assert.equal(traceBehaviorDiff(render(a), render(b)).verdict, 'same');
});

// -- structure -------------------------------------------------------------

test('a call added in the middle does not cascade into the later siblings', () => {
  const b = flow((root) => {
    root.kids.splice(1, 0, c('Audit.log', { what: 'create' }, {}, [c('Audit.write', {}, {})]));
    return root;
  });
  const d = traceBehaviorDiff(render(flow()), render(b));
  assert.deepEqual(d.summary, { ...ZERO, calls_added: 1, count_changed: 2 });
  const [s] = d.samples.calls_added;
  assert.deepEqual(s.path, ['app.Orders.create', 'app.Audit.log']);
  assert.equal(s.spans, 2, 'the added subtree is one added call of two spans');
  assert.deepEqual(d.samples.count_changed, [
    { method: 'app.Audit.log', before: 0, after: 1 },
    { method: 'app.Audit.write', before: 0, after: 1 },
  ]);
  assert.equal(d.compared_spans, 6);
});

test('a removed call is calls_removed, once, with its subtree size', () => {
  const b = flow((root) => { root.kids.splice(1, 1); return root; });
  const d = traceBehaviorDiff(render(flow()), render(b));
  assert.deepEqual(d.summary, { ...ZERO, calls_removed: 1, count_changed: 2 });
  assert.equal(d.samples.calls_removed[0].call, 'app.Pricing.total');
  assert.equal(d.samples.calls_removed[0].spans, 2);
});

test('removing the first of several same-method calls removes that one, not the last', () => {
  const loop = (ns) => [c('run', {}, {}, ns.map((n) => c('step', { n }, { value: n * 2 })))];
  const d = traceBehaviorDiff(render(loop([1, 2, 3, 4])), render(loop([2, 3, 4])));
  assert.deepEqual(d.summary, { ...ZERO, calls_removed: 1, count_changed: 1 });
  assert.equal(d.samples.calls_removed[0].args, '{"n":1}');
});

test('an insertion plus a change later in the same list are both found', () => {
  const loop = (items) => [c('run', {}, {}, items)];
  const a = loop([c('a', {}, {}), c('b', {}, {}), c('cc', { n: 1 }, { value: 1 }), c('d', {}, {})]);
  const b = loop([c('a', {}, {}), c('new', {}, {}), c('b', {}, {}), c('cc', { n: 1 }, { value: 2 }), c('d', {}, {})]);
  const d = traceBehaviorDiff(render(a), render(b));
  assert.deepEqual(d.summary, { ...ZERO, calls_added: 1, result_changed: 1, count_changed: 1 });
});

test('an identical call moved among its siblings is calls_reordered, not remove+add', () => {
  const b = flow((root) => { root.kids.push(root.kids.shift()); return root; });
  const d = traceBehaviorDiff(render(flow()), render(b));
  assert.deepEqual(d.summary, { ...ZERO, calls_reordered: 1 });
  assert.equal(d.samples.calls_reordered[0].call, 'app.Orders.validate');
  assert.equal(d.samples.calls_reordered[0].from, 0);
  assert.equal(d.samples.calls_reordered[0].to, 3);
  assert.equal(d.verdict, 'different', 'order is part of behaviour unless ignore_order is set');
});

test('ignore_order: any permutation of identical siblings is the same, at every depth', () => {
  const tasks = (order) => [c('main', {}, {}, [
    c('pool', {}, {}, order.map((n) => c('task', { n }, { value: n * n }, [c('fetch', { n }, {})]))),
  ])];
  const a = render(tasks([1, 2, 3, 4, 5]));
  const b = render(tasks([4, 1, 5, 3, 2]));
  const strict = traceBehaviorDiff(a, b);
  assert.equal(strict.verdict, 'different');
  assert.ok(strict.summary.calls_reordered > 0);
  assert.equal(strict.summary.calls_added + strict.summary.calls_removed, 0, 'pure moves, nothing added or removed');
  const loose = traceBehaviorDiff(a, b, { ignore_order: true });
  assert.equal(loose.verdict, 'same');
  assert.equal(loose.order, 'ignored');
  assert.equal(loose.compared_spans, 12);
});

test('ignore_order still reports a real change inside a permuted list', () => {
  const tasks = (order, sq = (n) => n * n) => [c('pool', {}, {}, order.map((n) => c('task', { n }, { value: sq(n) })))];
  const d = traceBehaviorDiff(render(tasks([1, 2, 3])), render(tasks([3, 1, 2], (n) => (n === 2 ? 5 : n * n))), { ignore_order: true });
  assert.deepEqual(d.summary, { ...ZERO, result_changed: 1 });
  assert.deepEqual(d.samples.result_changed[0].diff, [{ path: 'result.value', before: 4, after: 5 }]);
});

test('a renamed or moved function is removed + added (identity is lang+module+class+method)', () => {
  const b = flow((root) => { root.kids[3] = c('Notifier.send', { to: 'ops' }, {}); return root; });
  const d = traceBehaviorDiff(render(flow()), render(b));
  assert.deepEqual(d.summary, { ...ZERO, calls_added: 1, calls_removed: 1, count_changed: 2 });
  const moved = flow((root) => { root.kids[3].module = 'mail'; return root; });
  const d2 = traceBehaviorDiff(render(flow()), render(moved));
  assert.equal(d2.samples.calls_removed[0].call, 'app.Mailer.send');
  assert.equal(d2.samples.calls_added[0].call, 'mail.Mailer.send');
});

test('a call that moved to a different parent is removed there and added here', () => {
  const b = flow((root) => {
    const [tax] = root.kids[1].kids.splice(0, 1);
    root.kids[2].kids = [tax];
    return root;
  });
  const d = traceBehaviorDiff(render(flow()), render(b));
  assert.deepEqual(d.summary, { ...ZERO, calls_added: 1, calls_removed: 1 }, 'same call count, different shape');
  assert.deepEqual(d.samples.calls_removed[0].path, ['app.Orders.create', 'app.Pricing.total', 'app.Pricing.tax']);
  assert.deepEqual(d.samples.calls_added[0].path, ['app.Orders.create', 'app.Repo.save', 'app.Pricing.tax']);
});

test('count_changed aggregates per method', () => {
  const loop = (n) => [c('run', {}, {}, Array.from({ length: n }, () => c('Db.query', { q: 'x' }, {})))];
  const d = traceBehaviorDiff(render(loop(3)), render(loop(7)));
  assert.equal(d.summary.calls_added, 4);
  assert.deepEqual(d.samples.count_changed, [{ method: 'app.Db.query', before: 3, after: 7 }]);
});

// -- errors ----------------------------------------------------------------

const err = (type, msg) => ({ type, msg });

test('an error that appears is error_changed (and not also result_changed)', () => {
  const b = flow((root) => {
    root.kids[2].error = err('IOError', 'disk full');
    root.kids[2].result = {};
    return root;
  });
  const d = traceBehaviorDiff(render(flow()), render(b));
  assert.deepEqual(d.summary, { ...ZERO, error_changed: 1 });
  const [s] = d.samples.error_changed;
  assert.equal(s.before, null);
  assert.deepEqual(s.after, { type: 'IOError', msg: 'disk full' });
});

test('an error that disappears, and one that changes type, are error_changed', () => {
  const failing = (type) => flow((root) => { root.kids[0].error = err(type, 'bad id'); return root; });
  const gone = traceBehaviorDiff(render(failing('ValueError')), render(flow()));
  assert.equal(gone.summary.error_changed, 1);
  assert.equal(gone.samples.error_changed[0].after, null);
  const retyped = traceBehaviorDiff(render(failing('ValueError')), render(failing('TypeError')));
  assert.deepEqual(retyped.summary, { ...ZERO, error_changed: 1 });
});

test('a changed message with the same type is error_msg_changed, and can be switched off', () => {
  const failing = (msg) => flow((root) => { root.kids[0].error = err('ValueError', msg); return root; });
  const a = render(failing('bad id 7')), b = render(failing('invalid id 7'));
  const d = traceBehaviorDiff(a, b);
  assert.deepEqual(d.summary, { ...ZERO, error_msg_changed: 1 });
  assert.equal(traceBehaviorDiff(a, b, { compare_error_msg: false }).verdict, 'same');
});

test('error stacks never matter', () => {
  const failing = () => flow((root) => { root.kids[0].error = err('ValueError', 'bad'); return root; });
  assert.equal(traceBehaviorDiff(render(failing()), render(failing())).verdict, 'same');
});

// -- unstable values -------------------------------------------------------

test('redacted values compare equal', () => {
  const run = () => [c('login', { user: 'ana', password: '<redacted>' }, { token: '<redacted>' })];
  assert.equal(traceBehaviorDiff(render(run()), render(run())).verdict, 'same');
});

test('truncated values compare by their kept prefix and are flagged, never silently equal', () => {
  const marker = (body) => `<truncated:"${body}...>`;
  const run = (body, res = 1) => [c('load', { data: marker(body) }, { value: res })];
  const same = traceBehaviorDiff(render(run('xxxxxxxxxxxxxxxx')), render(run('xxxxxxxxxxxxxxxx')));
  assert.equal(same.verdict, 'same');
  assert.equal(same.truncated_values, 1, 'the equal comparison rested on a clipped value');
  assert.ok(same.notes.some((n) => /truncated by the capture layer/.test(n)));

  const diff = traceBehaviorDiff(render(run('xxxxxxxxxxxxxxxx')), render(run('xxxxxxxxyyyyyyyy')));
  assert.deepEqual(diff.summary, { ...ZERO, args_changed: 1 });
  assert.equal(diff.samples.args_changed[0].truncated, true);
  assert.equal(diff.samples.args_changed[0].diff[0].truncated, true);

  // Equal truncated args next to a changed result: the flag survives the
  // per-call comparison path, not only the identical-subtree shortcut.
  const mixed = traceBehaviorDiff(render(run('xxxxxxxxxxxxxxxx', 1)), render(run('xxxxxxxxxxxxxxxx', 2)));
  assert.equal(mixed.summary.result_changed, 1);
  assert.equal(mixed.truncated_values, 1);
});

test('identity hashes and memory addresses are normalised; other text is not', () => {
  const run = (hash, addr) => [c('handle', { req: `com.acme.Req@${hash}`, cb: `<Foo object at 0x${addr}>` }, { value: `Sess@${hash}` })];
  assert.equal(traceBehaviorDiff(render(run('1b6d3586', '7f3a2c1d9e50')), render(run('4e25154f', '7f99aa001c10'))).verdict, 'same');
  const cls = traceBehaviorDiff(
    render([c('handle', { req: 'com.acme.Req@1b6d3586' }, {})]),
    render([c('handle', { req: 'com.acme.Other@1b6d3586' }, {})]));
  assert.equal(cls.summary.args_changed, 1, 'the class name around the hash still matters');
  const small = traceBehaviorDiff(render([c('f', { mask: '0xff' }, {})]), render([c('f', { mask: '0xfe' }, {})]));
  assert.equal(small.summary.args_changed, 1, 'a short hex constant is not an address');
  const low = (a) => [c('f', { m: `<built-in method finditer of re.Pattern object at 0x${a}>` }, {})];
  assert.equal(traceBehaviorDiff(render(low('bc0d210')), render(low('bd11a30'))).verdict, 'same', 'a low address after "at" is one');
});

test('an address cut in half by truncation is normalised; normalize_addresses:false compares it verbatim', () => {
  // `<truncated:{first N chars}...>`: the cut can land inside `0x7f727e01c1d0`.
  const run = (cut) => [c('f', { cb: `<truncated:{"cb":"<function g at 0x${cut}...>` }, {})];
  const a = render(run('7f727')), b = render(run('7f3d8'));
  assert.equal(traceBehaviorDiff(a, b).verdict, 'same');
  const raw = traceBehaviorDiff(a, b, { normalize_addresses: false });
  assert.equal(raw.summary.args_changed, 1);
  const full = (addr) => [c('f', { cb: `<Foo object at 0x${addr}>` }, {})];
  assert.equal(traceBehaviorDiff(render(full('7f3a2c1d9e50')), render(full('7f99aa001c10')), { normalize_addresses: false }).summary.args_changed, 1);
  // Identity hashes are not affected by the flag.
  const h = (x) => [c('f', { r: `Req@${x}` }, {})];
  assert.equal(traceBehaviorDiff(render(h('1b6d3586')), render(h('4e25154f')), { normalize_addresses: false }).verdict, 'same');
});

test('an identity hash inside an error message is normalised too', () => {
  const failing = (h) => [c('f', {}, {}, [], { error: err('IllegalState', `bad Conn@${h}`) })];
  assert.equal(traceBehaviorDiff(render(failing('1a2b3c4d')), render(failing('99887766'))).verdict, 'same');
});

// -- ignore ----------------------------------------------------------------

test('ignore_methods drops matching calls and their subtrees, by glob', () => {
  const b = flow((root) => {
    root.kids.splice(1, 0, c('Audit.log', { n: Math.random() }, {}, [c('Disk.write', {}, {})]));
    root.kids[4].args = { to: 'dev' };
    return root;
  });
  const a = render(flow()), bb = render(b);
  assert.equal(traceBehaviorDiff(a, bb).verdict, 'different');
  const d = traceBehaviorDiff(a, bb, { ignore_methods: ['app.Audit.*', '*.Mailer.send'] });
  assert.equal(d.verdict, 'same');
  assert.deepEqual(d.ignored, { spans_a: 1, spans_b: 3, keys_a: 0, keys_b: 0 });
  assert.equal(d.spans_b, 5, 'ignored spans are not part of the compared trace');
  assert.equal(d.samples.count_changed.length, 0, 'ignored methods are not counted either');
});

test('ignore_keys: bare name at any depth, glob, and anchored path', () => {
  const run = (ts, id, n) => [c('create', { req: { at: ts, body: { n } } }, { id, created_at: ts, items: [{ ts, n }] })];
  const a = render(run(1, 'u-1', 5)), b = render(run(2, 'u-2', 5));
  assert.equal(traceBehaviorDiff(a, b).verdict, 'different');
  const d = traceBehaviorDiff(a, b, { ignore_keys: ['at', '*_at', 'result.id', 'result.items.*.ts'] });
  assert.equal(d.verdict, 'same');
  assert.equal(d.ignored.keys_a, 4);
  // The anchored path does not leak to other places the same key appears.
  const c2 = render(run(1, 'u-1', 5)), d2 = render([c('create', { req: { at: 1, body: { n: 5 }, id: 'x' } }, { id: 'u-9', created_at: 1, items: [{ ts: 1, n: 5 }] })]);
  const r = traceBehaviorDiff(c2, d2, { ignore_keys: ['result.id'] });
  assert.deepEqual(r.samples.args_changed[0].diff, [{ path: 'args.req.id', before: '<absent>', after: 'x' }]);
  // A real change next to the ignored keys is still seen.
  const e = traceBehaviorDiff(a, render(run(2, 'u-2', 6)), { ignore_keys: ['at', '*_at', 'result.id', 'result.items.*.ts'] });
  assert.equal(e.summary.args_changed, 1);
});

test('ignore_keys "result" drops the whole result', () => {
  const a = [c('now', {}, { value: 1 })], b = [c('now', {}, { value: 2 })];
  assert.equal(traceBehaviorDiff(render(a), render(b), { ignore_keys: ['result'] }).verdict, 'same');
});

// -- robustness ------------------------------------------------------------

test('a span with no exit is not equal to one that finished', () => {
  const a = [c('main', {}, {}, [c('work', {}, { value: 1 })])];
  const b = [c('main', {}, {}, [c('work', {}, { value: 1 }, [], { noExit: true })])];
  const d = traceBehaviorDiff(render(a), render(b));
  assert.equal(d.summary.result_changed, 1);
  assert.equal(d.samples.result_changed[0].diff[0].after, '<no exit>');
  assert.ok(d.notes.some((n) => /no exit event/.test(n)));
});

test('junk lines, v1 events and orphan exits are skipped without throwing', () => {
  const good = render(flow());
  const noisy = [null, 42, 'x', { timestamp: 1, event: 'ENTER' }, ...render(flow()),
    { event: 'exit', span_id: 'ffffffffffffffff', result: {} }];
  const d = traceBehaviorDiff(good, noisy);
  assert.equal(d.verdict, 'same');
  assert.ok(d.notes.some((n) => /no matching enter/.test(n)));
});

test('a span whose parent is not in the file is a root', () => {
  const ev = render(flow());
  for (const e of ev) if (e.parent_id === null) e.parent_id = 'aaaaaaaaaaaaaaaa';
  assert.equal(traceBehaviorDiff(render(flow()), ev).verdict, 'same');
});

test('a very deep call chain does not overflow the stack', () => {
  const chain = (depth, leaf) => {
    let node = c('leaf', {}, { value: leaf });
    for (let i = 0; i < depth; i++) node = c('rec', { i }, {}, [node]);
    return [node];
  };
  // Built iteratively: render() itself recurses, so emit the events by hand.
  const emit = (depth, leaf) => {
    const ev = [];
    const trace_id = 'a'.repeat(32);
    const id = (i) => i.toString(16).padStart(16, '0');
    for (let i = 0; i <= depth; i++) {
      ev.push({ ts: i, trace_id, span_id: id(i + 1), parent_id: i ? id(i) : null, event: 'enter',
        thread: 't', lang: 'node', module: 'm', class: '', method: i === depth ? 'leaf' : 'rec', args: { i } });
    }
    for (let i = depth; i >= 0; i--) {
      ev.push({ ts: depth * 2 - i, trace_id, span_id: id(i + 1), parent_id: i ? id(i) : null, event: 'exit',
        thread: 't', lang: 'node', module: 'm', class: '', method: i === depth ? 'leaf' : 'rec',
        result: i === depth ? { value: leaf } : {}, duration_ns: 1 });
    }
    return ev;
  };
  void chain;
  const d = traceBehaviorDiff(emit(50_000, 1), emit(50_000, 2));
  assert.deepEqual(d.summary, { ...ZERO, result_changed: 1 });
  assert.equal(d.samples.result_changed[0].path.length, 12, 'the call path is elided in the middle');
  assert.match(d.samples.result_changed[0].path[3], /^…\(\+\d+\)$/);
});

// -- bounds ----------------------------------------------------------------

/** A wide, shallow trace emitted directly (no recursion, fixed ids per run). */
function synthetic(nRoots, kidsPer, { changeEvery = 0, seed = 1 } = {}) {
  const ev = [];
  let n = seed * 1e9;
  const id = () => (n++).toString(16).padStart(16, '0');
  const trace_id = seed.toString(16).padStart(32, '0');
  for (let r = 0; r < nRoots; r++) {
    const root = id();
    const base = { trace_id, thread: 'main', lang: 'python', module: 'svc', class: 'Job' };
    ev.push({ ts: n, ...base, span_id: root, parent_id: null, event: 'enter', method: 'handle', args: { r } });
    for (let k = 0; k < kidsPer; k++) {
      const kid = id();
      const value = changeEvery && (r * kidsPer + k) % changeEvery === 0 ? -1 : k;
      ev.push({ ts: n, ...base, span_id: kid, parent_id: root, event: 'enter', method: 'step', args: { k } });
      ev.push({ ts: n, ...base, span_id: kid, parent_id: root, event: 'exit', method: 'step', result: { value }, duration_ns: n % 977 });
    }
    ev.push({ ts: n, ...base, span_id: root, parent_id: null, event: 'exit', method: 'handle', result: {}, duration_ns: 5 });
  }
  return ev;
}

test('samples are capped by limit while the counts stay exact, and the payload stays small', () => {
  const a = synthetic(200, 10, { seed: 1 });
  const b = synthetic(200, 10, { seed: 2, changeEvery: 7 });
  const d = traceBehaviorDiff(a, b, { limit: 3 });
  assert.equal(d.summary.result_changed, 286, 'exact count: ceil(2000 / 7)');
  assert.equal(d.samples.result_changed.length, 3);
  assert.equal(d.omitted.result_changed, 283);
  assert.ok(JSON.stringify(d).length < 4000, `payload is ${JSON.stringify(d).length} bytes`);
  assert.equal(traceBehaviorDiff(a, b, { limit: 0 }).samples.result_changed.length, 0);
});

test('a large trace stays inside the span cap and says the comparison is incomplete', () => {
  const a = synthetic(2000, 9, { seed: 1 });          // 20,000 spans
  const b = synthetic(2000, 9, { seed: 2 });
  const d = traceBehaviorDiff(a, b, { max_spans: 5000 });
  assert.equal(d.verdict, 'same');
  assert.equal(d.complete, false, '"same" is not proven past the cap');
  assert.equal(d.truncated, true);
  assert.equal(d.spans_a, 20000, 'the real size is still reported');
  assert.equal(d.compared_spans, 5000);
  assert.match(d.truncated_reasons[0], /span cap \(5000\)/);
});

test('past the span cap, a call-count change is still caught', () => {
  const a = synthetic(2000, 9, { seed: 1 });
  const b = synthetic(2001, 9, { seed: 2 });
  const d = traceBehaviorDiff(a, b, { max_spans: 5000 });
  assert.equal(d.verdict, 'different');
  assert.deepEqual(d.samples.count_changed, [
    { method: 'svc.Job.step', before: 18000, after: 18009 },
    { method: 'svc.Job.handle', before: 2000, after: 2001 },
  ]);
});

test('when the alignment budget runs out it degrades to greedy, reports it, and still finds the change', () => {
  // 3000 roots, every one different between the runs: no prefix or suffix to
  // trim, so the LCS would need 9M cells.
  const a = synthetic(3000, 1, { seed: 1 });
  const b = synthetic(3000, 1, { seed: 2, changeEvery: 1 });
  const d = traceBehaviorDiff(a, b, { max_list_cells: 1_000_000 });
  assert.equal(d.approximate_alignments, 1);
  assert.equal(d.truncated, true);
  assert.equal(d.complete, true, 'greedy alignment is approximate, not partial');
  assert.match(d.truncated_reasons[0], /alignment budget/);
  assert.equal(d.summary.result_changed, 3000);
  assert.equal(d.compared_spans, 6000);

  const whole = traceBehaviorDiff(a, b, { max_align_cells: 1000 });
  assert.equal(whole.approximate_alignments, 1, 'the global budget is enforced as well');
});

test('greedy alignment never reports two different lists as equal', () => {
  const a = synthetic(1500, 0, { seed: 1 });
  const b = synthetic(1500, 0, { seed: 2 });
  b[b.length - 2].args = { r: 'changed' };              // last root's enter
  const d = traceBehaviorDiff(a, b, { max_list_cells: 1 });
  assert.equal(d.verdict, 'different');
});

test('the result is deterministic', () => {
  const b = flow((root) => {
    root.kids.splice(1, 0, c('Audit.log', {}, {}));
    root.kids[3].result = { value: 'other' };
    return root;
  });
  const ea = render(flow()), eb = render(b);
  const first = JSON.stringify(traceBehaviorDiff(ea, eb));
  for (let i = 0; i < 5; i++) assert.equal(JSON.stringify(traceBehaviorDiff(ea, eb)), first);
  // And independent of the run-specific noise in the events.
  assert.equal(JSON.stringify(traceBehaviorDiff(render(flow()), render(b))), first);
});

test('the streaming API gives the same answer as the in-memory one', () => {
  const b = flow((root) => { root.kids[2].result = { value: 'other' }; return root; });
  const ea = render(flow()), eb = render(b);
  const differ = new BehaviorDiffer();
  const ta = differ.tree(), tb = differ.tree();
  for (const e of ea) ta.add(e);
  for (const e of eb) tb.add(e);
  assert.deepEqual(differ.diff(ta, tb), traceBehaviorDiff(ea, eb));
});

// -- runner --
let pass = 0, fail = 0;
for (const { name, fn } of tests) {
  try { fn(); console.log(`  ok   ${name}`); pass++; }
  catch (e) { console.error(`  FAIL ${name}\n        ${e.message}`); fail++; }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
