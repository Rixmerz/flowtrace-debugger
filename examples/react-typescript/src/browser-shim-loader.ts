/**
 * FlowTrace Browser Agent Loader for React + Vite
 *
 * This file initializes the FlowTrace browser agent for client-side tracing.
 * It loads the browser shim and configures it for React application debugging.
 */

// Import the browser shim (Vite will bundle this)
import '../../../flowtrace-agent-js/src/browser-shim.js';

// Declare FlowTrace global type
declare global {
  interface Window {
    FlowTrace: {
      init: (config?: any) => void;
      export: (filename?: string) => void;
      getLogs: () => any[];
      clearLogs: () => void;
      getConfig: () => any;
      updateConfig: (config: any) => void;
      disable: () => void;
      enable: () => void;
      getStats: () => any;
      version: string;
    };
  }
}

// Initialize FlowTrace Browser Agent
if (typeof window !== 'undefined' && window.FlowTrace) {
  window.FlowTrace.init({
    packagePrefix: 'src/',        // Only trace files from src/ directory
    captureStackTraces: true,     // Capture stack traces for context
    maxLogEntries: 10000,         // Max 10k log entries
    consolePassthrough: true,     // Still show console output
    captureConsole: true,         // Intercept console methods
    timestampFormat: 'iso',       // ISO timestamp format
    enabled: true                 // Enable tracing
  });

  console.log('🔍 FlowTrace Browser Agent initialized for React app');
  console.log('📊 Use FlowTrace.getStats() to see statistics');
  console.log('📥 Use FlowTrace.export() to download logs as JSONL');

  // Add FlowTrace export button to the page (for easy access)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addFlowTraceUI);
  } else {
    addFlowTraceUI();
  }
}

/**
 * Add FlowTrace export button to the page
 */
function addFlowTraceUI() {
  // Create floating button container
  const container = document.createElement('div');
  container.id = 'flowtrace-controls';
  container.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    gap: 10px;
  `;

  // Create export button
  const exportBtn = document.createElement('button');
  exportBtn.textContent = '📥 Export FlowTrace Logs';
  exportBtn.style.cssText = `
    background: #007bff;
    color: white;
    border: none;
    padding: 12px 20px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    transition: all 0.2s;
  `;
  exportBtn.onmouseover = () => {
    exportBtn.style.background = '#0056b3';
    exportBtn.style.transform = 'translateY(-2px)';
    exportBtn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
  };
  exportBtn.onmouseout = () => {
    exportBtn.style.background = '#007bff';
    exportBtn.style.transform = 'translateY(0)';
    exportBtn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
  };
  exportBtn.onclick = () => {
    if (window.FlowTrace) {
      window.FlowTrace.export('flowtrace-react-browser.jsonl');
    }
  };

  // Create stats button
  const statsBtn = document.createElement('button');
  statsBtn.textContent = '📊 Show Stats';
  statsBtn.style.cssText = `
    background: #28a745;
    color: white;
    border: none;
    padding: 12px 20px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    transition: all 0.2s;
  `;
  statsBtn.onmouseover = () => {
    statsBtn.style.background = '#218838';
    statsBtn.style.transform = 'translateY(-2px)';
    statsBtn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
  };
  statsBtn.onmouseout = () => {
    statsBtn.style.background = '#28a745';
    statsBtn.style.transform = 'translateY(0)';
    statsBtn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
  };
  statsBtn.onclick = () => {
    if (window.FlowTrace) {
      const stats = window.FlowTrace.getStats();
      console.log('📊 FlowTrace Statistics:', stats);
      alert(`FlowTrace Stats:\n\nTotal Entries: ${stats.totalEntries}\nUtilization: ${stats.utilizationPercent}%\n\nCheck console for details.`);
    }
  };

  // Create clear button
  const clearBtn = document.createElement('button');
  clearBtn.textContent = '🗑️ Clear Logs';
  clearBtn.style.cssText = `
    background: #dc3545;
    color: white;
    border: none;
    padding: 12px 20px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    transition: all 0.2s;
  `;
  clearBtn.onmouseover = () => {
    clearBtn.style.background = '#c82333';
    clearBtn.style.transform = 'translateY(-2px)';
    clearBtn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
  };
  clearBtn.onmouseout = () => {
    clearBtn.style.background = '#dc3545';
    clearBtn.style.transform = 'translateY(0)';
    clearBtn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
  };
  clearBtn.onclick = () => {
    if (window.FlowTrace && confirm('Clear all FlowTrace logs?')) {
      window.FlowTrace.clearLogs();
      console.log('🗑️ FlowTrace logs cleared');
    }
  };

  container.appendChild(exportBtn);
  container.appendChild(statsBtn);
  container.appendChild(clearBtn);
  document.body.appendChild(container);
}

export {};
