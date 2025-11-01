/**
 * Performance Analyzer
 * Analyzes FlowTrace events to find performance bottlenecks
 */

class PerformanceAnalyzer {
  constructor(events) {
    this.events = events;
    this.methodStats = new Map();
    this.callStacks = new Map();
  }

  /**
   * Analyze all events and return comprehensive performance metrics
   */
  analyze() {
    this._buildMethodStats();

    return {
      slowMethods: this.findSlowMethods(),
      bottlenecks: this.findBottlenecks(),
      timeDistribution: this.calculateTimeDistribution(),
      errorHotspots: this.findErrorHotspots(),
      summary: this.getSummary()
    };
  }

  /**
   * Build statistics for each method
   * @private
   */
  _buildMethodStats() {
    const exitEvents = this.events.filter(e => e.event === 'EXIT');

    exitEvents.forEach(event => {
      const key = `${event.class}.${event.method}`;

      if (!this.methodStats.has(key)) {
        this.methodStats.set(key, {
          class: event.class,
          method: event.method,
          calls: [],
          exceptions: 0
        });
      }

      const stats = this.methodStats.get(key);
      stats.calls.push({
        duration: event.durationMicros || 0,
        timestamp: event.timestamp,
        hasException: !!event.exception
      });

      if (event.exception) {
        stats.exceptions++;
      }
    });
  }

  /**
   * Find the slowest methods by average duration
   * @param {number} top - Number of top results to return
   * @returns {Array} Top slow methods with statistics
   */
  findSlowMethods(top = 20) {
    const methods = Array.from(this.methodStats.entries()).map(([name, stats]) => {
      const durations = stats.calls.map(c => c.duration);
      const sorted = durations.sort((a, b) => a - b);

      const sum = durations.reduce((a, b) => a + b, 0);
      const avg = sum / durations.length;
      const min = Math.min(...durations);
      const max = Math.max(...durations);
      const p50 = sorted[Math.floor(sorted.length * 0.5)];
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      const p99 = sorted[Math.floor(sorted.length * 0.99)];

      return {
        name,
        class: stats.class,
        method: stats.method,
        callCount: durations.length,
        avgDuration: Math.round(avg),
        minDuration: Math.round(min),
        maxDuration: Math.round(max),
        p50: Math.round(p50),
        p95: Math.round(p95),
        p99: Math.round(p99),
        totalTime: Math.round(sum),
        exceptions: stats.exceptions
      };
    });

    // Sort by average duration descending
    methods.sort((a, b) => b.avgDuration - a.avgDuration);

    return methods.slice(0, top);
  }

  /**
   * Find bottlenecks (high frequency + high duration = high impact)
   * @param {number} top - Number of results
   * @returns {Array} Methods with highest impact
   */
  findBottlenecks(top = 10) {
    const methods = Array.from(this.methodStats.entries()).map(([name, stats]) => {
      const durations = stats.calls.map(c => c.duration);
      const sum = durations.reduce((a, b) => a + b, 0);
      const avg = sum / durations.length;

      // Impact score = callCount * avgDuration
      const impactScore = durations.length * avg;

      return {
        name,
        class: stats.class,
        method: stats.method,
        callCount: durations.length,
        avgDuration: Math.round(avg),
        totalTime: Math.round(sum),
        impactScore: Math.round(impactScore)
      };
    });

    // Sort by impact score descending
    methods.sort((a, b) => b.impactScore - a.impactScore);

    return methods.slice(0, top);
  }

  /**
   * Calculate time distribution across methods
   * @returns {Object} Time distribution data
   */
  calculateTimeDistribution() {
    const totalTime = Array.from(this.methodStats.values())
      .reduce((sum, stats) => {
        const methodTotal = stats.calls.reduce((s, c) => s + c.duration, 0);
        return sum + methodTotal;
      }, 0);

    const distribution = Array.from(this.methodStats.entries()).map(([name, stats]) => {
      const methodTotal = stats.calls.reduce((sum, c) => sum + c.duration, 0);
      const percentage = totalTime > 0 ? (methodTotal / totalTime) * 100 : 0;

      return {
        name,
        class: stats.class,
        method: stats.method,
        totalTime: Math.round(methodTotal),
        percentage: Math.round(percentage * 100) / 100
      };
    });

    // Sort by percentage descending
    distribution.sort((a, b) => b.percentage - a.percentage);

    return {
      totalTime: Math.round(totalTime),
      distribution: distribution.slice(0, 20),
      others: {
        percentage: Math.round((1 - distribution.slice(0, 20).reduce((sum, d) => sum + d.percentage, 0) / 100) * 100 * 100) / 100
      }
    };
  }

  /**
   * Find methods with frequent exceptions
   * @returns {Array} Methods with errors
   */
  findErrorHotspots() {
    const methods = Array.from(this.methodStats.entries())
      .filter(([_, stats]) => stats.exceptions > 0)
      .map(([name, stats]) => {
        const errorRate = (stats.exceptions / stats.calls.length) * 100;

        return {
          name,
          class: stats.class,
          method: stats.method,
          totalCalls: stats.calls.length,
          exceptions: stats.exceptions,
          errorRate: Math.round(errorRate * 100) / 100
        };
      });

    // Sort by exception count descending
    methods.sort((a, b) => b.exceptions - a.exceptions);

    return methods;
  }

  /**
   * Get summary statistics
   * @returns {Object} Summary
   */
  getSummary() {
    const allDurations = [];
    let totalCalls = 0;
    let totalExceptions = 0;

    this.methodStats.forEach(stats => {
      stats.calls.forEach(call => {
        allDurations.push(call.duration);
        totalCalls++;
        if (call.hasException) totalExceptions++;
      });
    });

    if (allDurations.length === 0) {
      return {
        totalCalls: 0,
        totalMethods: 0,
        avgDuration: 0,
        totalTime: 0,
        errorRate: 0
      };
    }

    const sum = allDurations.reduce((a, b) => a + b, 0);
    const avg = sum / allDurations.length;
    const errorRate = (totalExceptions / totalCalls) * 100;

    return {
      totalCalls,
      totalMethods: this.methodStats.size,
      avgDuration: Math.round(avg),
      totalTime: Math.round(sum),
      totalExceptions,
      errorRate: Math.round(errorRate * 100) / 100
    };
  }
}

module.exports = PerformanceAnalyzer;
