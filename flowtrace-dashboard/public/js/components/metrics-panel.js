/**
 * Metrics Panel Component
 * Displays summary cards with key metrics
 */

class MetricsPanel {
  constructor() {
    this.totalCallsEl = document.getElementById('total-calls');
    this.avgDurationEl = document.getElementById('avg-duration');
    this.totalMethodsEl = document.getElementById('total-methods');
    this.errorRateEl = document.getElementById('error-rate');
  }

  /**
   * Update metrics from analysis results
   * @param {Object} summary - Performance summary object
   */
  update(summary) {
    // Total calls
    this.totalCallsEl.textContent = this.formatNumber(summary.totalCalls);

    // Average duration
    this.avgDurationEl.textContent = this.formatDuration(summary.avgDuration);

    // Total methods
    this.totalMethodsEl.textContent = this.formatNumber(summary.totalMethods);

    // Error rate
    const errorRate = summary.totalCalls > 0
      ? (summary.totalExceptions / summary.totalCalls) * 100
      : 0;
    this.errorRateEl.textContent = `${errorRate.toFixed(2)}%`;
  }

  /**
   * Format number with thousands separator
   * @param {number} num
   * @returns {string}
   */
  formatNumber(num) {
    return num.toLocaleString();
  }

  /**
   * Format duration in milliseconds
   * @param {number} ms
   * @returns {string}
   */
  formatDuration(ms) {
    if (ms < 1) {
      return `${(ms * 1000).toFixed(2)}μs`;
    } else if (ms < 1000) {
      return `${ms.toFixed(2)}ms`;
    } else {
      return `${(ms / 1000).toFixed(2)}s`;
    }
  }

  reset() {
    this.totalCallsEl.textContent = '0';
    this.avgDurationEl.textContent = '0ms';
    this.totalMethodsEl.textContent = '0';
    this.errorRateEl.textContent = '0%';
  }
}

window.MetricsPanel = MetricsPanel;
