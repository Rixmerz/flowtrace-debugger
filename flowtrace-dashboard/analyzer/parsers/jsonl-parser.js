/**
 * JSONL Parser for FlowTrace logs
 * Reads and parses flowtrace.jsonl files
 */

const fs = require('fs');
const readline = require('readline');

class JSONLParser {
  /**
   * Parse JSONL file and return array of events
   * @param {string} filePath - Path to flowtrace.jsonl
   * @returns {Promise<Array>} Array of parsed events
   */
  async parse(filePath) {
    const events = [];

    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      if (line.trim()) {
        try {
          const event = JSON.parse(line);
          events.push(event);
        } catch (error) {
          console.error(`Error parsing line: ${line.substring(0, 50)}...`);
        }
      }
    }

    return events;
  }

  /**
   * Parse JSONL file and stream events (for large files)
   * @param {string} filePath - Path to flowtrace.jsonl
   * @param {Function} callback - Called for each event
   */
  async parseStream(filePath, callback) {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      if (line.trim()) {
        try {
          const event = JSON.parse(line);
          await callback(event);
        } catch (error) {
          console.error(`Error parsing line: ${error.message}`);
        }
      }
    }
  }

  /**
   * Get basic statistics about the file
   * @param {string} filePath - Path to flowtrace.jsonl
   * @returns {Promise<Object>} Basic stats
   */
  async getStats(filePath) {
    let totalEvents = 0;
    let enterEvents = 0;
    let exitEvents = 0;
    let exceptionEvents = 0;
    const classes = new Set();
    let minTimestamp = Infinity;
    let maxTimestamp = 0;

    await this.parseStream(filePath, (event) => {
      totalEvents++;

      if (event.event === 'ENTER') enterEvents++;
      if (event.event === 'EXIT') exitEvents++;
      if (event.event === 'EXCEPTION') exceptionEvents++;

      if (event.class) classes.add(event.class);

      if (event.timestamp) {
        minTimestamp = Math.min(minTimestamp, event.timestamp);
        maxTimestamp = Math.max(maxTimestamp, event.timestamp);
      }
    });

    return {
      totalEvents,
      enterEvents,
      exitEvents,
      exceptionEvents,
      uniqueClasses: classes.size,
      classes: Array.from(classes),
      timeRange: {
        start: minTimestamp !== Infinity ? new Date(minTimestamp) : null,
        end: maxTimestamp !== 0 ? new Date(maxTimestamp) : null,
        durationMs: maxTimestamp - minTimestamp
      }
    };
  }
}

module.exports = JSONLParser;
