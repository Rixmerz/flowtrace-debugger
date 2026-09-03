/**
 * Ships browser events to the dashboard collector (POST /api/trace).
 *
 * Two constraints shape this and neither applies to the file-writing emitters:
 *
 * 1. Every send crosses the network, so events are batched. One request per
 *    traced call would make the instrumentation slower than the thing it is
 *    measuring.
 * 2. The page can vanish at any moment — a navigation, a closed tab. A normal
 *    fetch issued during unload is cancelled, so the tail of the session, which
 *    is usually the part you were debugging, is exactly what gets lost.
 *    navigator.sendBeacon exists for this: the browser takes ownership of the
 *    request and completes it after the document is gone.
 *
 * The beacon is sent as text/plain rather than application/json on purpose:
 * application/json makes it a non-simple request, which triggers a CORS
 * preflight, and a preflight during unload is not guaranteed to complete. The
 * collector parses text/plain for this reason.
 */

const DEFAULTS = {
  endpoint: 'http://localhost:8765/api/trace',
  /** Flush once this many events are queued. */
  batchSize: 50,
  /** Flush at least this often, in ms, so a quiet page still reports. */
  flushIntervalMs: 5000,
  /** Hard cap on the queue, so a runaway page cannot exhaust memory. */
  maxQueue: 1000,
};

let config = { ...DEFAULTS };
let queue = [];
let timer = null;
let dropped = 0;
let unloadInstalled = false;
const warned = new Set();

/**
 * One line per cause, ever. The collector being unreachable is a steady state
 * on a laptop; a console.warn per batch would be noise, and silence was the
 * previous behaviour — a page could run for an hour with the collector down
 * and nothing said so.
 */
function warnOnce(cause, message) {
  if (warned.has(cause)) return;
  warned.add(cause);
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn(`[flowtrace] ${message}`);
  }
}

/** @param {Partial<typeof DEFAULTS>} options */
export function configure(options = {}) {
  config = { ...DEFAULTS, ...options };
  // Browsers block plaintext requests from an https page (mixed content), and
  // they do it before the request leaves — every flush would fail and the
  // failure path below is the only thing that would ever mention it.
  if (typeof location !== 'undefined' && location.protocol === 'https:'
      && String(config.endpoint).startsWith('http:')) {
    warnOnce('mixed-content',
      `endpoint ${config.endpoint} is plaintext but the page is https: the browser will block every flush as mixed content. Use an https collector endpoint.`);
  }
}

/** Queues one event, flushing if the batch is full. */
export function emit(event) {
  if (queue.length >= config.maxQueue) {
    // Drop rather than grow without bound. Counted so the loss is visible
    // instead of silent — a trace with a hole in it that nobody knows about is
    // worse than one that says it has a hole.
    dropped++;
    return;
  }
  queue.push(event);
  if (queue.length >= config.batchSize) {
    void flush();
    return;
  }
  if (timer === null && config.flushIntervalMs > 0) {
    timer = setTimeout(() => { timer = null; void flush(); }, config.flushIntervalMs);
  }
}

/** How many events were dropped: queue overflow, or a batch the collector never got. */
export function droppedCount() {
  return dropped;
}

/** Current queue depth. Test seam. */
export function queueDepth() {
  return queue.length;
}

/**
 * Sends everything queued.
 * @param {{beacon?: boolean}} opts - beacon:true uses sendBeacon (for unload).
 * @returns {Promise<boolean>} whether a send was attempted
 */
export async function flush({ beacon = false } = {}) {
  if (timer !== null) { clearTimeout(timer); timer = null; }
  if (queue.length === 0) return false;

  const batch = queue;
  queue = [];
  const body = JSON.stringify(batch);

  if (beacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    try {
      const ok = navigator.sendBeacon(config.endpoint, new Blob([body], { type: 'text/plain' }));
      if (ok) return true;
      // A false return means the browser refused to queue it (usually over its
      // beacon size limit). Fall through to fetch, which may still work if the
      // page is not actually going away.
    } catch { /* fall through */ }
  }

  try {
    const res = await fetch(config.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    });
    if (res && res.ok === false) {
      dropped += batch.length;
      warnOnce('rejected', `collector ${config.endpoint} answered ${res.status}; that batch of ${batch.length} event(s) is lost`);
    }
    return true;
  } catch (e) {
    // The collector being down must never break the traced application, and
    // must never retry into an unbounded buffer either. The batch is gone —
    // but counted, and said once: a trace with a hole nobody knows about is
    // worse than one that says it has a hole.
    dropped += batch.length;
    warnOnce('unreachable', `collector ${config.endpoint} unreachable (${e?.message ?? e}); events are being dropped`);
    return true;
  }
}

/**
 * Flushes on the events that actually precede a page going away.
 *
 * `visibilitychange` to hidden is the reliable one; `pagehide` covers the
 * bfcache path. `unload` is deliberately not used — it is unreliable and
 * disables the bfcache in some browsers, making the page slower for the sake
 * of instrumentation.
 */
export function installUnloadFlush() {
  if (typeof document === 'undefined' || typeof addEventListener !== 'function') return false;
  // Idempotent: a second initFlowtrace (hydration, HMR, a re-mounted root)
  // must not flush twice per unload.
  if (unloadInstalled) return true;
  unloadInstalled = true;
  const send = () => { void flush({ beacon: true }); };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') send();
  });
  addEventListener('pagehide', send);
  return true;
}

/** Clears queue and config. Test seam. */
export function resetEmitter() {
  if (timer !== null) { clearTimeout(timer); timer = null; }
  queue = [];
  dropped = 0;
  config = { ...DEFAULTS };
  unloadInstalled = false;
  warned.clear();
}
