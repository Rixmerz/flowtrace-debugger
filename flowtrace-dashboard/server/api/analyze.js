/**
 * API endpoints for log analysis.
 *
 * Two ways in: an upload (POST /api/analyze, multipart) and a path on the
 * server's own disk (POST /api/analyze-file, used by `flowtrace analyze`).
 * Both used to trust their input more than a network-facing endpoint should:
 * the upload was stored under the client's own filename (a path traversal
 * away from writing anywhere), and analyze-file read any `.jsonl` on the
 * machine. Now the stored name is random and server-chosen, and a path must
 * resolve inside one of the allowed roots.
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const FlowTraceAnalyzer = require('../../analyzer');

const router = express.Router();

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Uploads land here, under names this server chose. */
const UPLOAD_DIR = process.env.FLOWTRACE_DASHBOARD_UPLOAD_DIR
  ? path.resolve(process.env.FLOWTRACE_DASHBOARD_UPLOAD_DIR)
  : path.join(__dirname, '../../uploads');

/** Largest accepted upload. A trace is rarely this big; a disk-filler is. */
const MAX_UPLOAD_BYTES = envInt('FLOWTRACE_DASHBOARD_MAX_UPLOAD_BYTES', 200 * 1024 * 1024);

/** Analyses kept in memory (each holds a full call tree); oldest evicted. */
const MAX_ANALYSES = envInt('FLOWTRACE_DASHBOARD_MAX_ANALYSES', 20);

/** Uploads older than this are swept at startup — an earlier run's leftovers. */
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Directories analyze-file may read from: the working directory this server
 * was started in (which, under `flowtrace analyze`, is the user's project)
 * plus FLOWTRACE_DASHBOARD_ROOTS. Resolved through realpath so a symlink
 * inside a root cannot point outside it. Computed per request: the env var
 * is cheap to read and tests rely on changing it.
 */
function allowedRoots() {
  const raw = [process.cwd(), ...(process.env.FLOWTRACE_DASHBOARD_ROOTS || '').split(path.delimiter)];
  const roots = [];
  for (const r of raw) {
    if (!r) continue;
    try {
      roots.push(fs.realpathSync(path.resolve(r)));
    } catch {
      // A root that does not exist cannot contain anything; skip it.
    }
  }
  return roots;
}

function insideRoot(realPath, roots) {
  return roots.some((root) => realPath === root || realPath.startsWith(root + path.sep));
}

// ── uploads ────────────────────────────────────────────────────────────────

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o700 });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      ensureUploadDir();
      cb(null, UPLOAD_DIR);
    } catch (e) {
      cb(e);
    }
  },
  // Never the client's name. multer joins destination + filename, so an
  // originalname of `../../.ssh/config` walked straight out of uploads/.
  filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}.jsonl`),
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.jsonl') || file.mimetype === 'application/jsonl') {
      cb(null, true);
    } else {
      const err = new Error('Only .jsonl files are allowed');
      err.status = 400;
      cb(err);
    }
  },
});

/** Wraps multer so its errors become JSON with the right status. */
function acceptUpload(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `upload exceeds the limit of ${MAX_UPLOAD_BYTES} bytes` });
    }
    if (err.code && err.code.startsWith('LIMIT_')) {
      return res.status(400).json({ error: 'invalid upload' });
    }
    return res.status(err.status || 400).json({ error: err.message || 'invalid upload' });
  });
}

/** Removes uploads an earlier process left behind. Best effort. */
function sweepStaleUploads() {
  try {
    if (!fs.existsSync(UPLOAD_DIR)) return;
    const cutoff = Date.now() - UPLOAD_TTL_MS;
    for (const name of fs.readdirSync(UPLOAD_DIR)) {
      const p = path.join(UPLOAD_DIR, name);
      try {
        if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
      } catch { /* someone else's file, or already gone */ }
    }
  } catch { /* best effort */ }
}
sweepStaleUploads();

// ── analysis cache ─────────────────────────────────────────────────────────

/**
 * Insertion-ordered, so the first key is the oldest. Bounded: each entry
 * carries a full call tree, and a Map that was never trimmed grew for as long
 * as the dashboard stayed open. An evicted upload's file is deleted with it.
 */
const analysisCache = new Map();

function removeUploadedFile(entry) {
  if (!entry || !entry.uploaded) return;
  try {
    fs.unlinkSync(entry.filePath);
  } catch { /* already gone */ }
}

function remember(entry) {
  analysisCache.set(entry.id, entry);
  while (analysisCache.size > MAX_ANALYSES) {
    const oldestId = analysisCache.keys().next().value;
    removeUploadedFile(analysisCache.get(oldestId));
    analysisCache.delete(oldestId);
  }
}

process.on('exit', () => {
  for (const entry of analysisCache.values()) removeUploadedFile(entry);
});

function newAnalysisId() {
  return `analysis-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

