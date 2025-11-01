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
        <td class="number">${this.formatDuration(method.avgDuration)}</td>
        <td class="number">${this.formatDuration(method.p95)}</td>
        <td class="number">${this.formatDuration(method.p99)}</td>
        <td class="number">
          <span class="badge ${this.getBadgeClass(method.totalTime)}">
            ${this.formatDuration(method.totalTime)}
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
        <td class="number">${this.formatDuration(bottleneck.avgDuration)}</td>
        <td class="number">
          <span class="badge ${this.getBadgeClass(bottleneck.totalTime)}">
            ${this.formatDuration(bottleneck.totalTime)}
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
      const errorRate = (error.exceptions / error.callCount) * 100;
      const className = this.formatClassName(error.class || error.className);

      row.innerHTML = `
        <td>
          <div class="method-name">${this.escapeHtml(error.method)}</div>
          <div class="class-name">${this.escapeHtml(className)}</div>
        </td>
        <td class="number">${error.callCount.toLocaleString()}</td>
        <td class="number" style="color: var(--error-color);">
          <strong>${error.exceptions}</strong>
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
