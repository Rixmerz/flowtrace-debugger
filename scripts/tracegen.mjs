#!/usr/bin/env node
/**
 * Synthetic FlowTrace v2 trace generator, for load-testing the consumers
 * (MCP server, dashboard, CLI) without running a real capture.
 *
 *   node scripts/tracegen.mjs --traces 100 --depth 6 --fanout 3 \
 *     --error-rate 0.05 --seed 1 -o /tmp/big.jsonl
 *
 * Output is schema-valid v2 (`--validate` checks it with ajv). It is NOT a
 * substitute for golden fixtures: those assert what a capture layer really
 * emits, this only produces a plausible shape at a chosen size. Deterministic
 * for a given --seed, so a benchmark can be repeated.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

function parseArgs(argv) {
  const o = { traces: 10, depth: 4, fanout: 3, errorRate: 0.02, seed: 1, out: null, validate: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--traces') o.traces = Number(next());
    else if (a === '--depth') o.depth = Number(next());
    else if (a === '--fanout') o.fanout = Number(next());
    else if (a === '--error-rate') o.errorRate = Number(next());
    else if (a === '--seed') o.seed = Number(next());
    else if (a === '-o' || a === '--out') o.out = next();
    else if (a === '--validate') o.validate = true;
    else throw new Error(`unknown argument ${a}`);
  }
  for (const k of ['traces', 'depth', 'fanout']) {
    if (!Number.isInteger(o[k]) || o[k] < 1) throw new Error(`--${k} must be a positive integer`);
  }
  if (!(o.errorRate >= 0 && o.errorRate <= 1)) throw new Error('--error-rate must be in [0, 1]');
  return o;
}

// mulberry32: tiny, seedable, good enough for shape.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CLASSES = ['OrderService', 'PaymentGateway', 'InventoryRepo', 'PriceCalculator', 'Mailer'];
const METHODS = ['handle', 'validate', 'load', 'save', 'compute', '_normalize', '_retry', 'send'];

export function generate(opts) {
  const rand = rng(opts.seed);
  const hex = (n) => { let s = ''; for (let i = 0; i < n; i++) s += Math.floor(rand() * 16).toString(16); return s; };
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const events = [];
  let clock = 1_700_000_000; // seconds

  for (let t = 0; t < opts.traces; t++) {
    const traceId = hex(32);
    // Returns duration in ns. Children run sequentially inside the parent.
    const call = (parentId, depth) => {
      const spanId = hex(16);
      const cls = pick(CLASSES);
      const method = pick(METHODS);
      const common = {
        trace_id: traceId, span_id: spanId, parent_id: parentId, thread: 'main', lang: 'java',
        module: 'com.example.shop', class: cls, method,
        visibility: method.startsWith('_') ? 'private' : 'public',
        args: { id: Math.floor(rand() * 1000) }, depth,
      };
      const start = clock;
      events.push({ ts: start, event: 'enter', ...common });
      let dur = Math.floor(rand() * 200_000) + 1_000; // own time
      clock += dur / 1e9;
      if (depth + 1 < opts.depth) {
        const kids = Math.floor(rand() * (opts.fanout + 1));
        for (let k = 0; k < kids; k++) dur += call(spanId, depth + 1);
      }
      const exit = { ts: start + dur / 1e9, event: 'exit', ...common, result: { ok: true }, duration_ns: dur };
      if (rand() < opts.errorRate) {
        exit.result = {};
        exit.error = { type: 'IllegalStateException', msg: `synthetic failure in ${cls}.${method}`, stack: [`at ${cls}.${method}`] };
      }
      clock = exit.ts;
      events.push(exit);
      return dur;
    };
    call(null, 0);
    clock += 0.001;
  }
  return events;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  const events = generate(opts);
  if (opts.validate) {
    const { default: Ajv2020 } = await import('ajv/dist/2020.js');
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const validate = new Ajv2020({ strict: false }).compile(JSON.parse(readFileSync(join(root, 'schema/flowtrace-v2.json'), 'utf8')));
    const bad = events.findIndex((e) => !validate(e));
    if (bad >= 0) {
      console.error(`event ${bad} is not schema-valid:`, JSON.stringify(validate.errors));
      process.exit(1);
    }
  }
  const text = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  if (opts.out) {
    writeFileSync(opts.out, text);
    console.error(`${events.length} events, ${opts.traces} traces -> ${opts.out}`);
  } else process.stdout.write(text);
}
