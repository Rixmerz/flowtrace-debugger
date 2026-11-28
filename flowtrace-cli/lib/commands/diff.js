/**
 * `flowtrace diff <base> <actual>` — compara el COMPORTAMIENTO de dos trazas
 * del mismo flujo. Es el test de caracterización: se graba una traza base, se
 * versiona, y tras cada cambio se compara la traza nueva contra ella.
 *
 * Exit codes — they are the interface for CI, keep them stable:
 *   0  verdict "same" and the comparison was complete
 *   1  verdict "different"
 *   2  usage or I/O error, or "same" but a cap left part of a trace uncompared
 *      (an unproven "same" must not pass a gate)
 *
 * The comparison itself is mcp-server/src/behavior-diff.ts, the same code the
 * MCP tool trace_behavior_diff runs, reached through a committed bundle — see
 * resolveDiffer below. This file only streams the two files into it and prints.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const chalk = require('chalk');

/** Thrown for anything that must exit 2 rather than 1. */
class UsageError extends Error {}

/**
 * Locates the comparison, in whichever layout this file runs from:
 *
 *   installed package / checkout: the committed esbuild bundle at
 *   flowtrace-cli/vendor/trace-diff/behavior-diff.bundle.js (see
 *   scripts/bundle-diff.mjs). It is tried first in both layouts, unlike the
 *   capture assets in assets.js: it is committed and `make check-bundle` fails
 *   when it drifts from its source, so it cannot be a stale leftover.
 *
 *   checkout without the bundle: mcp-server/dist/behavior-diff.js, i.e. what
 *   `make build-mcp` produced.
 *
 * `baseDir` is injectable so tests can point it at a fixture tree.
 */
function resolveDiffer(baseDir = __dirname) {
  const bundled = path.resolve(baseDir, '..', '..', 'vendor', 'trace-diff', 'behavior-diff.bundle.js');
  if (fs.existsSync(bundled)) return bundled;
  const fromBuild = path.resolve(baseDir, '..', '..', '..', 'mcp-server', 'dist', 'behavior-diff.js');
  if (fs.existsSync(fromBuild)) return fromBuild;
  return null;
}

/** Default ignores file, when --ignore-file is not given. */
const IGNORE_FILE = 'characterisation.json';

/**
 * Where the default ignores live, first match wins:
 *
 *   1. next to the baseline trace — the baseline is committed, so a file
 *      beside it is committed with it and reaches CI;
 *   2. `.flowtrace/characterisation.json` — convenient locally, but
 *      `flowtrace init` gitignores `.flowtrace/`, so it does NOT reach a clone.
 */
function findIgnoreFile(baselinePath, cwd) {
  const candidates = [
    path.join(path.dirname(path.resolve(cwd, baselinePath)), IGNORE_FILE),
    path.join(cwd, '.flowtrace', IGNORE_FILE),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

/**
 * One ignore entry is a plain string, or an object that carries the reason it
 * is ignored: `{ "name": "app.Logger.*", "reason": "logging is not behaviour" }`
 * (`key` is the same field, for ignoreKeys). Anything else in the object is
 * rejected like an unknown top-level key: a typo (`"reasno"`) must not turn
 * into a silent entry with no reason.
 */
function ignoreList(value, where, key, reasons) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new UsageError(`${where}: "${key}" debe ser una lista de strings u objetos {"name"|"key": ..., "reason": ...}`);
  }
  return value.map((entry, i) => {
    if (typeof entry === 'string') return { pattern: entry, reason: reasons[entry] };
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new UsageError(`${where}: "${key}"[${i}] debe ser un string o un objeto {"name"|"key": ..., "reason": ...}`);
    }
    const extra = Object.keys(entry).filter((k) => !ENTRY_KEYS.has(k));
    if (extra.length) {
      throw new UsageError(`${where}: "${key}"[${i}]: clave(s) desconocida(s): ${extra.join(', ')} (válidas: name, key, reason)`);
    }
    const pattern = entry.name !== undefined ? entry.name : entry.key;
    if (typeof pattern !== 'string' || !pattern) {
      throw new UsageError(`${where}: "${key}"[${i}] necesita "name" (o "key") como string no vacío`);
    }
    if (entry.name !== undefined && entry.key !== undefined) {
      throw new UsageError(`${where}: "${key}"[${i}] lleva "name" y "key" a la vez; usa solo uno`);
    }
    if (entry.reason !== undefined && typeof entry.reason !== 'string') {
      throw new UsageError(`${where}: "${key}"[${i}]: "reason" debe ser un string`);
    }
    return { pattern, reason: entry.reason !== undefined ? entry.reason : reasons[pattern] };
  });
}

