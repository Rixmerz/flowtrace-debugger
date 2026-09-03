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
import { fileURLToPath } from 'node:url';

// ── 1. CJS hook ──────────────────────────────────────────────
import { install } from './cjs/hook.js';
install();

// ── 2. ESM loader ────────────────────────────────────────────
// register() is available from Node 20.6+.
// The second argument is the parent URL used to resolve relative specifiers
// inside the loader module itself.
const loaderUrl = new URL('./esm/loader.mjs', import.meta.url).href;
register(loaderUrl, import.meta.url);

// ── 3. Trace context in and out ──────────────────────────────
// Inbound: adopt a traceparent left in the environment by whatever spawned us,
// so a child process joins its parent's trace instead of starting a new one.
// Outbound: attach `traceparent` to fetch / http requests and to the
// environment of processes we spawn, so a call made by code we do not own
// still joins the trace on the far side. A caller-set header always wins.
// Opt out of the outbound half with FLOWTRACE_PROPAGATE=0.
import { seedFromEnvironment } from './runtime/context.js';
import { installOutgoingPropagation } from './runtime/propagate.js';
import { installSubprocessPropagation } from './runtime/subprocess.js';
import { installWorkerPropagation } from './runtime/workers.js';
import { buildNodeOptions } from './runtime/node-options.js';

seedFromEnvironment();
installOutgoingPropagation();
installSubprocessPropagation();
installWorkerPropagation();

// ── 4. Worker / child inheritance ────────────────────────────
// See runtime/node-options.js for why this is a file: URL and not a path.
process.env.NODE_OPTIONS = buildNodeOptions(process.env.NODE_OPTIONS, fileURLToPath(import.meta.url));

// ── 5. Init marker ───────────────────────────────────────────
process.env.FLOWTRACE_INITED = '1';
