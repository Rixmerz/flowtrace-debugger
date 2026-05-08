/**
 * v2 JSONL Parser. Reads schema v2 events (one JSON per line). Drops malformed
 * lines and rows that don't carry trace_id/span_id/ts/event.
 */

'use strict';

const fs = require('fs');
const readline = require('readline');

function isLikelyV2(obj) {
  return (
    obj &&
    typeof obj === 'object' &&
    typeof obj.trace_id === 'string' &&
    typeof obj.span_id === 'string' &&
    typeof obj.ts === 'number' &&
    (obj.event === 'enter' || obj.event === 'exit' || obj.event === 'error')
  );
}

class JSONLParser {
  async parse(filePath) {
    const events = [];
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of rl) {
      const t = line.trim();
      if (!t) continue;
      try {
        const obj = JSON.parse(t);
        if (isLikelyV2(obj)) events.push(obj);
      } catch {
        // drop malformed
      }
    }
    return events;
  }

  async parseStream(filePath, callback) {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
    for await (const line of rl) {
      const t = line.trim();
      if (!t) continue;
      try {
        const obj = JSON.parse(t);
        if (isLikelyV2(obj)) await callback(obj);
      } catch { /* ignore */ }
    }
  }

  async getStats(filePath) {
    let totalEvents = 0;
    let enterEvents = 0;
    let exitEvents = 0;
    let errorEvents = 0;
    const classes = new Set();
    const traces = new Set();
    let minTs = Infinity;
    let maxTs = 0;

    await this.parseStream(filePath, (event) => {
      totalEvents++;
      if (event.event === 'enter') enterEvents++;
      else if (event.event === 'exit') exitEvents++;
      else if (event.event === 'error') errorEvents++;
      if (event.class) classes.add(event.class);
      if (event.trace_id) traces.add(event.trace_id);
      if (typeof event.ts === 'number') {
        minTs = Math.min(minTs, event.ts);
        maxTs = Math.max(maxTs, event.ts);
      }
    });

    return {
      totalEvents,
      enterEvents,
      exitEvents,
      errorEvents,
      uniqueClasses: classes.size,
      uniqueTraces: traces.size,
      classes: Array.from(classes),
      timeRange: {
        startSec: minTs !== Infinity ? minTs : null,
        endSec: maxTs !== 0 ? maxTs : null,
        durationSec: maxTs !== 0 && minTs !== Infinity ? maxTs - minTs : 0,
      },
    };
  }
}

module.exports = JSONLParser;