const ENTRY_KEYS = new Set(['name', 'key', 'reason']);

/** Top-level `reasons`: { "<pattern>": "<why>" }, for entries kept as strings. */
function readReasons(value, where) {
  if (value === undefined) return {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || Object.values(value).some((v) => typeof v !== 'string')) {
    throw new UsageError(`${where}: "reasons" debe ser un objeto { "<patrón>": "<motivo>" }`);
  }
  return value;
}

/** Reads an ignores file. Both spellings of each key are accepted. */
function readIgnoreFile(file) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    throw new UsageError(`No se pudo leer ${file}: ${err.message}`);
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new UsageError(`${file}: se esperaba un objeto JSON`);
  }
  const known = new Set(['ignoreMethods', 'ignoreKeys', 'ignoreOrder', 'compareErrorMsg', 'reasons', '$comment']);
  const unknown = Object.keys(raw).filter((k) => !known.has(k));
  // A typo here would silently compare with fewer ignores than the author
  // meant — or, worse, with `ignoreOrder` unset.
  if (unknown.length) {
    throw new UsageError(`${file}: clave(s) desconocida(s): ${unknown.join(', ')} (válidas: ignoreMethods, ignoreKeys, ignoreOrder, compareErrorMsg, reasons, $comment)`);
  }
  for (const k of ['ignoreOrder', 'compareErrorMsg']) {
    if (raw[k] !== undefined && typeof raw[k] !== 'boolean') throw new UsageError(`${file}: "${k}" debe ser true o false`);
  }
  const reasons = readReasons(raw.reasons, file);
  return {
    ignoreMethods: ignoreList(raw.ignoreMethods, file, 'ignoreMethods', reasons),
    ignoreKeys: ignoreList(raw.ignoreKeys, file, 'ignoreKeys', reasons),
    ignoreOrder: raw.ignoreOrder,
    compareErrorMsg: raw.compareErrorMsg,
  };
}

function positiveInt(value, flag, { allowZero = false } = {}) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || (n === 0 && !allowZero)) {
    throw new UsageError(`${flag}: se esperaba un entero ${allowZero ? '>= 0' : 'positivo'}, no "${value}"`);
  }
  return n;
}

/** Command line + ignores file -> the comparison's options. Flags ADD to the
 *  file's lists; a boolean flag overrides the file. */
function buildOptions(options, baselinePath, cwd) {
  const ignoreFile = options.ignoreFile
    ? path.resolve(cwd, options.ignoreFile)
    : findIgnoreFile(baselinePath, cwd);
  if (options.ignoreFile && !fs.existsSync(ignoreFile)) {
    throw new UsageError(`No existe el archivo de ignores: ${ignoreFile}`);
  }
  const fromFile = ignoreFile ? readIgnoreFile(ignoreFile) : { ignoreMethods: [], ignoreKeys: [] };
  const flagEntries = (list) => (list || []).map((pattern) => ({ pattern }));
  const methods = [...fromFile.ignoreMethods, ...flagEntries(options.ignoreMethod)];
  const keys = [...fromFile.ignoreKeys, ...flagEntries(options.ignoreKey)];
  const diffOptions = {
    ignore_methods: methods.map((e) => e.pattern),
    ignore_keys: keys.map((e) => e.pattern),
    ignore_order: options.ignoreOrder === true ? true : fromFile.ignoreOrder === true,
    // commander's --no-error-msg sets errorMsg=false; absent means true.
    // commander's --no-normalize-addresses sets normalizeAddresses=false.
    normalize_addresses: options.normalizeAddresses !== false,
    compare_error_msg: options.errorMsg === false ? false : fromFile.compareErrorMsg !== false,
  };
  const limit = positiveInt(options.limit, '--limit', { allowZero: true });
  if (limit !== undefined) diffOptions.limit = limit;
  const maxSpans = positiveInt(options.maxSpans, '--max-spans');
  if (maxSpans !== undefined) diffOptions.max_spans = maxSpans;
  return { diffOptions, ignoreFile, ignoreEntries: { methods, keys } };
}

