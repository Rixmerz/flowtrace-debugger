/**
 * FlowTrace v2 bootstrap — single injection point.
 *
 * Usage:  node --import file:///absolute/path/to/bootstrap.mjs your-app.js
 *
 * This file:
 *   1. Installs the CJS hook (Module.prototype._compile patch).
 *   2. Registers the ESM loader via module.register().
 *   3. Installs outgoing traceparent propagation (fetch / http).
 *   4. Mutates NODE_OPTIONS so that worker_threads and child_process
 *      spawned via Node inherit the same --import flag (idempotent).
 *   5. Sets FLOWTRACE_INITED=1.
 */

import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ── 1. CJS hook ──────────────────────────────────────────────
import { install } from './cjs/hook.js';
install();

// ── 2. ESM loader ────────────────────────────────────────────
// register() is available from Node 20.6+.
// The second argument is the parent URL used to resolve relative specifiers
// inside the loader module itself.
const loaderUrl = new URL('./esm/loader.mjs', import.meta.url).href;
register(loaderUrl, import.meta.url);

// ── 3. Outgoing trace context ────────────────────────────────
// Attaches `traceparent` to outbound fetch / http requests while a span is
// active, so a call made by code we do not own still joins the trace on the
// far side. Never overwrites a caller-set header; opt out with
// FLOWTRACE_PROPAGATE=0.
import { installOutgoingPropagation } from './runtime/propagate.js';
installOutgoingPropagation();

// ── 4. Worker propagation ────────────────────────────────────
const bootstrapAbsPath = fileURLToPath(import.meta.url);
const bootstrapFlag    = `--import file://${bootstrapAbsPath}`;

const existing = process.env.NODE_OPTIONS ?? '';
if (!existing.includes(bootstrapFlag)) {
  process.env.NODE_OPTIONS = existing
    ? `${existing} ${bootstrapFlag} --enable-source-maps`
    : `${bootstrapFlag} --enable-source-maps`;
}

// ── 5. Init marker ───────────────────────────────────────────
process.env.FLOWTRACE_INITED = '1';
