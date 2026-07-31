package io.flowtrace.advice;

import io.opentelemetry.api.trace.SpanContext;
import io.opentelemetry.api.trace.TraceFlags;
import io.opentelemetry.api.trace.TraceState;

/**
 * Reads a W3C {@code traceparent} from the environment so a Java process can
 * continue a trace started by another process.
 *
 * <p>Why this exists: the OTel agent gives Java network propagation for free,
 * but only for frameworks it instruments, and only over the wire. It has no
 * concept of an <em>environment</em> carrier. Node and Python both honour
 * {@code FLOWTRACE_TRACEPARENT}, so without this a Node parent spawning a Java
 * child produced two unrelated traces while the same parent spawning a Python
 * child produced one — an asymmetry with no justification other than nobody
 * having implemented it.
 *
 * <p>Format (W3C Trace Context Level 1):
 * {@code 00-<32 hex trace_id>-<16 hex span_id>-<2 hex flags>}
 *
 * <p>Resolved once and cached: the process environment cannot change mid-run,
 * and this is consulted on the hot path for every root span.
 *
 * <p>Also readable from the {@code flowtrace.traceparent} system property, which
 * takes precedence — system properties are how every other FlowTrace knob is
 * configured on the JVM ({@code flowtrace.package-prefix},
 * {@code flowtrace.output}), and env vars cannot be set reliably from within a
 * running JVM, which makes the property the only testable path.
 *
 * @see <a href="https://www.w3.org/TR/trace-context/">W3C Trace Context</a>
 */
public final class TraceparentSeed {

    /** Env var carrier, matching the Node and Python capture layers. */
    public static final String ENV_VAR = "FLOWTRACE_TRACEPARENT";

    /** System property carrier, which wins over the env var. */
    public static final String SYS_PROP = "flowtrace.traceparent";

    private static final String NULL_TRACE_ID = "00000000000000000000000000000000";
    private static final String NULL_SPAN_ID = "0000000000000000";

    /** Cached result. Set once by {@link #get()}; {@code null} means "no seed". */
    private static volatile SpanContext cached;
    private static volatile boolean resolved;

    private TraceparentSeed() {}

    /**
     * The remote SpanContext implied by the carrier, or {@code null} if absent
     * or malformed.
     *
     * <p>Never throws: a bad carrier from an upstream service must not break the
     * traced application, so anything unparseable degrades to "no seed" and the
     * process simply starts its own trace.
     */
    public static SpanContext get() {
        if (!resolved) {
            synchronized (TraceparentSeed.class) {
                if (!resolved) {
                    cached = parse(readCarrier());
                    resolved = true;
                }
            }
        }
        return cached;
    }

    private static String readCarrier() {
        try {
            String prop = System.getProperty(SYS_PROP);
            if (prop != null && !prop.trim().isEmpty()) return prop;
            return System.getenv(ENV_VAR);
        } catch (Throwable t) {
            // A SecurityManager may forbid env access; treat as "no seed".
            return null;
        }
    }

    /**
     * Parse a {@code traceparent} value into a remote SpanContext.
     *
     * <p>Package-private rather than private so the unit test can exercise the
     * spec's validity rules directly without mutating process state.
     */
    static SpanContext parse(String value) {
        if (value == null) return null;
        String trimmed = value.trim().toLowerCase();
        String[] parts = trimmed.split("-");
        // version, trace_id, span_id, flags. Future versions may append more.
        if (parts.length < 4) return null;

        String version = parts[0];
        String traceId = parts[1];
        String spanId = parts[2];
        String flags = parts[3];

        // "ff" is forbidden by the spec; any other version still lets us read
        // the first four fields, which forward compatibility requires.
        if (!isHex(version, 2) || "ff".equals(version)) return null;
        // Version 00 has exactly four fields; extras mean a malformed v00 header.
        if ("00".equals(version) && parts.length != 4) return null;
        if (!isHex(traceId, 32) || NULL_TRACE_ID.equals(traceId)) return null;
        if (!isHex(spanId, 16) || NULL_SPAN_ID.equals(spanId)) return null;
        if (!isHex(flags, 2)) return null;

        try {
            return SpanContext.createFromRemoteParent(
                    traceId,
                    spanId,
                    TraceFlags.fromHex(flags, 0),
                    TraceState.getDefault());
        } catch (Throwable t) {
            return null;
        }
    }

    private static boolean isHex(String s, int len) {
        if (s == null || s.length() != len) return false;
        for (int i = 0; i < len; i++) {
            char c = s.charAt(i);
            boolean ok = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
            if (!ok) return false;
        }
        return true;
    }

    /** Clears the cache. Tests only. */
    static void resetForTesting() {
        synchronized (TraceparentSeed.class) {
            cached = null;
            resolved = false;
        }
    }
}
