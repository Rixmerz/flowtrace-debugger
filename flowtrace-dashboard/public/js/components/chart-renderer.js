/**
 * Chart Renderer Component
 * Renders time distribution charts using Chart.js
 */

class ChartRenderer {
  constructor() {
    this.chart = null;
  }

  /**
   * Render time distribution chart
   * @param {Object} distribution - Time distribution data
   */
  renderTimeDistribution(distribution) {
    const ctx = document.getElementById('distribution-chart');

    // Destroy existing chart
    if (this.chart) {
      this.chart.destroy();
    }

    // Prepare data
    const labels = distribution.ranges.map(r => r.range);
    const data = distribution.ranges.map(r => r.count);
    const percentages = distribution.ranges.map(r => r.percentage);

    // Create chart
    this.chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Number of Calls',
          data: data,
          backgroundColor: 'rgba(37, 99, 235, 0.8)',
          borderColor: 'rgba(37, 99, 235, 1)',
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          title: {
            display: true,
            text: 'Method Call Duration Distribution',
            font: {
              size: 16,
              weight: 'bold'
            }
          },
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                const count = context.parsed.y;
                const percentage = percentages[context.dataIndex];
                return `${count.toLocaleString()} calls (${percentage.toFixed(2)}%)`;
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: 'Number of Calls'
            },
            ticks: {
              callback: function(value) {
                return value.toLocaleString();
              }
            }
          },
          x: {
            title: {
              display: true,
              text: 'Duration Range'
            },
            ticks: {
              autoSkip: false,
              maxRotation: 45,
              minRotation: 45
            }
          }
        }
      }
    });
  }

  /**
   * Destroy chart
   */
  destroy() {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
  }
}

window.ChartRenderer = ChartRenderer;
