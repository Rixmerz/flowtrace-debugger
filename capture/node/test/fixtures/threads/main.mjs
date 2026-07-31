import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

export function mainWork() {
  return 'main-done';
}

mainWork();

const worker = new Worker(fileURLToPath(new URL('./worker-task.mjs', import.meta.url)));
worker.on('exit', () => process.stdout.write('worker exited\n'));
