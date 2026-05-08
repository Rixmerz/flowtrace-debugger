import { randomBytes } from 'node:crypto';

/**
 * Returns a W3C-compatible trace ID: 32 lowercase hex characters (128-bit).
 */
export function newTraceId() {
  return randomBytes(16).toString('hex');
}

/**
 * Returns a W3C-compatible span ID: 16 lowercase hex characters (64-bit).
 */
export function newSpanId() {
  return randomBytes(8).toString('hex');
}
