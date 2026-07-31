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
 * Analyze a file from disk and register it in the cache.
 *
 * Extracted from POST /api/analyze-file so the server can pre-load a trace at
 * startup. `flowtrace analyze` passed FLOWTRACE_FILE to the dashboard process and
 * nothing ever read it, so the command printed the file path, opened the browser,
 * and presented an empty dashboard — the user then had to find and upload the file
 * by hand. Opening the dashboard ON a specific trace is the command's entire
 * purpose.
 *
 * @param {string} filePath - absolute path to a .jsonl trace
 * @returns {Promise<{id: string, fileName: string, filePath: string, results: object}>}
 */
async function ingestFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  if (!filePath.endsWith('.jsonl')) {
    throw new Error(`File must be a .jsonl file: ${filePath}`);
  }

  const analyzer = new FlowTraceAnalyzer();
  const results = await analyzer.analyze(filePath);
  // Suffixed to stay unique when several files are ingested in the same
  // millisecond, which pre-loading plus an upload can do.
  const analysisId = `analysis-${Date.now()}-${analysisCache.size}`;

  const entry = {
    id: analysisId,
    fileName: path.basename(filePath),
    filePath,
    uploadTime: new Date(),
    results,
  };
  analysisCache.set(analysisId, entry);
  return entry;
}

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

    console.log(`Analyzing file from path: ${filePath}`);
    const entry = await ingestFile(filePath);

    res.json({
      analysisId: entry.id,
      fileName: entry.fileName,
      filePath: entry.filePath,
      results: entry.results,
    });
  } catch (error) {
    console.error('Analysis error:', error);
    // Distinguish "you asked for something that is not there" from a real fault.
    const missing = /File not found|must be a \.jsonl/.test(error.message);
    res.status(missing ? 404 : 500).json({ error: error.message });
  }
});

module.exports = router;
module.exports.ingestFile = ingestFile;
