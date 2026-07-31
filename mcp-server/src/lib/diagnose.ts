/**
 * Turn a load result into an explicit warning for the MCP CLIENT.
 *
 * `loadJsonl` already writes a warning to stderr when a file looks like v1. That
 * is invisible where it matters: the MCP protocol speaks over stdio, so stderr
 * goes to the server's own log and the agent calling the tool never sees it. What
 * the agent receives is `{ count: 0, schemaVersion: "v1", malformed: 2 }` — the
 * facts are present but require interpretation, and the natural reading of
 * `count: 0` is "this trace is empty", which is a confidently wrong conclusion.
 *
 * A partially-dropped file is worse still: `log.aggregate` and `log.search` then
 * return authoritative-looking numbers computed over whatever fraction survived,
 * with nothing to indicate the rest was discarded.
 *
 * So the diagnosis is stated in the response, in words, alongside what to do
 * about it.
 */

export interface LoadDiagnosis {
  /** Human-readable problem statement, or null when the load was clean. */
  warning: string | null;
}

/**
 * @param path - file that was loaded, for a message the agent can act on
 * @param schemaVersion - as detected from the first parsed object
 * @param count - rows that survived
 * @param malformed - lines dropped
 */
export function diagnoseLoad(
  path: string,
  schemaVersion: "v2" | "v1",
  count: number,
  malformed: number
): LoadDiagnosis {
  if (schemaVersion === "v1") {
    return {
      warning:
        `${path} is a v1 trace, not v2. Every v2 tool will return empty results ` +
        `for this session (${malformed} line(s) dropped, ${count} usable). The two ` +
        `formats are mutually unreadable and no converter exists: v1 used ` +
        `timestamp/ENTER/durationMicros, v2 uses ts/enter/duration_ns plus W3C ` +
        `trace ids. Re-capture the trace with a v2 agent.`,
    };
  }

  if (count === 0 && malformed > 0) {
    return {
      warning:
        `${path} yielded no usable events: all ${malformed} line(s) were dropped. ` +
        `Lines must be JSON objects carrying trace_id, span_id, a numeric ts and ` +
        `event set to "enter" or "exit". Do NOT read this as an empty trace.`,
    };
  }

  if (count === 0) {
    return {
      warning:
        `${path} contains no events. The file parsed cleanly, so the capture layer ` +
        `most likely produced nothing — check that the package prefix matches the ` +
        `code under trace.`,
    };
  }

  if (malformed > 0) {
    const pct = ((malformed / (malformed + count)) * 100).toFixed(1);
    return {
      warning:
        `${path}: ${malformed} of ${malformed + count} line(s) (${pct}%) were ` +
        `dropped as unparseable or non-v2. Aggregates and searches over this ` +
        `session cover only the remaining ${count} event(s), so treat any totals ` +
        `as a lower bound.`,
    };
  }

  return { warning: null };
}
