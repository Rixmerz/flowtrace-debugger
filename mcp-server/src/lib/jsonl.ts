import fs from "node:fs";
import readline from "node:readline";
import type { TraceEvent } from "../types";
import { detectSchemaVersion, isLikelyV2 } from "../v1-compat";

export interface LoadResult {
  rows: TraceEvent[];
  fields: Record<string, number>;
  schemaVersion: "v2" | "v1";
  malformed: number;
}

/** Load a JSONL file. v2-only: rows that don't look like v2 are counted as
 *  malformed and dropped (with one stderr warning per file). */
export async function loadJsonl(path: string): Promise<LoadResult> {
  const stream = fs.createReadStream(path, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const rows: TraceEvent[] = [];
  const fields: Record<string, number> = {};
  let malformed = 0;
  let firstObj: unknown = null;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      malformed++;
      continue;
    }
    if (!firstObj) firstObj = obj;
    if (!isLikelyV2(obj)) {
      malformed++;
      continue;
    }
    const v2 = obj as TraceEvent;
    rows.push(v2);
    for (const k of Object.keys(v2 as object)) fields[k] = (fields[k] || 0) + 1;
  }

  const schemaVersion = detectSchemaVersion(firstObj);
  if (schemaVersion === "v1") {
    process.stderr.write(
      `[flowtrace-mcp] warning: ${path} appears to be v1 schema; v2 tools will return empty results.\n`
    );
  } else if (malformed > 0) {
    process.stderr.write(
      `[flowtrace-mcp] dropped ${malformed} malformed/non-v2 line(s) from ${path}\n`
    );
  }

  return { rows, fields, schemaVersion, malformed };
}
