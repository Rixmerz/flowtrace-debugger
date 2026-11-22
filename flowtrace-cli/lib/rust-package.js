/**
 * Rust package-name detection, shared by lib/detect.js (`flowtrace init`) and
 * lib/commands/run.js (`flowtrace run --lang rust`), for the same reason
 * lib/go-module.js is shared: two readers of one file drift apart.
 *
 * Only a manifest with a `[package]` table has a name to offer. A virtual
 * workspace root (just `[workspace]`) returns null, and that is not a failure:
 * the driver (capture/rust/flowtrace-rust) asks `cargo metadata` for every
 * member and derives the prefix itself.
 */
'use strict';

const fs = require('fs');
const path = require('path');

/** The `[package] name` of Cargo.toml with `-` as `_` (how rustc spells it), or null. */
function detectRustPackageName(cwd) {
  const manifest = path.join(cwd, 'Cargo.toml');
  if (!fs.existsSync(manifest)) return null;
  const src = fs.readFileSync(manifest, 'utf-8');
  // Only the [package] table: `name` also appears under [lib], [[bin]] and in dependencies.
  const table = src.match(/^\s*\[package\]\s*$([\s\S]*?)(?=^\s*\[|(?![\s\S]))/m);
  if (!table) return null;
  const name = table[1].match(/^\s*name\s*=\s*["']([^"']+)["']/m);
  return name ? name[1].trim().replace(/-/g, '_') : null;
}

module.exports = { detectRustPackageName };
