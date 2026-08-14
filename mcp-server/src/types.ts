// FlowTrace v2 — canonical event types. Source of truth: schema/flowtrace-v2.json.
// Events are one JSON object per line in a JSONL stream. ENTER and EXIT are
// paired by span_id; ERROR may stand alone or replace EXIT.

export type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
export interface JsonObject { [key: string]: unknown; }
export interface JsonArray extends Array<JsonValue> {}

// Branded W3C-format hex IDs. We don't enforce hex at the type level (zod/JSON
// Schema does that at runtime); the brand exists to prevent accidental swaps
// between trace_id (32 hex chars) and span_id (16 hex chars).
export type TraceId = string & { readonly __brand: "TraceId" };
export type SpanId = string & { readonly __brand: "SpanId" };

export type Visibility = "public" | "private" | "internal" | "unknown";
export type Lang = "java" | "python" | "node" | "ts" | string;

export interface BaseEvent {
  ts: number;                 // float seconds since epoch
  trace_id: TraceId;
  span_id: SpanId;
  parent_id: SpanId | null;
  thread: string;
  lang: Lang;
  module?: string;
  class?: string;
  method: string;
  visibility?: Visibility;
  depth?: number;
}

export interface EnterEvent extends BaseEvent {
  event: "enter";
  args?: JsonObject | JsonArray;
}

export interface ErrorInfo {
  type: string;
  msg: string;
  stack?: string[];
}

export interface ExitEvent extends BaseEvent {
  event: "exit";
  args?: JsonObject | JsonArray;
  result?: JsonValue;
  duration_ns: number;
  error?: ErrorInfo;          // exit-with-error variant
}

// There is no ErrorEvent. schema/flowtrace-v2.json declares `oneOf: [enter,
// exit]` with additionalProperties:false, so an event="error" line is invalid
// and no capture layer emits one. A failed call is an exit whose `error` is
// set. This union used to carry a third variant, which made the tools branch
// on a case that could never occur.
export type TraceEvent = EnterEvent | ExitEvent;

// V1 (legacy) event shape — kept only so the compat shim can recognise it.
// New code MUST NOT consume v1 fields directly.
export interface LegacyV1Event {
  timestamp: number;          // ms since epoch (v1 marker)
  event: "ENTER" | "EXIT" | "EXCEPTION";
  thread?: string;
  class?: string;
  method?: string;
  args?: unknown;
  result?: unknown;
  durationMicros?: number;
  durationMillis?: number;
  [k: string]: unknown;
}

export interface OpenSession {
  id: string;
  path: string;
  rows: TraceEvent[];
  fields: Record<string, number>;
  schemaVersion: "v2" | "v1";
  malformed: number;          // count of dropped lines
  /** Epoch ms of the last tool call that touched this session. Drives LRU
   *  eviction: a trace can be hundreds of MB in memory and the server is a
   *  long-lived stdio process, so sessions cannot be held forever. */
  lastUsed: number;
}

/** Field-level predicates for log.search / log.aggregate. */
export interface Where {
  event?: "enter" | "exit";
  method?: string;
  class?: string;
  module?: string;
  lang?: string;
  visibility?: string;
  thread?: string;
  trace_id?: string;
  span_id?: string;
  parent_id?: string;
  has_error?: boolean;
  min_duration_ns?: number;
  max_duration_ns?: number;
  min_depth?: number;
  max_depth?: number;
}

export interface ServerConfig {
  logPaths?: string[];
}
