// Field-level predicates over v2 trace events.
//
// The only filter used to be `JSON.stringify(row).includes(needle)`. That
// matches the needle anywhere in the serialized row, so searching for "user"
// hits a method named getUser, a class UserService, a module path, and any
// argument value containing the substring — all indistinguishably. For a human
// skimming output that is tolerable noise; for an agent deciding what to look
// at next it is worse than useless, because the irrelevant matches consume the
// context that the answer was supposed to fit in.

import type { TraceEvent, Where } from "./types";

/** Case-insensitive substring match, tolerant of absent fields. */
function contains(value: unknown, needle: string): boolean {
  if (typeof value !== "string") return false;
  return value.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Builds a predicate from a `where` clause. Every provided key must match
 * (AND); an absent key does not constrain.
 *
 * Ids match exactly and case-sensitively — they are opaque hex, and a
 * substring match on a 32-char trace id is far more likely to be a mistake
 * than an intent. Everything else is a case-insensitive substring, because
 * you rarely know a method's exact casing when you start looking.
 */
export function makeMatcher(where?: Where): (e: TraceEvent) => boolean {
  if (!where || Object.keys(where).length === 0) return () => true;

  return (e: TraceEvent): boolean => {
    const rec = e as unknown as Record<string, unknown>;

    if (where.event !== undefined && e.event !== where.event) return false;

    for (const key of ["trace_id", "span_id", "parent_id"] as const) {
      const want = where[key];
      if (want !== undefined && rec[key] !== want) return false;
    }

    for (const key of ["method", "class", "module", "lang", "visibility", "thread"] as const) {
      const want = where[key];
      if (want !== undefined && !contains(rec[key], want)) return false;
    }

    if (where.has_error !== undefined) {
      const hasError = e.event === "exit" && e.error != null;
      if (hasError !== where.has_error) return false;
    }

    // Duration lives only on exit events. A range filter therefore implies
    // "exit events only" rather than silently dropping enters via NaN
    // comparisons, which would make min_duration_ns:0 behave like a filter.
    if (where.min_duration_ns !== undefined || where.max_duration_ns !== undefined) {
      if (e.event !== "exit") return false;
      const d = e.duration_ns;
      if (typeof d !== "number") return false;
      if (where.min_duration_ns !== undefined && d < where.min_duration_ns) return false;
      if (where.max_duration_ns !== undefined && d > where.max_duration_ns) return false;
    }

    if (where.min_depth !== undefined || where.max_depth !== undefined) {
      const depth = typeof rec.depth === "number" ? rec.depth : null;
      if (depth === null) return false;
      if (where.min_depth !== undefined && depth < where.min_depth) return false;
      if (where.max_depth !== undefined && depth > where.max_depth) return false;
    }

    return true;
  };
}

/**
 * Combines the structured matcher with the legacy free-text filter. Both are
 * applied when both are given; the free-text one keeps its original
 * case-sensitive whole-row semantics so existing callers do not change
 * behaviour.
 */
export function applyFilters(
  rows: TraceEvent[],
  where?: Where,
  freeText?: string
): TraceEvent[] {
  const match = makeMatcher(where);
  return rows.filter(
    (r) => match(r) && (!freeText || JSON.stringify(r).includes(freeText))
  );
}
