/**
 * API endpoints for log analysis
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const FlowTraceAnalyzer = require('../../analyzer');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.jsonl') || file.mimetype === 'application/jsonl') {
      cb(null, true);
    } else {
      cb(new Error('Only .jsonl files are allowed'));
    }
  }
});

// Store analysis results in memory (in production, use Redis or DB)
const analysisCache = new Map();

/**
 * POST /api/analyze
 * Upload and analyze a JSONL file
 */
router.post('/analyze', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const analyzer = new FlowTraceAnalyzer();

    console.log(`Analyzing file: ${req.file.originalname}`);

    const results = await analyzer.analyze(filePath);

    // Generate analysis ID
    const analysisId = `analysis-${Date.now()}`;

    // Cache results
    analysisCache.set(analysisId, {
      id: analysisId,
      fileName: req.file.originalname,
      filePath,
      uploadTime: new Date(),
      results
    });

    res.json({
      analysisId,
      fileName: req.file.originalname,
      results
    });

  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analyze/:id
 * Retrieve cached analysis by ID
 */
router.get('/analyze/:id', (req, res) => {
  const { id } = req.params;

  if (!analysisCache.has(id)) {
    return res.status(404).json({ error: 'Analysis not found' });
  }

  const analysis = analysisCache.get(id);
  res.json(analysis);
});

/**
 * GET /api/analyze
 * List all cached analyses
 */
router.get('/analyze', (req, res) => {
  const analyses = Array.from(analysisCache.values()).map(a => ({
    id: a.id,
    fileName: a.fileName,
    uploadTime: a.uploadTime,
    totalEvents: a.results.fileStats.totalEvents,
    totalMethods: a.results.performance.summary.totalMethods
  }));

  res.json({ analyses });
});

/**
 * DELETE /api/analyze/:id
 * Delete analysis and uploaded file
 */
router.delete('/analyze/:id', (req, res) => {
  const { id } = req.params;

  if (!analysisCache.has(id)) {
    return res.status(404).json({ error: 'Analysis not found' });
  }

  const analysis = analysisCache.get(id);

  // Delete uploaded file
  if (fs.existsSync(analysis.filePath)) {
    fs.unlinkSync(analysis.filePath);
  }

  // Remove from cache
  analysisCache.delete(id);

  res.json({ message: 'Analysis deleted' });
});

/**
 * POST /api/analyze-file
 * Analyze a file from filesystem path (no upload needed)
 */
router.post('/analyze-file', async (req, res) => {
  try {
    const { filePath } = req.body;

    if (!filePath) {
      return res.status(400).json({ error: 'File path is required' });
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Check if it's a .jsonl file
    if (!filePath.endsWith('.jsonl')) {
      return res.status(400).json({ error: 'File must be a .jsonl file' });
    }

    const analyzer = new FlowTraceAnalyzer();

    console.log(`Analyzing file from path: ${filePath}`);

    const results = await analyzer.analyze(filePath);

    // Generate analysis ID
    const analysisId = `analysis-${Date.now()}`;

    // Cache results
    analysisCache.set(analysisId, {
      id: analysisId,
      fileName: path.basename(filePath),
      filePath,
      uploadTime: new Date(),
      results
    });

    res.json({
      analysisId,
      fileName: path.basename(filePath),
      filePath,
      results
    });

  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
