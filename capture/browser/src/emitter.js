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

/** @param {Partial<typeof DEFAULTS>} options */
export function configure(options = {}) {
  config = { ...DEFAULTS, ...options };
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

/** How many events were dropped for exceeding maxQueue. */
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
    await fetch(config.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    });
    return true;
  } catch {
    // The collector being down must never break the traced application, and
    // must never retry into an unbounded buffer either. The batch is gone.
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
}
