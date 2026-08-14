/**
 * Trace collector: POST /api/trace
 *
 * Exists because a browser cannot write flowtrace.jsonl. A capture layer
 * running in the page has nowhere to put its events, so it ships them here and
 * this appends them to the same JSONL file every other tool already reads —
 * which is the point: browser spans land in the same trace as the server spans
 * they triggered, correlated by traceparent, with no new format to support.
 *
 * This endpoint takes untrusted input from the network and appends it to a
 * file on disk, so it is deliberately strict:
 *
 *   - Every event is validated against schema/flowtrace-v2.json. Anything that
 *     fails is dropped, never written. Without this, one page could poison the
 *     trace file for every consumer of it.
 *   - The destination path is server-side configuration only. Nothing in the
 *     request influences where bytes land.
 *   - Body size and batch length are capped, so a single request cannot fill
 *     the disk or pin the event loop.
 *   - CORS is restricted to localhost by default: any site the developer
 *     happens to visit could otherwise POST into their trace file.
 */

'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const Ajv = require('ajv/dist/2020');

const router = express.Router();

/** Max decoded body. sendBeacon itself is capped near 64 KB by browsers. */
const MAX_BODY = process.env.FLOWTRACE_COLLECTOR_MAX_BODY || '1mb';

/** Max events per request, independent of byte size. */
const MAX_EVENTS = (() => {
  const n = Number(process.env.FLOWTRACE_COLLECTOR_MAX_EVENTS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1000;
})();

/**
 * Where events are appended. Server-side only — never taken from the request,
 * or a caller could write anywhere the process can reach.
 */
function outputPath() {
  return path.resolve(process.env.FLOWTRACE_COLLECTOR_OUTPUT || 'flowtrace.jsonl');
}

const schemaPath = path.resolve(__dirname, '../../../schema/flowtrace-v2.json');
const validateEvent = new Ajv({ strict: false, allErrors: false })
  .compile(JSON.parse(fs.readFileSync(schemaPath, 'utf8')));

/**
 * navigator.sendBeacon sends a Blob whose type the caller chooses, and the
 * common choice is text/plain because it avoids a CORS preflight. Express's
 * JSON parser only claims application/json, so text/* is parsed here too —
 * otherwise beacons sent on page unload, the ones that matter most because
 * they carry the tail of the session, would arrive as an empty body.
 */
const parseBody = [
  express.json({ limit: MAX_BODY }),
  express.text({ limit: MAX_BODY, type: ['text/plain', 'text/*'] }),
];

/** Accepts `[...]` or `{events: [...]}`. */
function extractEvents(body) {
  let parsed = body;
  if (typeof parsed === 'string') {
    if (parsed.trim() === '') return { error: 'empty body' };
    try {
      parsed = JSON.parse(parsed);
    } catch (e) {
      return { error: `body is not JSON: ${e.message}` };
    }
  }
  if (Array.isArray(parsed)) return { events: parsed };
  if (parsed && Array.isArray(parsed.events)) return { events: parsed.events };
  return { error: 'expected an array of events, or {events: [...]}' };
}

router.post('/trace', parseBody, (req, res) => {
  const { events, error } = extractEvents(req.body);
  if (error) return res.status(400).json({ error });

  if (events.length > MAX_EVENTS) {
    return res.status(413).json({
      error: `batch of ${events.length} exceeds the limit of ${MAX_EVENTS} events`,
    });
  }

  const valid = [];
  const rejected = [];
  for (let i = 0; i < events.length; i++) {
    if (validateEvent(events[i])) {
      valid.push(events[i]);
    } else {
      rejected.push({
        index: i,
        reason: (validateEvent.errors || [])
          .map((e) => `${e.instancePath || '/'} ${e.message}`)
          .join('; '),
      });
    }
  }

  // Partial acceptance: dropping a whole batch for one malformed event would
  // lose good spans, but silently keeping the rest would hide a broken emitter.
  // So the valid ones are written and the rejects are reported and logged.
  if (rejected.length > 0) {
    console.error(
      `[flowtrace] collector rejected ${rejected.length}/${events.length} events: ` +
      rejected.slice(0, 3).map((r) => `#${r.index} ${r.reason}`).join(' | ')
    );
  }

  const target = outputPath();
  if (valid.length > 0) {
    try {
      fs.appendFileSync(target, valid.map((e) => JSON.stringify(e)).join('\n') + '\n');
    } catch (e) {
      console.error(`[flowtrace] collector could not write ${target}: ${e.message}`);
      return res.status(500).json({ error: 'could not append to the trace file' });
    }
  }

  res.json({ accepted: valid.length, rejected });
});

/**
 * Turns body-parser failures into JSON. Without this an oversized or malformed
 * body surfaces as Express's default HTML error page plus a stack trace on
 * stderr — noise for the operator, and unparseable for the page that sent it.
 */
router.use('/trace', (err, req, res, next) => {
  if (!err) return next();
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: `body exceeds the limit of ${MAX_BODY}` });
  }
  if (err.status === 400 || err instanceof SyntaxError) {
    return res.status(400).json({ error: `malformed body: ${err.message}` });
  }
  return next(err);
});

/** Lets a page discover the collector and its limits before sending. */
router.get('/trace/config', (req, res) => {
  res.json({ maxEvents: MAX_EVENTS, maxBody: MAX_BODY, output: outputPath() });
});

module.exports = router;
module.exports.outputPath = outputPath;