// ── routes ─────────────────────────────────────────────────────────────────

/**
 * GET /api/config
 * What this server will and will not accept — so a client can explain a 403
 * instead of guessing.
 */
router.get('/config', (req, res) => {
  res.json({
    roots: allowedRoots(),
    maxUploadBytes: MAX_UPLOAD_BYTES,
    maxAnalyses: MAX_ANALYSES,
    uploadDir: UPLOAD_DIR,
  });
});

/**
 * POST /api/analyze
 * Upload and analyze a JSONL file
 */
router.post('/analyze', acceptUpload, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const filePath = req.file.path;
  const fileName = path.basename(req.file.originalname || 'upload.jsonl');
  try {
    const results = await new FlowTraceAnalyzer().analyze(filePath);
    const analysisId = newAnalysisId();
    remember({ id: analysisId, fileName, filePath, uploaded: true, uploadTime: new Date(), results });
    res.json({ analysisId, fileName, results });
  } catch (error) {
    console.error('[flowtrace-dashboard] analysis failed:', error);
    removeUploadedFile({ uploaded: true, filePath });
    res.status(500).json({ error: 'analysis failed' });
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
  // filePath and uploaded are server-side state; the client gets the display
  // name and the results, never a path on this machine.
  res.json({
    id: analysis.id,
    fileName: analysis.fileName,
    uploadTime: analysis.uploadTime,
    results: analysis.results,
  });
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

  // Only files this server created are deleted; a path handed to
  // analyze-file belongs to the user.
  removeUploadedFile(analysisCache.get(id));
  analysisCache.delete(id);

  res.json({ message: 'Analysis deleted' });
});

/**
 * POST /api/analyze-file
 * Analyze a file from filesystem path (no upload needed).
 *
 * The path must resolve inside one of the allowed roots; otherwise 403 with
 * code OUTSIDE_ROOTS, which `flowtrace analyze` treats as "upload it instead".
 */
router.post('/analyze-file', async (req, res) => {
  const { filePath } = req.body || {};

  if (!filePath || typeof filePath !== 'string') {
    return res.status(400).json({ error: 'File path is required' });
  }

  let real;
  try {
    real = fs.realpathSync(path.resolve(filePath));
  } catch {
    return res.status(404).json({ error: 'File not found' });
  }

  const roots = allowedRoots();
  if (!insideRoot(real, roots)) {
    return res.status(403).json({
      error: 'path is outside the directories this dashboard may read',
      code: 'OUTSIDE_ROOTS',
      roots,
    });
  }

  let st;
  try {
    st = fs.statSync(real);
  } catch {
    return res.status(404).json({ error: 'File not found' });
  }
  if (!st.isFile()) {
    return res.status(400).json({ error: 'Path is not a file' });
  }
  if (!real.endsWith('.jsonl')) {
    return res.status(400).json({ error: 'File must be a .jsonl file' });
  }

  try {
    const results = await new FlowTraceAnalyzer().analyze(real);
    const analysisId = newAnalysisId();
    const fileName = path.basename(real);
    remember({ id: analysisId, fileName, filePath: real, uploaded: false, uploadTime: new Date(), results });
    res.json({ analysisId, fileName, results });
  } catch (error) {
    console.error('[flowtrace-dashboard] analysis failed:', error);
    res.status(500).json({ error: 'analysis failed' });
  }
});

module.exports = router;
module.exports.allowedRoots = allowedRoots;
module.exports.UPLOAD_DIR = UPLOAD_DIR;
