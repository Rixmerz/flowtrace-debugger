import fs from "fs";
import readline from "readline";
import { LogEvent } from "../types";

export async function loadJsonl(
  path: string
): Promise<{ rows: LogEvent[]; fields: Record<string, number> }> {
  const stream = fs.createReadStream(path, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const rows: LogEvent[] = [];
  const fields: Record<string, number> = {};
  for await (const line of rl) {
    const trimmed = line.trim(); if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as LogEvent;
      rows.push(obj);
      for (const k of Object.keys(obj)) fields[k] = (fields[k] || 0) + 1;
    } catch {}
  }
  return { rows, fields };
}