/**
 * Streams one JSONL trace into a tree, line by line: a trace can be hundreds
 * of MB and only the folded tree needs to stay in memory.
 */
async function loadTrace(file, tree) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    throw new UsageError(`No existe el archivo: ${file}`);
  }
  if (!stat.isFile()) throw new UsageError(`${file} no es un archivo de traza`);

  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });
  let lines = 0;
  let malformed = 0;
  let v1 = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    lines++;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      malformed++;
      continue;
    }
    // v1 traces (`timestamp`, uppercase ENTER/EXIT, no span_id) carry no call
    // structure this comparison could use.
    if (ev === null || typeof ev !== 'object' || typeof ev.span_id !== 'string') {
      if (ev && typeof ev === 'object' && 'timestamp' in ev) v1++;
      malformed++;
      continue;
    }
    tree.add(ev);
  }
  if (tree.nodes.length === 0 && tree.overCap === 0 && tree.ignoredSpans === 0) {
    throw new UsageError(
      v1 > 0
        ? `${file} es una traza v1 (sin span_id): no se puede comparar. Vuelve a capturarla con flowtrace run.`
        : `${file} no contiene eventos FlowTrace v2 (${lines} línea(s) leída(s))`
    );
  }
  return { lines, malformed };
}

// ---------- human output ----------

const LABELS = {
  result_changed: 'resultado distinto (mismos argumentos)',
  args_changed: 'argumentos distintos',
  error_changed: 'error apareció / desapareció / cambió de tipo',
  error_msg_changed: 'mensaje de error distinto',
  calls_added: 'llamadas nuevas',
  calls_removed: 'llamadas que ya no ocurren',
  calls_reordered: 'llamadas reordenadas',
  count_changed: 'métodos con otra cantidad de llamadas',
};
const ORDER = Object.keys(LABELS);

