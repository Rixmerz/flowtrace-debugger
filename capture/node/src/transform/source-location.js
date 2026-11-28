/**
 * Where a function is declared, for the optional `file` / `line` fields of an
 * `enter` event (schema v2). Both are resolved once, at transform time, and
 * baked into the emitted code as literals — nothing here runs per call.
 *
 * Kept free of heavy imports on purpose: the ESM loader and the CJS hook both
 * import it eagerly, to pin the project root before the traced program has a
 * chance to chdir.
 */

import { isAbsolute, relative, resolve, sep } from 'node:path';
import { realpathSync } from 'node:fs';

/** cwd when the capture layer was loaded — the default project root. */
const START_CWD = process.cwd();

/**
 * The directory `file` is relative to: FLOWTRACE_ROOT when set (a relative
 * value is resolved against the starting cwd), else the cwd at capture start.
 * @returns {string} absolute path
 */
export function projectRoot() {
  const fromEnv = process.env.FLOWTRACE_ROOT;
  return fromEnv ? resolve(START_CWD, fromEnv) : START_CWD;
}

// Pin the resolved root into the environment so a child process started from
// another cwd reports paths against the same root as its parent. Without this
// each process is relative to its own cwd, and one trace holds `app.js` twice
// meaning two different files.
process.env.FLOWTRACE_ROOT = projectRoot();

function toPosix(p) {
  return sep === '/' ? p : p.split(sep).join('/');
}

function relativeInside(root, filename) {
  const rel = relative(root, filename);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return rel;
}

/**
 * The `file` value for a source file: a POSIX path relative to the project
 * root, or the absolute POSIX path when the file is not under it. null when
 * the transform was not given a real path (there is nothing to join on).
 *
 * @param {string} filename - absolute path of the source file
 * @param {string} [root]
 * @returns {string|null}
 */
export function sourceFileFor(filename, root = projectRoot()) {
  if (typeof filename !== 'string' || !isAbsolute(filename)) return null;
  let rel = relativeInside(root, filename);
  if (rel === null) {
    // One side may be spelled through a symlink (macOS /tmp -> /private/tmp):
    // lexically outside, physically inside.
    try {
      rel = relativeInside(realpathSync(root), realpathSync(filename));
    } catch { /* a path that does not exist is simply reported as given */ }
  }
  return toPosix(rel ?? filename);
}

// ── source map → original line ───────────────────────────────

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_VALUE = new Map([...B64].map((c, i) => [c, i]));

/**
 * Decode a source map's `mappings` into, per generated line, the segments that
 * point back at a source position: [generatedColumn, originalLine (0-based)].
 * Segments with no source (synthesized code) are dropped.
 *
 * @param {string} mappings
 * @returns {Array<Array<[number, number]>>}
 */
function decodeMappings(mappings) {
  const lines = [];
  let origLine = 0;
  for (const lineText of mappings.split(';')) {
    const segments = [];
    let genCol = 0;
    let i = 0;
    while (i < lineText.length) {
      // One segment: 1, 4 or 5 VLQ fields, terminated by ',' or end of line.
      const fields = [];
      while (i < lineText.length && lineText[i] !== ',') {
        let value = 0;
        let shift = 0;
        let digit;
        do {
          digit = B64_VALUE.get(lineText[i++]);
          if (digit === undefined) throw new Error('invalid source map mappings');
          value += (digit & 31) * 2 ** shift;
          shift += 5;
        } while (digit & 32);
        fields.push(value % 2 === 1 ? -((value - 1) / 2) : value / 2);
      }
      i++; // the comma
      if (fields.length === 0) continue;
      genCol += fields[0];
      if (fields.length >= 4) {
        origLine += fields[2];
        segments.push([genCol, origLine]);
      }
    }
    lines.push(segments);
  }
  return lines;
}

/**
 * Build a lookup from a position in generated code to the 1-indexed line of
 * the original source, from a source map as swc returns it (JSON text).
 *
 * The lookup returns null — "unknown", never a guess — when the generated
 * line carries no mapping at or before the column: that is code the compiler
 * synthesized (a CommonJS `_export` helper, say), which has no declaration in
 * the user's file.
 *
 * @param {string|object} map
 * @returns {(line: number, column: number) => number|null} line is 1-indexed, column 0-indexed
 */
export function originalLineLookup(map) {
  const parsed = typeof map === 'string' ? JSON.parse(map) : map;
  const lines = decodeMappings(parsed.mappings ?? '');
  return (line, column) => {
    const segments = lines[line - 1];
    if (!segments) return null;
    let found = null;
    for (const [genCol, origLine] of segments) {
      if (genCol > column) break;
      found = origLine;
    }
    return found === null ? null : found + 1;
  };
}
