/**
 * Table Renderer Component
 * Renders data tables for slow methods, bottlenecks, and errors
 */

class TableRenderer {
  /**
   * Format duration with appropriate units
   * @param {number} ms
   * @returns {string}
   */
  static formatDuration(ms) {
    if (ms < 1) {
      return `${(ms * 1000).toFixed(2)}μs`;
    } else if (ms < 1000) {
      return `${ms.toFixed(2)}ms`;
    } else {
      return `${(ms / 1000).toFixed(2)}s`;
    }
  }

  /**
   * Get badge class based on duration
   * @param {number} ms
   * @returns {string}
   */
  static getBadgeClass(ms) {
    if (ms > 1000) return 'badge-slow';
    if (ms > 100) return 'badge-warning';
    return 'badge-fast';
  }

  /**
   * Format class name (remove package, keep class name)
   * @param {string} className
   * @returns {string}
   */
  static formatClassName(className) {
    if (!className || className === 'Unknown') {
      return 'Unknown';
    }

    // For Java-style package names (com.example.Class)
    if (className.includes('.')) {
      const parts = className.split('.');
      return parts[parts.length - 1]; // Get last part
    }

    return className;
  }

  /**
   * Render slow methods table
   * @param {Array} methods
   */
  static renderSlowMethods(methods) {
    const tbody = document.getElementById('slow-methods-body');
    tbody.innerHTML = '';

    methods.forEach(method => {
      const row = document.createElement('tr');
      const className = this.formatClassName(method.class || method.className);

      row.innerHTML = `
        <td>
          <div class="method-name">${this.escapeHtml(method.method)}</div>
          <div class="class-name">${this.escapeHtml(className)}</div>
        </td>
        <td class="number">${method.callCount.toLocaleString()}</td>
        <td class="number">${this.formatNs(method.avg_ns)}</td>
        <td class="number">${this.formatNs(method.p95_ns)}</td>
        <td class="number">${this.formatNs(method.p99_ns)}</td>
        <td class="number">
          <span class="badge ${this.getBadgeClass((method.total_ns || 0) / 1e6)}">
            ${this.formatNs(method.total_ns)}
          </span>
        </td>
      `;

      tbody.appendChild(row);
    });
  }

  /**
   * Render bottlenecks table
   * @param {Array} bottlenecks
   */
  static renderBottlenecks(bottlenecks) {
    const tbody = document.getElementById('bottlenecks-body');
    tbody.innerHTML = '';

    bottlenecks.forEach(bottleneck => {
      const row = document.createElement('tr');
      const className = this.formatClassName(bottleneck.class || bottleneck.className);

      row.innerHTML = `
        <td>
          <div class="method-name">${this.escapeHtml(bottleneck.method)}</div>
          <div class="class-name">${this.escapeHtml(className)}</div>
        </td>
        <td class="number">${bottleneck.callCount.toLocaleString()}</td>
        <td class="number">${this.formatNs(bottleneck.avg_ns)}</td>
        <td class="number">
          <span class="badge ${this.getBadgeClass((bottleneck.total_ns || 0) / 1e6)}">
            ${this.formatNs(bottleneck.total_ns)}
          </span>
        </td>
        <td class="number">
          <strong>${bottleneck.impactScore.toFixed(0)}</strong>
        </td>
      `;

      tbody.appendChild(row);
    });
  }

  /**
   * Render error hotspots table
   * @param {Array} errors
   */
  static renderErrors(errors) {
    const tbody = document.getElementById('errors-body');
    tbody.innerHTML = '';

    if (errors.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-secondary);">No errors found</td></tr>';
      return;
    }

    errors.forEach(error => {
      const row = document.createElement('tr');
      // v2 field names: the analyzer's errorHotspots carry errors / totalCalls /
      // errorRate. Reading exceptions / callCount yielded NaN% and rendered
      // "undefined" in both number columns — so the errors table, which is the
      // first place you look when tracing a failure, showed nothing usable.
      const totalCalls = error.totalCalls ?? 0;
      const errorCount = error.errors ?? 0;
      const errorRate = typeof error.errorRate === 'number'
        ? error.errorRate
        : (totalCalls > 0 ? (errorCount / totalCalls) * 100 : 0);
      const className = this.formatClassName(error.class || error.className);

      row.innerHTML = `
        <td>
          <div class="method-name">${this.escapeHtml(error.method)}</div>
          <div class="class-name">${this.escapeHtml(className)}</div>
        </td>
        <td class="number">${totalCalls.toLocaleString()}</td>
        <td class="number" style="color: var(--error-color);">
          <strong>${errorCount}</strong>
        </td>
        <td class="number">
          <span class="badge badge-slow">${errorRate.toFixed(2)}%</span>
        </td>
      `;

      tbody.appendChild(row);
    });
  }

  /**
   * Escape HTML to prevent XSS
   * @param {string} text
   * @returns {string}
   */
  static escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

window.TableRenderer = TableRenderer;
