/**
 * Go module-path detection, shared by lib/detect.js (`flowtrace init`'s
 * package-prefix detection) and lib/commands/run.js (`flowtrace run --lang
 * go`). One implementation, imported by both call sites — see
 * lib/python-prefix.js's header comment for why that matters: two
 * independent readers of the same file drift out of sync the moment only
 * one of them gets fixed.
 */
'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Reads the `module` line of go.mod and returns the module path, or null
 * if go.mod is absent or has no module directive.
 */
function detectGoModulePath(cwd) {
  const goModPath = path.join(cwd, 'go.mod');
  if (!fs.existsSync(goModPath)) return null;
  const src = fs.readFileSync(goModPath, 'utf-8');
  const m = src.match(/^\s*module\s+(\S+)/m);
  return m ? m[1].trim() : null;
}

module.exports = { detectGoModulePath };
