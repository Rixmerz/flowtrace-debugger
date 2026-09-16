import { randomBytes } from 'node:crypto';

/*
 * Why the ids come from a seeded counter and not from randomBytes per id.
 *
 * randomBytes allocates an async resource — randomFillSync underneath it does
 * too — so with AsyncLocalStorage active, which turns async_hooks on below
 * Node 24, minting an id ran the async_hooks init hook. Deep in a traced call
 * stack that hook is where the stack ran out, and async_hooks answers a throw
 * from a hook with fatalError(): the process dies, no try/catch anywhere in
 * this runtime can contain it, and the stack Node prints ends at
 * node:internal/crypto/random with none of the user's program on it.
 *
 * That was the whole bug. A program that ran fine untraced died on startup
 * under `flowtrace run` — and the report named Node's crypto internals, which
 * is the last place anyone would look for a tracing bug. Drawing the entropy
 * once, at module load, keeps every id off the async_hooks path, so the only
 * stack-exhaustion left is the ordinary catchable kind that instrument.js
 * already fails open on.
 *
 * What these ids have to be is unique, not unguessable: W3C trace context says
 * in as many words that trace and span ids carry no security weight. A random
 * per-process prefix plus a monotonic counter gives uniqueness inside a
 * process by construction, and across processes through the prefix — which is
 * what cross-process propagation needs, since a child joins its parent's trace
 * and both mint span ids into it. Each worker thread has its own module
 * registry and so draws its own prefix, for the same reason.
 *
 * It is also simply cheaper: one syscall at startup instead of one per span.
 */

/** 16 bytes drawn once, split into the two prefixes. */
const SEED = randomBytes(16).toString('hex');

/** 96 bits of the seed. Leaves 32 bits of trace id for the counter. */
const TRACE_PREFIX = SEED.slice(0, 24);
/** 32 bits of the seed. Leaves 32 bits of span id for the counter. */
const SPAN_PREFIX = SEED.slice(24, 32);

/*
 * Both counters start at 0 and are incremented before use, so the first id
 * ends in ...00000001. That is deliberate: W3C forbids an all-zero trace or
 * span id, and a counter that is never zero makes that impossible to emit even
 * if the random prefix came up all zeros.
 */
let traceCounter = 0;
let spanCounter = 0;

/** Wraps at 2^32 — `>>> 0` is what keeps the counter inside its 8 hex chars. */
function nextHex8(n) {
  return (n >>> 0).toString(16).padStart(8, '0');
}

/**
 * Returns a W3C-compatible trace ID: 32 lowercase hex characters (128-bit).
 */
export function newTraceId() {
  traceCounter = (traceCounter + 1) >>> 0;
  return TRACE_PREFIX + nextHex8(traceCounter);
}

/**
 * Returns a W3C-compatible span ID: 16 lowercase hex characters (64-bit).
 */
export function newSpanId() {
  spanCounter = (spanCounter + 1) >>> 0;
  return SPAN_PREFIX + nextHex8(spanCounter);
}
