/**
 * worker_threads fixture: the main thread. Run under `--import bootstrap.mjs`
 * so this file is instrumented like an application would be. `startWorker` is
 * a traced function; the Worker it creates must land inside its span without
 * this file doing anything for it.
 */
import { Worker } from 'node:worker_threads';

export async function startWorker(file) {
  const worker = new Worker(file);
  await new Promise((resolve, reject) => {
    worker.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker exited ${code}`))));
    worker.on('error', reject);
  });
  return 'done';
}

await startWorker(new URL('./worker-child.mjs', import.meta.url));
