/**
 * W3C-compatible id generation using the Web Crypto API.
 *
 * Separate from capture/node's ids.js on purpose: that one imports
 * node:crypto, which does not exist in a browser, and this package must stay
 * importable from a bundler with no Node polyfills.
 */

const HEX = '0123456789abcdef';

/** Fills a byte array from the platform CSPRNG. */
function randomBytes(n) {
  const bytes = new Uint8Array(n);
  // crypto.getRandomValues exists in every browser we target and in Node 19+,
  // so the tests exercise the same code path the browser runs.
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function toHex(bytes) {
  let out = '';
  for (const b of bytes) out += HEX[(b >> 4) & 0x0f] + HEX[b & 0x0f];
  return out;
}

/** 32 lowercase hex characters (128-bit). */
export function newTraceId() {
  return toHex(randomBytes(16));
}

/** 16 lowercase hex characters (64-bit). */
export function newSpanId() {
  return toHex(randomBytes(8));
}
