/**
 * Spawns a traced child via a NAMED ESM import of child_process.
 *
 * This is the import style that a snapshot-taking ESM facade would break, so
 * this fixture is the regression guard for the createRequire patch strategy in
 * src/runtime/subprocess.js.
 */

import { spawnSync } from 'node:child_process';

export function callChild(childPath, childOut) {
  const result = spawnSync(process.execPath, [childPath], {
    env: { ...process.env, FLOWTRACE_OUTPUT: childOut },
    encoding: 'utf8',
  });
  return result.status;
}

const [childPath, childOut] = process.argv.slice(2);
process.stdout.write(`status=${callChild(childPath, childOut)}\n`);
