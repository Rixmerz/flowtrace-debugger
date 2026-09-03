/**
 * v2 JSONL Parser. Reads schema v2 events (one JSON per line). Drops malformed
 * lines and rows that don't carry trace_id/span_id/ts/event.
 *
 * One pass over the file yields both the events and the file statistics; it
 * used to read the file twice (once for stats, once for events).
 */

'use strict';

const fs = require('fs');
const readline = require('readline');

/**
 * Schema v2 has exactly two event kinds. A failed call is an `exit` carrying
 * `error`; there is no `event: "error"` — accepting one here meant the error
 * counter below counted a row that never exists and reported zero errors on
 * every real trace.
 */
function isLikelyV2(obj) {
  return (
    obj &&
    typeof obj === 'object' &&
    typeof obj.trace_id === 'string' &&
    typeof obj.span_id === 'string' &&
    typeof obj.ts === 'number' &&
    (obj.event === 'enter' || obj.event === 'exit')
  );
}

function emptyStats() {
  return {
    totalEvents: 0,
    enterEvents: 0,
    exitEvents: 0,
    errorEvents: 0,
    malformedLines: 0,
    classes: new Set(),
    traces: new Set(),
    minTs: Infinity,
    maxTs: 0,
  };
}

function accumulate(stats, event) {
  stats.totalEvents++;
  if (event.event === 'enter') stats.enterEvents++;
  else if (event.event === 'exit') {
    stats.exitEvents++;
    if (event.error) stats.errorEvents++;
  }
  if (event.class) stats.classes.add(event.class);
  if (event.trace_id) stats.traces.add(event.trace_id);
  if (typeof event.ts === 'number') {
    stats.minTs = Math.min(stats.minTs, event.ts);
    stats.maxTs = Math.max(stats.maxTs, event.ts);
  }
}

function finish(stats) {
  const { minTs, maxTs } = stats;
  return {
    totalEvents: stats.totalEvents,
    enterEvents: stats.enterEvents,
    exitEvents: stats.exitEvents,
    errorEvents: stats.errorEvents,
    malformedLines: stats.malformedLines,
    uniqueClasses: stats.classes.size,
    uniqueTraces: stats.traces.size,
    classes: Array.from(stats.classes),
    timeRange: {
      startSec: minTs !== Infinity ? minTs : null,
      endSec: maxTs !== 0 ? maxTs : null,
      durationSec: maxTs !== 0 && minTs !== Infinity ? maxTs - minTs : 0,
    },
  };
}

class JSONLParser {
  /** Events and stats from a single read of the file. */
  async parseWithStats(filePath) {
    const events = [];
    const stats = emptyStats();
    await this._each(filePath, (event) => {
      events.push(event);
      accumulate(stats, event);
    }, stats);
    return { events, stats: finish(stats) };
  }

  async parse(filePath) {
    const { events } = await this.parseWithStats(filePath);
    return events;
  }

  async parseStream(filePath, callback) {
    await this._each(filePath, callback, emptyStats());
  }

  async getStats(filePath) {
    const stats = emptyStats();
    await this._each(filePath, (event) => accumulate(stats, event), stats);
    return finish(stats);
  }

  async _each(filePath, callback, stats) {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
    for await (const line of rl) {
      const t = line.trim();
      if (!t) continue;
      let obj;
      try {
        obj = JSON.parse(t);
      } catch {
        stats.malformedLines++;
        continue;
      }
      if (isLikelyV2(obj)) await callback(obj);
      else stats.malformedLines++;
    }
  }
}

module.exports = JSONLParser;
