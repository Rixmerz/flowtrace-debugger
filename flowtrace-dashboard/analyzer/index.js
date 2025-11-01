/**
 * FlowTrace Performance Analyzer
 * Main entry point for analysis
 */

const JSONLParser = require('./parsers/jsonl-parser');
const PerformanceAnalyzer = require('./metrics/performance');

class FlowTraceAnalyzer {
  /**
   * Analyze a FlowTrace JSONL file
   * @param {string} filePath - Path to flowtrace.jsonl
   * @returns {Promise<Object>} Analysis results
   */
  async analyze(filePath) {
    const parser = new JSONLParser();

    // Get basic stats
    const stats = await parser.getStats(filePath);

    // Parse all events
    const events = await parser.parse(filePath);

    // Analyze performance
    const perfAnalyzer = new PerformanceAnalyzer(events);
    const performance = perfAnalyzer.analyze();

    return {
      fileStats: stats,
      performance
    };
  }

  /**
   * Quick analysis with just slow methods
   * @param {string} filePath - Path to flowtrace.jsonl
   * @param {number} top - Number of top results
   * @returns {Promise<Object>} Slow methods
   */
  async quickAnalyze(filePath, top = 10) {
    const parser = new JSONLParser();
    const events = await parser.parse(filePath);

    const perfAnalyzer = new PerformanceAnalyzer(events);

    return {
      slowMethods: perfAnalyzer.findSlowMethods(top),
      summary: perfAnalyzer.getSummary()
    };
  }
}

module.exports = FlowTraceAnalyzer;
