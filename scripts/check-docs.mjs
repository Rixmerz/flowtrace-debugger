/**
 * Asserts that the prose restates the authoritative capability list.
 *
 * mcp-server/src/runtimes.ts is the source of truth for what FlowTrace
 * supports; both READMEs are restatements of it. That arrangement only works
 * if drift is caught mechanically — it has now gone stale twice. The first
 * time a runtime's row disagreed with the resource; the second, the browser
 * capture layer was published to npm and neither README mentioned it existed,
 * so the front door of the project omitted a shipped capability entirely.
 *
 * Deliberately shallow: it checks that each supported thing is *named*, not
 * that the surrounding sentence is accurate. A name that is missing is a
 * provable defect; a sentence that is subtly wrong is a review problem, and
 * pretending a script can catch it would be worse than not trying.
 *
 * The one exception is a claim that *counts*. Both READMEs went on saying
 * `@rixmerz/flowtrace` was the only published package in the same screen that
 * told the reader to install a second one — the presence check above passed,
 * because the name was there. A countable claim can be checked against the
 * count, so those are listed in CONTRADICTED below.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const DIST = join(REPO, 'mcp-server', 'dist', 'runtimes.js');
let RUNTIMES;
try {
  ({ RUNTIMES } = require(DIST));
} catch {
  console.error(`check-docs: ${DIST} missing — run 'make build-mcp' first`);
  process.exit(1);
}

// A vacuous pass is the one failure mode this script must not have.
if (!Array.isArray(RUNTIMES) || RUNTIMES.length < 4) {
  console.error(`check-docs: read ${RUNTIMES?.length ?? 0} runtimes from dist — refusing to pass on that`);
  process.exit(1);
}

/** Everything the prose has to name, and where the truth about it lives. */
const REQUIRED = [
  ...RUNTIMES.map((r) => ({ what: r.label, why: 'RUNTIMES[].label' })),
  { what: '@rixmerz/flowtrace', why: 'the published CLI' },
  { what: '@rixmerz/flowtrace-browser', why: 'the published browser capture layer' },
];

const DOCS = ['README.md', 'README.en.md'];

/**
 * Phrases the published-package count makes false. Only add a phrase here when
 * a script can actually decide it — the point is to catch claims that contradict
 * data this script already holds, not to lint prose.
 */
const PUBLISHED = REQUIRED.filter(({ what }) => what.startsWith('@rixmerz/'));
const CONTRADICTED = PUBLISHED.length > 1
  ? ['único paquete publicado', 'only published package']
  : [];

let failed = 0;
for (const doc of DOCS) {
  const text = readFileSync(join(REPO, doc), 'utf8');
  const missing = REQUIRED.filter(({ what }) => !text.includes(what));

  // Emphasis markers sit inside the claim ("the **only** published package"),
  // so a naive substring match misses it — which is how it shipped.
  const plain = text.replace(/[*_`]/g, '');
  for (const phrase of CONTRADICTED.filter((p) => plain.includes(p))) {
    failed += 1;
    console.error(
      `  ${doc}: says "${phrase}", but ${PUBLISHED.length} packages are published ` +
      `(${PUBLISHED.map((p) => p.what).join(', ')})`
    );
  }

  if (missing.length === 0) {
    console.log(`  ${doc}: names all ${REQUIRED.length} supported things`);
    continue;
  }
  failed += missing.length;
  for (const { what, why } of missing) {
    console.error(`  ${doc}: never mentions "${what}" (${why})`);
  }
}

if (failed > 0) {
  console.error(
    '\ncheck-docs: the READMEs restate mcp-server/src/runtimes.ts, and have\n' +
    'drifted from it — fix the prose, or change what is actually supported.'
  );
  process.exit(1);
}
console.log('check-docs: ok');
