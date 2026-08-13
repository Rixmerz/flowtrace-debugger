// v1 → v2 compatibility shim. Detects legacy logs (ms `timestamp`, no
// `trace_id`) and lets v2 tools fail soft instead of mis-parsing.

export function detectSchemaVersion(sample: unknown): "v2" | "v1" {
  if (!sample || typeof sample !== "object") return "v2";
  const s = sample as Record<string, unknown>;
  // v1 marker: numeric `timestamp` in milliseconds AND no `trace_id`.
  if (typeof s.timestamp === "number" && typeof s.trace_id !== "string") return "v1";
  return "v2";
}

export function isLikelyV2(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  // v2 events MUST carry trace_id, span_id, ts (float seconds), event lower-case.
  if (typeof o.trace_id !== "string") return false;
  if (typeof o.span_id !== "string") return false;
  if (typeof o.ts !== "number") return false;
  // enter | exit only — schema v2 has no event="error" variant.
  if (o.event !== "enter" && o.event !== "exit") return false;
  return true;
}
