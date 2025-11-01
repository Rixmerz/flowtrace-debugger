/**
 * API Client for FlowTrace Dashboard
 * Handles all communication with the backend API
 */

class APIClient {
  constructor(baseURL = '') {
    this.baseURL = baseURL;
  }

  /**
   * Upload and analyze a JSONL file
   * @param {File} file - The flowtrace.jsonl file
   * @param {Function} onProgress - Progress callback (percentage)
   * @returns {Promise<Object>} Analysis results
   */
  async analyzeFile(file, onProgress) {
    const formData = new FormData();
    formData.append('file', file);

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      // Track upload progress
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          const percentage = (e.loaded / e.total) * 100;
          onProgress(percentage);
        }
      });

      // Handle completion
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText);
            resolve(response);
          } catch (error) {
            reject(new Error('Invalid JSON response'));
          }
        } else {
          reject(new Error(`Server error: ${xhr.status}`));
        }
      });

      // Handle errors
      xhr.addEventListener('error', () => {
        reject(new Error('Network error'));
      });

      xhr.addEventListener('abort', () => {
        reject(new Error('Upload aborted'));
      });

      xhr.open('POST', `${this.baseURL}/api/analyze`);
      xhr.send(formData);
    });
  }

  /**
   * Get analysis by ID
   * @param {string} analysisId
   * @returns {Promise<Object>}
   */
  async getAnalysis(analysisId) {
    const response = await fetch(`${this.baseURL}/api/analyze/${analysisId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch analysis: ${response.status}`);
    }
    return response.json();
  }

  /**
   * List all analyses
   * @returns {Promise<Array>}
   */
  async listAnalyses() {
    const response = await fetch(`${this.baseURL}/api/analyze`);
    if (!response.ok) {
      throw new Error(`Failed to list analyses: ${response.status}`);
    }
    const data = await response.json();
    return data.analyses;
  }

  /**
   * Delete analysis
   * @param {string} analysisId
   * @returns {Promise<Object>}
   */
  async deleteAnalysis(analysisId) {
    const response = await fetch(`${this.baseURL}/api/analyze/${analysisId}`, {
      method: 'DELETE'
    });
    if (!response.ok) {
      throw new Error(`Failed to delete analysis: ${response.status}`);
    }
    return response.json();
  }
}

// Export for use in other modules
window.APIClient = APIClient;
