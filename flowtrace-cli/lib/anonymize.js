/**
 * Anonymize a FlowTrace v2 trace so it can be shared (an issue, a model
 * conversation) without the values it recorded.
 *
 * Redaction at capture time removes values whose *key* looks sensitive; this
 * removes values regardless of key. Every string in args / result / error.msg
 * becomes a keyed hash, so equal values stay equal — "the same id reached
 * both calls" survives, the id itself does not. Keys, types, the tree shape
 * and timings are kept: they are what makes a trace worth reading.
 *
 * The hash is HMAC-SHA256 with a salt. The default salt is random per run, so
 * a short value (a status, a small integer rendered as text) cannot be
 * recovered by hashing guesses. Pass the same --salt to two runs to keep them
 * comparable with trace_diff.
 */
'use strict';

const crypto = require('crypto');

function hasher(salt) {
  return (value) => 'h:' + crypto.createHmac('sha256', salt).update(String(value)).digest('hex').slice(0, 12);
}

function anonymizeValue(v, h, opts) {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return opts.hashNumbers ? h(v) : v;
  if (typeof v === 'string') {
    // Markers the capture layers emit are not user data; keep them readable.
    if (v === '<redacted>') return v;
    if (v.startsWith('<truncated:')) return '<truncated>';
    return h(v);
  }
  if (Array.isArray(v)) return v.map((x) => anonymizeValue(x, h, opts));
  if (typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = anonymizeValue(x, h, opts);
    return out;
  }
  return v;
}

/**
 * @param {object} event  one v2 event
 * @param {{salt?: string, names?: boolean, hashNumbers?: boolean}} opts
 *   names: also hash module / class / method / thread
 */
function anonymizeEvent(event, opts = {}) {
  const h = opts._h || hasher(opts.salt ?? crypto.randomBytes(16).toString('hex'));
  const out = { ...event };
  if ('args' in out) out.args = anonymizeValue(out.args, h, opts);
  if ('result' in out) out.result = anonymizeValue(out.result, h, opts);
  if (out.error) {
    out.error = {
      type: out.error.type,
      msg: h(out.error.msg),
      // Frames name files and lines of the user's code; count is enough to
      // show how deep the failure was.
      stack: (out.error.stack || []).map(() => '<frame>'),
    };
  }
  if (opts.names) {
    for (const k of ['module', 'class', 'method', 'thread']) {
      if (typeof out[k] === 'string' && out[k]) out[k] = h(out[k]);
    }
  }
  return out;
}

/** Anonymize a whole trace with one salt, so hashes agree across events. */
function anonymizeEvents(events, opts = {}) {
  const salt = opts.salt ?? crypto.randomBytes(16).toString('hex');
  const o = { ...opts, _h: hasher(salt) };
  return events.map((e) => anonymizeEvent(e, o));
}

module.exports = { anonymizeEvent, anonymizeEvents };
