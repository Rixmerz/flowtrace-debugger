/**
 * The CLI's contract with the OS and with the dashboard: exit codes, paths
 * containing spaces, the .flowtrace/config.json knobs, and the upload fallback
 * when the dashboard refuses a path outside its roots.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const runCommand = require('../lib/commands/run');
const analyzeCommand = require('../lib/commands/analyze');
const assets = require('../lib/assets');
const { ensureGitignore, ignoresFlowtrace } = require('../lib/gitignore');
const { detectPackagePrefix, nodePackageName } = require('../lib/detect');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function tmp(prefix = 'ft-cli-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// -- exit codes --------------------------------------------------------------

test('a child killed by a signal exits 128+n, not 0', () => {
  const { _exitStatusFor } = runCommand;
  assert.equal(_exitStatusFor(0, null), 0);
  assert.equal(_exitStatusFor(3, null), 3);
  assert.equal(_exitStatusFor(null, 'SIGKILL'), 128 + os.constants.signals.SIGKILL);
  assert.equal(_exitStatusFor(null, 'SIGSEGV'), 128 + os.constants.signals.SIGSEGV);
  assert.equal(_exitStatusFor(null, 'SIGTERM'), 128 + os.constants.signals.SIGTERM);
  assert.notEqual(_exitStatusFor(null, 'SIGKILL'), 0, 'a crashed run must not look successful');
});

// -- paths with spaces -------------------------------------------------------

test('NODE_OPTIONS survives a bootstrap path containing a space', () => {
  const env = runCommand._buildNodeEnv({
    bootstrapPath: '/Users/me/My Projects/flowtrace/bootstrap.mjs',
    prefix: '/Users/me/My Projects/app',
    outPath: '/tmp/out.jsonl',
  });
  const flagValue = env.NODE_OPTIONS.split(' ')[1];
  assert.ok(!/\s/.test(flagValue), `--import value must not contain whitespace: ${flagValue}`);
  assert.match(env.NODE_OPTIONS, /^--import file:\/\/\/Users\/me\/My%20Projects\/flowtrace\/bootstrap\.mjs /);
});

test('JVM flags with spaces are quoted so JAVA_TOOL_OPTIONS still parses', () => {
  const { _quoteJvmFlag } = runCommand;
  assert.equal(_quoteJvmFlag('-Dx=y'), '-Dx=y', 'no quotes when none are needed');
  assert.equal(_quoteJvmFlag('-Dflowtrace.output=/My Files/t.jsonl'), '-Dflowtrace.output="/My Files/t.jsonl"');
  assert.equal(_quoteJvmFlag('-javaagent:/My Files/a.jar'), '-javaagent:"/My Files/a.jar"');

  const { env } = runCommand._buildJavaInjection({
    otelAgent: '/My Files/otel.jar',
    flExt: '/My Files/ext.jar',
    prefix: 'com.example',
    outPath: '/My Files/out.jsonl',
    strategy: 'gradle',
    userArgs: ['gradle', 'run'],
  });
  // Every path-bearing flag is quoted, so splitting on whitespace outside
  // quotes yields one token per flag.
  const outside = env.JAVA_TOOL_OPTIONS.replace(/"[^"]*"/g, '');
  assert.equal(outside.includes('My'), false, `unquoted space left in: ${env.JAVA_TOOL_OPTIONS}`);
});

// -- config.json is honoured -------------------------------------------------

test('capture.maxArgLength and redactKeys reach every runtime', () => {
  const knobs = runCommand._captureEnv({ capture: { maxArgLength: 64, redactKeys: ['ssn', 'iban'] } });
  assert.equal(knobs.FLOWTRACE_MAX_ARG_LENGTH, '64');
  assert.equal(knobs.FLOWTRACE_REDACT_KEYS, 'ssn,iban');

  assert.equal(runCommand._captureEnv({ capture: { maxArgLength: 0 } }).FLOWTRACE_MAX_ARG_LENGTH, '0',
    '0 means "no truncation" and must be passed through, not treated as unset');
  assert.deepEqual(runCommand._captureEnv({}), {});
  assert.deepEqual(runCommand._captureEnv(undefined), {});

  const nodeEnv = runCommand._buildNodeEnv({
    bootstrapPath: '/b.mjs', prefix: '/p', outPath: '/o.jsonl',
    captureKnobs: runCommand._captureEnv({ capture: { maxArgLength: 64 } }),
  });
  assert.equal(nodeEnv.FLOWTRACE_MAX_ARG_LENGTH, '64');

  const pyEnv = runCommand._buildPythonEnv({
    prefix: 'app', outPath: '/o.jsonl', stubDir: '/stub',
    captureKnobs: runCommand._captureEnv({ capture: { maxArgLength: 64 } }),
  });
  assert.equal(pyEnv.FLOWTRACE_MAX_ARG_LENGTH, '64');

  const { env: javaEnv, args } = runCommand._buildJavaInjection({
    otelAgent: '/o.jar', flExt: '/e.jar', prefix: 'com.x', outPath: '/o.jsonl',
    strategy: 'java', userArgs: ['java', '-jar', 'app.jar'],
    captureKnobs: runCommand._captureEnv({ capture: { maxArgLength: 64 } }),
  });
  assert.equal(javaEnv.FLOWTRACE_MAX_ARG_LENGTH, '64');
  assert.ok(args.some((a) => a === '-Dflowtrace.max-arg-length=64'),
    'Java reads the system property first, so it must be set too');
});

test('the prefix comes from the flag, then the config, then detection', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'pom.xml'), '<project><groupId>com.detected</groupId></project>');
  const { _resolvePrefix } = runCommand;
  assert.equal(_resolvePrefix({ options: { packagePrefix: 'com.flag' }, config: { capture: { packagePrefix: 'com.cfg' } }, cwd: d, lang: 'java' }), 'com.flag');
  assert.equal(_resolvePrefix({ options: {}, config: { capture: { packagePrefix: 'com.cfg' } }, cwd: d, lang: 'java' }), 'com.cfg');
  assert.equal(_resolvePrefix({ options: {}, config: {}, cwd: d, lang: 'java' }), 'com.detected');
  fs.rmSync(d, { recursive: true, force: true });
});

test('a Gradle project resolves a prefix at run time, not only at init', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'build.gradle'), 'group = "io.acme"\n');
  assert.equal(runCommand._resolvePrefix({ options: {}, config: {}, cwd: d, lang: 'java' }), 'io.acme',
    'run used to read pom.xml only, so a Gradle project failed with "no prefix"');
  fs.rmSync(d, { recursive: true, force: true });
});

// -- Node prefix semantics ---------------------------------------------------

test('the Node prefix is the project directory, which is what the layer matches', () => {
  const d = fs.realpathSync(tmp('ft-cli-app-'));
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: '@acme/api-server' }));
  // capture/node matches FLOWTRACE_PACKAGE_PREFIX with filename.includes(prefix).
  assert.equal(detectPackagePrefix(d, 'node'), d);
  assert.equal(detectPackagePrefix(d, 'ts'), d);
  assert.ok(path.join(d, 'src', 'index.js').includes(detectPackagePrefix(d, 'node')),
    'a source file under the project matches the prefix the layer is given');
  assert.equal(nodePackageName(d), 'api-server', 'the package name is still available, for display');
  fs.rmSync(d, { recursive: true, force: true });
});

// -- .gitignore --------------------------------------------------------------

test('.flowtrace and .flowtrace/ are the same entry to both commands', () => {
  assert.equal(ignoresFlowtrace('.flowtrace\n'), true);
  assert.equal(ignoresFlowtrace('.flowtrace/\n'), true);
  assert.equal(ignoresFlowtrace('/.flowtrace/\n'), true);
  assert.equal(ignoresFlowtrace('node_modules\n'), false);

  const d = tmp();
  fs.mkdirSync(path.join(d, '.git'));
  fs.writeFileSync(path.join(d, '.gitignore'), 'node_modules\n.flowtrace\n');
  assert.equal(ensureGitignore(d), false, 'the entry without a slash already counts');
  assert.equal(fs.readFileSync(path.join(d, '.gitignore'), 'utf-8').match(/\.flowtrace/g).length, 1);
  fs.rmSync(d, { recursive: true, force: true });
});

test('outside a git repo nothing is written', () => {
  const d = tmp();
  assert.equal(ensureGitignore(d), false);
  assert.equal(fs.existsSync(path.join(d, '.gitignore')), false);
  fs.rmSync(d, { recursive: true, force: true });
});

// -- OTel agent integrity ----------------------------------------------------

test('a downloaded agent with the wrong digest is discarded, not installed', async () => {
  const d = tmp();
  const tmpFile = path.join(d, 'agent.jar.partial');
  const dest = path.join(d, 'agent.jar');
  fs.writeFileSync(tmpFile, 'not the real agent');

  await assert.rejects(
    () => assets.verifyAndPlace(tmpFile, dest, assets.OTEL_SHA256),
    /checksum mismatch/,
  );
  assert.equal(fs.existsSync(tmpFile), false, 'the bad download is deleted');
  assert.equal(fs.existsSync(dest), false, 'and never reaches the path handed to -javaagent:');

  // The happy path: the digest of what we actually have.
  fs.writeFileSync(tmpFile, 'payload');
  const good = await assets.sha256File(tmpFile);
  await assets.verifyAndPlace(tmpFile, dest, good);
  assert.equal(fs.readFileSync(dest, 'utf8'), 'payload');
  fs.rmSync(d, { recursive: true, force: true });
});

test('the pinned digest is a sha256 and the shell script pins the same version', () => {
  assert.match(assets.OTEL_SHA256, /^[0-9a-f]{64}$/);
  const sh = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'fetch-otel-agent.sh'), 'utf-8');
  assert.ok(sh.includes(`VERSION="${assets.OTEL_VERSION}"`), 'script and assets.js must fetch one artifact');
  assert.ok(sh.includes(`SHA256="${assets.OTEL_SHA256}"`), 'and verify the same digest');
});

// -- analyze: 403 -> upload --------------------------------------------------

test('a path the dashboard may not read is uploaded instead', async () => {
  const d = tmp();
  const trace = path.join(d, 't.jsonl');
  fs.writeFileSync(trace, '{"event":"enter"}\n');

  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      seen.push({ url: req.url, type: req.headers['content-type'], length: body.length });
      if (req.url === '/api/analyze-file') {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'outside', code: 'OUTSIDE_ROOTS', roots: ['/elsewhere'] }));
        return;
      }
      if (req.url === '/api/analyze') {
        assert.match(req.headers['content-type'], /^multipart\/form-data; boundary=/);
        assert.ok(body.includes('{"event":"enter"}'), 'the file content is in the upload');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ analysisId: 'analysis-1-abcdef01' }));
        return;
      }
      res.writeHead(404); res.end('{}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const url = await analyzeCommand._buildOpenUrl(baseUrl, trace);
  assert.equal(url, `${baseUrl}?analysis=analysis-1-abcdef01`);
  assert.deepEqual(seen.map((s) => s.url), ['/api/analyze-file', '/api/analyze']);

  server.close();
  fs.rmSync(d, { recursive: true, force: true });
});

test('an id that is not a plain token is never put in the URL we open', async () => {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ analysisId: 'x&calc.exe' }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const url = await analyzeCommand._buildOpenUrl(baseUrl, __filename);
  assert.equal(url, baseUrl, 'falls back to the bare dashboard rather than a shell metacharacter');
  server.close();
});

// -- runner ------------------------------------------------------------------

(async () => {
  let pass = 0, fail = 0;
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`  ok   ${name}`); pass++; }
    catch (e) { console.error(`  FAIL ${name}\n        ${e.stack}`); fail++; }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
