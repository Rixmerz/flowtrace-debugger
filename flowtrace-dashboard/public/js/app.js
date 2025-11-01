/**
 * FlowTrace Dashboard Main Application
 * Coordinates all components and handles user interactions
 */

class FlowTraceDashboard {
  constructor() {
    this.metricsPanel = new MetricsPanel();
    this.chartRenderer = new ChartRenderer();
    this.currentResults = null;

    this.init();
  }

  init() {
    // Initialize file uploader
    this.fileUploader = new FileUploader(
      'upload-box',
      'file-input',
      'upload-progress',
      (results) => this.handleAnalysisResults(results)
    );

    // Initialize tabs
    this.initTabs();
  }

  /**
   * Initialize tab switching
   */
  initTabs() {
    const tabs = document.querySelectorAll('.tab');
    const panels = document.querySelectorAll('.tab-panel');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        // Remove active class from all tabs and panels
        tabs.forEach(t => t.classList.remove('active'));
        panels.forEach(p => p.classList.remove('active'));

        // Add active class to clicked tab and corresponding panel
        tab.classList.add('active');
        const targetPanel = document.getElementById(`${tab.dataset.tab}-tab`);
        if (targetPanel) {
          targetPanel.classList.add('active');
        }
      });
    });
  }

  /**
   * Handle analysis results from file upload
   * @param {Object} results - Analysis results from API
   */
  handleAnalysisResults(results) {
    this.currentResults = results;

    // Show results section
    document.getElementById('results-section').style.display = 'block';

    // Update metrics panel
    this.metricsPanel.update(results.results.performance.summary);

    // Render tables
    TableRenderer.renderSlowMethods(results.results.performance.slowMethods);
    TableRenderer.renderBottlenecks(results.results.performance.bottlenecks);
    TableRenderer.renderErrors(results.results.performance.errorHotspots);

    // Render chart
    this.chartRenderer.renderTimeDistribution(results.results.performance.timeDistribution);

    // Scroll to results
    document.getElementById('results-section').scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }

  /**
   * Reset dashboard to initial state
   */
  reset() {
    this.currentResults = null;
    this.metricsPanel.reset();
    this.chartRenderer.destroy();
    this.fileUploader.reset();
    document.getElementById('results-section').style.display = 'none';
  }
}

// Initialize dashboard when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.dashboard = new FlowTraceDashboard();
});
