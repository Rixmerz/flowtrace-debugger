/**
 * worker_threads fixture: the worker. Instrumented through the inherited
 * NODE_OPTIONS; `work` should report the worker's thread label and hang off
 * the span that created the worker.
 */
export function work(n) {
  return n * 2;
}

work(21);