function fmt(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function fmtError(e) {
  return e ? `${e.type}${e.msg ? `: ${e.msg}` : ''}` : 'sin error';
}

function sampleLines(category, s) {
  if (category === 'count_changed') return [`    ${s.method}: ${s.before} → ${s.after}`];
  const lines = [`    ${s.path.join(' > ')}`];
  if (category === 'calls_reordered') lines.push(`      posición ${s.from} → ${s.to}`);
  if (s.args !== undefined) lines.push(`      args: ${s.args}`);
  if (s.spans > 1) lines.push(`      (${s.spans} spans en el subárbol)`);
  for (const d of s.diff || []) {
    lines.push(`      ${d.path}: ${fmt(d.before)} → ${fmt(d.after)}${d.truncated ? '  [truncado]' : ''}`);
  }
  if (s.more) lines.push(`      … y ${s.more} clave(s) más`);
  if (category === 'error_changed' || category === 'error_msg_changed') {
    lines.push(`      ${fmtError(s.before)} → ${fmtError(s.after)}`);
  }
  if (s.result_changed) lines.push('      (el resultado también cambió)');
  return lines;
}

function render(result, { baseline, current, ignoreFile }) {
  const out = [];
  const same = result.verdict === 'same';
  out.push(`${chalk.bold('flowtrace diff')}  ${same ? chalk.green('IGUAL') : chalk.red('DIFERENTE')}`);
  out.push(chalk.gray(`  base   : ${baseline} (${result.spans_a} spans)`));
  out.push(chalk.gray(`  actual : ${current} (${result.spans_b} spans)`));
  out.push(chalk.gray(`  comparados: ${result.compared_spans} pares de spans${result.order === 'ignored' ? ', sin considerar el orden' : ''}`));
  if (ignoreFile) out.push(chalk.gray(`  ignores: ${ignoreFile}`));
  const ig = result.ignored;
  if (ig.spans_a || ig.spans_b || ig.keys_a || ig.keys_b) {
    out.push(chalk.gray(`  ignorado: ${ig.spans_a}/${ig.spans_b} spans, ${ig.keys_a}/${ig.keys_b} claves (base/actual)`));
  }

  const why = ig.reasons ? [...ig.reasons.methods, ...ig.reasons.keys] : [];
  for (const r of why) out.push(chalk.gray(`    ${r.pattern}: ${r.reason}`));

  for (const category of ORDER) {
    const count = result.summary[category];
    if (!count) continue;
    out.push('');
    out.push(`  ${chalk.yellow(String(count))} ${LABELS[category]}`);
    for (const s of result.samples[category]) out.push(...sampleLines(category, s));
    const hidden = result.omitted[category];
    if (hidden) out.push(chalk.gray(`    … ${hidden} más (usa --limit o --json)`));
  }

  const warnings = [];
  if (!result.complete) {
    warnings.push('La comparación NO es completa: se alcanzó el límite de spans (--max-spans). Un "IGUAL" no está demostrado.');
  }
  if (result.approximate_alignments) {
    warnings.push(`${result.approximate_alignments} lista(s) de llamadas se alinearon de forma aproximada: algún cambio puede aparecer como llamada quitada + llamada nueva.`);
  }
  if (result.truncated_values) {
    warnings.push(`${result.truncated_values} valor(es) truncado(s) por la captura se compararon solo por su prefijo: iguales hasta donde se ven. Sube maxArgLength para compararlos enteros.`);
  }
  for (const note of result.notes) {
    if (/several threads/.test(note)) {
      warnings.push('Las trazas tienen varios hilos: el orden entre hilos no es determinista. Si las diferencias son solo de orden, usa --ignore-order.');
    } else if (/no exit event/.test(note)) {
      warnings.push('Hay llamadas sin evento de salida (proceso cortado o aún en ejecución).');
    }
  }
  if (warnings.length) {
    out.push('');
    for (const w of warnings) out.push(`${chalk.yellow('Aviso:')} ${w}`);
  }
  return out.join('\n');
}

// ---------- main command ----------

/**
 * @returns {Promise<number>} the exit code — never calls process.exit itself,
 * so the caller (and the tests) decide.
 */
async function diffCommand(baseline, current, options = {}, io = {}) {
  const cwd = io.cwd || process.cwd();
  const stdout = io.stdout || ((s) => process.stdout.write(`${s}\n`));
  const stderr = io.stderr || ((s) => process.stderr.write(`${s}\n`));

  try {
    const differPath = resolveDiffer();
    if (!differPath) {
      throw new UsageError('No se encontró el comparador de trazas (vendor/trace-diff). Reinstala @rixmerz/flowtrace.');
    }
    const { BehaviorDiffer } = require(differPath);
    const { diffOptions, ignoreFile, ignoreEntries } = buildOptions(options, baseline, cwd);

    const differ = new BehaviorDiffer(diffOptions);
    const a = differ.tree();
    const b = differ.tree();
    const basePath = path.resolve(cwd, baseline);
    const currentPath = path.resolve(cwd, current);
    const loadedA = await loadTrace(basePath, a);
    const loadedB = await loadTrace(currentPath, b);
    const result = differ.diff(a, b);

    const malformed = loadedA.malformed + loadedB.malformed;
    if (malformed) {
      // stderr, so --json stays parseable.
      stderr(`${chalk.yellow('Aviso:')} se descartaron ${malformed} línea(s) que no son eventos v2 (${loadedA.malformed} base, ${loadedB.malformed} actual).`);
    }

    // The comparison counts what it ignored; the reasons belong to the ignore
    // list, which only this layer reads. List the entries that carry a reason
    // next to those counts so the output says why, not just how much.
    const withReason = (list) => list.filter((e) => e.reason !== undefined).map((e) => ({ pattern: e.pattern, reason: e.reason }));
    const reasons = { methods: withReason(ignoreEntries.methods), keys: withReason(ignoreEntries.keys) };
    if (reasons.methods.length || reasons.keys.length) result.ignored = { ...result.ignored, reasons };

    if (options.json) stdout(JSON.stringify(result, null, 2));
    else stdout(render(result, { baseline, current, ignoreFile: ignoreFile ? path.relative(cwd, ignoreFile) || ignoreFile : null }));

    if (result.verdict === 'different') return 1;
    if (!result.complete) {
      stderr(`${chalk.red('Error:')} comparación incompleta: no se puede afirmar que las trazas sean iguales. Sube --max-spans.`);
      return 2;
    }
    return 0;
  } catch (err) {
    stderr(`${chalk.red('Error:')} ${err.message}`);
    return 2;
  }
}

module.exports = diffCommand;
module.exports._resolveDiffer = resolveDiffer;
module.exports._findIgnoreFile = findIgnoreFile;
module.exports._readIgnoreFile = readIgnoreFile;
module.exports._buildOptions = buildOptions;
module.exports.IGNORE_FILE = IGNORE_FILE;
