/**
 * File Uploader Component
 * Handles file drag & drop and upload UI
 */

class FileUploader {
  constructor(uploadBoxId, fileInputId, progressId, onFileAnalyzed) {
    this.uploadBox = document.getElementById(uploadBoxId);
    this.fileInput = document.getElementById(fileInputId);
    this.progressElement = document.getElementById(progressId);
    this.onFileAnalyzed = onFileAnalyzed;
    this.apiClient = new APIClient();

    this.init();
  }

  init() {
    // Click to upload
    this.uploadBox.addEventListener('click', () => {
      this.fileInput.click();
    });

    // File selected via input
    this.fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        this.handleFile(file);
      }
    });

    // Drag & drop events
    this.uploadBox.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.uploadBox.classList.add('dragover');
    });

    this.uploadBox.addEventListener('dragleave', () => {
      this.uploadBox.classList.remove('dragover');
    });

    this.uploadBox.addEventListener('drop', (e) => {
      e.preventDefault();
      this.uploadBox.classList.remove('dragover');

      const file = e.dataTransfer.files[0];
      if (file) {
        this.handleFile(file);
      }
    });
  }

  async handleFile(file) {
    // Validate file type
    if (!file.name.endsWith('.jsonl')) {
      alert('Please upload a .jsonl file');
      return;
    }

    // Show progress
    this.showProgress();

    try {
      // Upload and analyze
      const results = await this.apiClient.analyzeFile(file, (percentage) => {
        this.updateProgress(percentage);
      });

      // Hide progress
      this.hideProgress();

      // Callback with results
      if (this.onFileAnalyzed) {
        this.onFileAnalyzed(results);
      }

    } catch (error) {
      this.hideProgress();
      alert(`Error analyzing file: ${error.message}`);
      console.error('Analysis error:', error);
    }
  }

  showProgress() {
    document.getElementById('upload-section').querySelector('.upload-box').style.display = 'none';
    this.progressElement.style.display = 'block';
    this.updateProgress(0);
  }

  updateProgress(percentage) {
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');

    progressFill.style.width = `${percentage}%`;

    if (percentage < 100) {
      progressText.textContent = `Uploading... ${Math.round(percentage)}%`;
    } else {
      progressText.textContent = 'Analyzing...';
    }
  }

  hideProgress() {
    this.progressElement.style.display = 'none';
  }

  reset() {
    document.getElementById('upload-section').querySelector('.upload-box').style.display = 'block';
    this.progressElement.style.display = 'none';
    this.fileInput.value = '';
  }
}

window.FileUploader = FileUploader;
