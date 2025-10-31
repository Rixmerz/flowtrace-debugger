export type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
export interface JsonObject { [key: string]: any; }
export interface JsonArray extends Array<JsonValue> {}

export interface LogEvent extends JsonObject {
  timestamp?: number;
  class?: string;
  method?: string;
  event?: string;
  args?: JsonValue;
  result?: JsonValue;
  durationMillis?: number;
  durationMicros?: number;
  truncatedFields?: Record<string, { originalLength: number; threshold: number }>;
  fullLogFile?: string;
  [key: string]: any;
}

export interface OpenSession {
  id: string;
  path: string;
  count: number;
  fields: Record<string, number>;
  index: Partial<{ method: Map<string, number[]>; class: Map<string, number[]>; event: Map<string, number[]>; }>;
}

export interface ServerConfig {
  logPaths?: string[];
  correlationKeys?: string[];
  timestampField?: string;
  durationFields?: string[];
  errorKeys?: string[];
  fieldAliases?: Record<string, string>;
}
