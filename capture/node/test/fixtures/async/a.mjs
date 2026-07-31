export async function slow(ms) {
  await new Promise(r => setTimeout(r, ms));
  return 'done-' + ms;
}
export function* gen() { yield 1; yield 2; }

const v = await slow(60);
console.log('result', v);
console.log('gen', [...gen()]);
