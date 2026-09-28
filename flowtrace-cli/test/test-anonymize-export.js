/**
 * Tests for lib/anonymize.js, lib/otlp.js and the anonymize / export commands.
 * Run: node test/test-anonymize-export.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync, spawn } = require('child_process');
const { anonymizeEvents } = require('../lib/anonymize');
const { toOtlp } = require('../lib/otlp');
const { readJsonl } = require('../lib/jsonl');
const { parseEndpoint } = require('../lib/commands/export');

const REPO = path.resolve(__dirname, '../..');
const BIN = path.join(__dirname, '../bin/flowtrace.js');
const ERR_GOLDEN = path.join(REPO, 'examples/golden/error/node/expected.jsonl');

let passed = 0;
let failed = 0;
function assert(condition, label) {
  if (condition) { console.log(`  PASS  ${label}`); passed++; } else { console.error(`  FAIL  ${label}`); failed++; }
}

const T = 'a'.repeat(32);
const base = { trace_id: T, thread: 'main', lang: 'node', module: 'app', class: 'Svc', visibility: 'private', depth: 0 };
const events = [
  { ...base, ts: 1700000000.5, span_id: '1'.repeat(16), parent_id: null, event: 'enter', method: 'login', args: { user: 'alice', id: 42, tags: ['x'], pw: '<redacted>', big: '<truncated:"abc...>' } },
  { ...base, ts: 1700000000.6, span_id: '2'.repeat(16), parent_id: '1'.repeat(16), event: 'enter', method: 'check', args: { u: 'alice' } },
  { ...base, ts: 1700000000.7, span_id: '2'.repeat(16), parent_id: '1'.repeat(16), event: 'exit', method: 'check', args: { u: 'alice' }, result: {}, duration_ns: 1000, error: { type: 'Denied', msg: 'alice is locked', stack: ['at check (/home/alice/app.js:3)'] } },
  { ...base, ts: 1700000000.9, span_id: '1'.repeat(16), parent_id: null, event: 'exit', method: 'login', args: {}, result: { value: 'token-alice' }, duration_ns: 400000000 },
];

// -- anonymize --
{
  const out = anonymizeEvents(events, { salt: 's' });
  const a = out[0].args;
  assert(a.user.startsWith('h:') && !JSON.stringify(out).includes('alice'), 'no string value survives');
  assert(a.user === out[1].args.u, 'equal values hash equal within a trace');
  assert(a.id === 42, 'numbers kept by default');
  assert(a.pw === '<redacted>' && a.big === '<truncated>', 'capture markers stay readable');
  assert(out[2].error.type === 'Denied' && out[2].error.stack[0] === '<frame>', 'error type kept, stack frames stripped');
  assert(out[0].method === 'login', 'names kept by default');
  assert(anonymizeEvents(events, { salt: 's' })[0].args.user === a.user, 'same salt → same hash across runs');
  assert(anonymizeEvents(events)[0].args.user !== a.user, 'default salt is random');
  const named = anonymizeEvents(events, { salt: 's', names: true, hashNumbers: true });
  assert(named[0].method.startsWith('h:') && named[0].args.id.startsWith('h:'), '--names / --numbers hash those too');
  assert(named[0].span_id === events[0].span_id && named[3].duration_ns === 400000000, 'ids and timings untouched');
}

// Anonymized output must still be schema-valid v2.
{
  let Ajv;
  try { Ajv = require(path.join(REPO, 'scripts/node_modules/ajv/dist/2020.js')); } catch { Ajv = null; }
  if (Ajv) {
    const validate = new (Ajv.default || Ajv)({ strict: false }).compile(JSON.parse(fs.readFileSync(path.join(REPO, 'schema/flowtrace-v2.json'), 'utf8')));
    const out = anonymizeEvents(readJsonl(ERR_GOLDEN), { names: true, hashNumbers: true });
    assert(out.every((e) => validate(e)), 'anonymized golden still validates against schema v2');
  } else {
    console.log('  SKIP  schema validation (ajv not installed in scripts/)');
  }
}

// -- otlp --
{
  const { resourceSpans } = toOtlp(events, { serviceName: 'svc' });
  assert(resourceSpans.length === 1, 'one resource per lang');
  const res = Object.fromEntries(resourceSpans[0].resource.attributes.map((a) => [a.key, a.value.stringValue]));
  assert(res['service.name'] === 'svc' && res['telemetry.sdk.language'] === 'nodejs', 'resource attributes');
  const spans = resourceSpans[0].scopeSpans[0].spans;
  assert(spans.length === 2, 'enter/exit pairs collapse to spans');
  const root = spans.find((s) => !s.parentSpanId);
  const child = spans.find((s) => s.parentSpanId);
  assert(root.traceId === T && child.parentSpanId === root.spanId, 'W3C ids map one to one');
  assert(root.startTimeUnixNano === '1700000000500000000', 'start from ts');
  assert(BigInt(root.endTimeUnixNano) - BigInt(root.startTimeUnixNano) === 400000000n, 'end = start + duration_ns exactly');
  assert(child.status.code === 2 && child.events[0].name === 'exception', 'error → status ERROR + exception event');
  assert(root.attributes.some((a) => a.key === 'flowtrace.result'), 'result exported as attribute');
  const partial = toOtlp(events.slice(0, 1)).resourceSpans[0].scopeSpans[0].spans[0];
  assert(partial.attributes.some((a) => a.key === 'flowtrace.incomplete'), 'span with no exit kept and flagged');
}

// -- endpoint parsing --
{
  assert(parseEndpoint('http://localhost:4318').pathname === '/v1/traces', 'bare collector address gets /v1/traces');
  assert(parseEndpoint('https://c.example/custom').pathname === '/custom', 'explicit path kept');
  let threw = false;
  try { parseEndpoint('file:///etc/passwd'); } catch { threw = true; }
  assert(threw, 'non-http endpoint rejected');
}

// -- commands end to end --
async function e2e() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-anon-'));
  const src = path.join(dir, 'trace.jsonl');
  fs.copyFileSync(ERR_GOLDEN, src);

  const r1 = spawnSync(process.execPath, [BIN, 'anonymize', src, '--salt', 'k'], { encoding: 'utf8' });
  assert(r1.status === 0 && fs.existsSync(path.join(dir, 'trace.anon.jsonl')), 'anonymize writes <file>.anon.jsonl');

  const r2 = spawnSync(process.execPath, [BIN, 'export', src], { encoding: 'utf8' });
  const otlp = JSON.parse(fs.readFileSync(path.join(dir, 'trace.otlp.json'), 'utf8'));
  assert(r2.status === 0 && otlp.resourceSpans.length === 1, 'export writes <file>.otlp.json');

  let received = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { received = { url: req.url, body: JSON.parse(body) }; res.end('{}'); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const code = await new Promise((resolve) => {
    spawn(process.execPath, [BIN, 'export', src, '--endpoint', `http://127.0.0.1:${port}`], { stdio: 'ignore' }).on('exit', resolve);
  });
  server.close();
  assert(code === 0 && received && received.url === '/v1/traces' && received.body.resourceSpans, 'export --endpoint POSTs OTLP/JSON');
  fs.rmSync(dir, { recursive: true, force: true });
}

e2e().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
});
