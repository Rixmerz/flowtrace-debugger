/** Same as spawn-parent-named.mjs but via a DEFAULT import of child_process. */

import child_process from 'node:child_process';

export function callChild(childPath, childOut) {
  const result = child_process.spawnSync(process.execPath, [childPath], {
    env: { ...process.env, FLOWTRACE_OUTPUT: childOut },
    encoding: 'utf8',
  });
  return result.status;
}

const [childPath, childOut] = process.argv.slice(2);
process.stdout.write(`status=${callChild(childPath, childOut)}\n`);
