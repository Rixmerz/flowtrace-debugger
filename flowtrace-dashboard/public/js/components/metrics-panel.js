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
    this.avgDurationEl.textContent = this.formatNs(summary.avg_ns);

    // Total methods
    this.totalMethodsEl.textContent = this.formatNumber(summary.totalMethods);

    // Error rate
    // The analyzer already computes errorRate; recomputing it from a field that
    // no longer exists (totalExceptions) produced NaN%.
    const errorRate = typeof summary.errorRate === 'number'
      ? summary.errorRate
      : (summary.totalCalls > 0 ? ((summary.totalErrors || 0) / summary.totalCalls) * 100 : 0);
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

  /**
   * Format a nanosecond duration.
   *
   * The analyzer emits v2 field names — avg_ns, total_ns, p95_ns — matching the
   * schema's duration_ns. This layer was still reading the v1 names
   * (avgDuration, totalExceptions), which no longer exist: every duration
   * rendered from `undefined`, and the dashboard CLI crashed outright with
   * "Cannot read properties of undefined (reading 'toFixed')".
   *
   * Nanoseconds are converted here rather than at each call site, so adding a
   * field cannot reintroduce a missing division.
   */
  formatNs(ns) {
    if (typeof ns !== 'number' || !Number.isFinite(ns)) return '—';
    return this.formatDuration(ns / 1e6);
  }

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
