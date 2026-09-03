/**
 * The analysis routes as a network client sees them: what they accept, what
 * they refuse, and where the bytes land. Every finding in the security review
 * of server/api/analyze.js was in code that had no test at all.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const GOLDEN = path.join(REPO_ROOT, 'examples/golden/java/expected.jsonl');

// Environment is read when the module loads, so it is set before require().
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-api-root-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-api-outside-'));
const uploadDir = path.join(root, 'uploads');
process.env.FLOWTRACE_DASHBOARD_ROOTS = root;
process.env.FLOWTRACE_DASHBOARD_UPLOAD_DIR = uploadDir;
process.env.FLOWTRACE_DASHBOARD_MAX_UPLOAD_BYTES = '4000';
process.env.FLOWTRACE_DASHBOARD_MAX_ANALYSES = '2';
process.env.FLOWTRACE_COLLECTOR_OUTPUT = path.join(root, 'collector.jsonl');

const app = require('../server/server.js');

let server;
let baseUrl;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

async function post(route, body) {
  const res = await fetch(baseUrl + route, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

/** A multipart body built by hand, so originalname is exactly what we say. */
async function uploadBytes(originalName, bytes) {
  const boundary = 'ftboundary' + Date.now();
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${originalName}"\r\n` +
    'Content-Type: application/jsonl\r\n\r\n'
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const res = await fetch(baseUrl + '/api/analyze', {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body: Buffer.concat([head, Buffer.from(bytes), tail]),
  });
  return { status: res.status, body: await res.json() };
}

const smallTrace = fs.readFileSync(GOLDEN, 'utf8').split('\n').slice(0, 2).join('\n') + '\n';

// -- analyze-file ------------------------------------------------------------

test('a file inside an allowed root is analyzed', async () => {
  const p = path.join(root, 'inside.jsonl');
  fs.copyFileSync(GOLDEN, p);
  const { status, body } = await post('/api/analyze-file', { filePath: p });
  assert.equal(status, 200, JSON.stringify(body));
  assert.match(body.analysisId, /^analysis-\d+-[0-9a-f]{8}$/);
  assert.equal(body.fileName, 'inside.jsonl');
  assert.equal('filePath' in body, false, 'the response does not echo server paths');
  assert.ok(body.results.performance.callTrees.length > 0);
});

test('a file outside every root is refused with OUTSIDE_ROOTS', async () => {
  const p = path.join(outside, 'secret.jsonl');
  fs.copyFileSync(GOLDEN, p);
  const { status, body } = await post('/api/analyze-file', { filePath: p });
  assert.equal(status, 403);
  assert.equal(body.code, 'OUTSIDE_ROOTS');
  assert.ok(Array.isArray(body.roots) && body.roots.includes(fs.realpathSync(root)));
});

test('a symlink inside a root that points outside is refused', async () => {
  const target = path.join(outside, 'linked.jsonl');
  fs.copyFileSync(GOLDEN, target);
  const link = path.join(root, 'link.jsonl');
  fs.symlinkSync(target, link);
  const { status, body } = await post('/api/analyze-file', { filePath: link });
  assert.equal(status, 403, JSON.stringify(body));
});

test('a traversal path is resolved before the root check', async () => {
  const { status } = await post('/api/analyze-file', { filePath: path.join(root, '..', path.basename(outside), 'secret.jsonl') });
  assert.equal(status, 403);
});

test('a directory is a 400, a missing file a 404, a wrong extension a 400', async () => {
  assert.equal((await post('/api/analyze-file', { filePath: root })).status, 400);
  const missing = await post('/api/analyze-file', { filePath: path.join(root, 'nope.jsonl') });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, 'File not found', 'no path in the message');
  fs.writeFileSync(path.join(root, 'notes.txt'), 'x');
  assert.equal((await post('/api/analyze-file', { filePath: path.join(root, 'notes.txt') })).status, 400);
  assert.equal((await post('/api/analyze-file', {})).status, 400);
  assert.equal((await post('/api/analyze-file', { filePath: 42 })).status, 400);
});

// -- uploads -----------------------------------------------------------------

test('an upload is stored under a server-chosen name inside the upload dir', async () => {
  const { status, body } = await uploadBytes('../../../../evil.jsonl', smallTrace);
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.fileName, 'evil.jsonl', 'display name is the basename only');
  const stored = fs.readdirSync(uploadDir);
  assert.equal(stored.length, 1);
  assert.match(stored[0], /^[0-9a-f-]{36}\.jsonl$/);
  assert.equal(fs.existsSync(path.join(root, 'evil.jsonl')), false);
  assert.equal(fs.existsSync(path.join(uploadDir, '..', '..', '..', '..', 'evil.jsonl')), false);
});

test('an upload over the size limit is a 413 and nothing is kept', async () => {
  const before = fs.readdirSync(uploadDir).length;
  const { status, body } = await uploadBytes('big.jsonl', 'x'.repeat(5000));
  assert.equal(status, 413, JSON.stringify(body));
  assert.equal(fs.readdirSync(uploadDir).length, before);
});

test('a non-jsonl upload is refused', async () => {
  const boundary = 'ftb';
  const res = await fetch(baseUrl + '/api/analyze', {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body: `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nhi\r\n--${boundary}--\r\n`,
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /jsonl/);
});

test('the cache is bounded and evicting an upload deletes its file', async () => {
  // MAX_ANALYSES=2. One upload already cached; two more evict it.
  const first = fs.readdirSync(uploadDir);
  assert.equal(first.length, 1);
  await uploadBytes('two.jsonl', smallTrace);
  await uploadBytes('three.jsonl', smallTrace);
  const now = fs.readdirSync(uploadDir);
  assert.equal(now.length, 2, 'two files kept');
  assert.equal(now.includes(first[0]), false, 'the oldest upload was deleted with its analysis');
  const list = await (await fetch(baseUrl + '/api/analyze')).json();
  assert.equal(list.analyses.length, 2);
});

test('deleting an analysis deletes an uploaded file but never a user path', async () => {
  const userFile = path.join(root, 'mine.jsonl');
  fs.copyFileSync(GOLDEN, userFile);
  const { body } = await post('/api/analyze-file', { filePath: userFile });
  const del = await fetch(`${baseUrl}/api/analyze/${body.analysisId}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal(fs.existsSync(userFile), true, 'the user\'s file is untouched');
});

// -- misc --------------------------------------------------------------------

test('config reports roots and limits', async () => {
  const cfg = await (await fetch(baseUrl + '/api/config')).json();
  assert.ok(cfg.roots.includes(fs.realpathSync(root)));
  assert.equal(cfg.maxUploadBytes, 4000);
  assert.equal(cfg.maxAnalyses, 2);
});

test('unknown API routes answer JSON 404', async () => {
  const res = await fetch(baseUrl + '/api/does-not-exist');
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'not found' });
});

test('the UI is served with a strict CSP and no CDN script', async () => {
  const res = await fetch(baseUrl + '/');
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const html = await res.text();
  assert.equal(html.includes('cdn.jsdelivr.net'), false);
  assert.equal(/<script>[^]*?<\/script>/.test(html), false, 'no inline script');
});

test('the server binds loopback by default', () => {
  assert.equal(app.HOST, '127.0.0.1');
});

// -- runner ----------------------------------------------------------------

async function main() {
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  let pass = 0, fail = 0;
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`  ok   ${name}`); pass++; }
    catch (e) { console.error(`  FAIL ${name}\n        ${e.stack}`); fail++; }
  }
  console.log(`\n${pass} passed, ${fail} failed`);

  server.close();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
  process.exit(fail === 0 ? 0 : 1);
}

main();
