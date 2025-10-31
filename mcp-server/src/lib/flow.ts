import { LogEvent } from "../types";

export function buildFlow(rows: LogEvent[], keys: string[]): Map<string, LogEvent[]> {
  const map = new Map<string, LogEvent[]>();
  for (const r of rows) {
    const k = keys.map(k => String((r as any)[k] ?? '')).join('|');
    if (!k.replace(/\|/g,'').length) continue;
    const arr = map.get(k) || [];
    arr.push(r);
    map.set(k, arr);
  }
  for (const [k, arr] of map) arr.sort((a,b)=>Number(a.timestamp||0)-Number(b.timestamp||0));
  return map;
}
