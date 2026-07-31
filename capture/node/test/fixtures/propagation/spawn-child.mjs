/** Traced child: one function, so the test can find its root span. */

export function childWork() {
  return 'done';
}

process.stdout.write(`child=${childWork()}\n`);
