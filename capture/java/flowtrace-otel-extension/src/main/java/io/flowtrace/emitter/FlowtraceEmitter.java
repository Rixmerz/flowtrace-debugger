package io.flowtrace.emitter;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;

/**
 * Singleton JSONL emitter for FlowTrace v2.
 *
 * <p>This class is injected into the agent/bootstrap classloader as a helper
 * class by the OTel extension. It must have <strong>zero external
 * dependencies</strong> — Jackson is not available in that classloader context.
 * JSONL serialization is therefore done with a hand-rolled builder that covers
 * exactly the {@link TraceEvent} schema; {@code args} and {@code result}
 * values go through {@link ValueSerializer}, which owns the structural,
 * redaction and truncation rules shared with the other capture layers.
 *
 * <p>Thread-safe: all writes go through a single synchronized
 * {@link BufferedWriter}, flushed per line so a crash loses nothing. The
 * file is always UTF-8 regardless of {@code file.encoding}, and a JVM
 * shutdown hook closes the writer.
 *
 * <p>Output path (first wins):
 * <ol>
 *   <li>{@code flowtrace.output} system property.</li>
 *   <li>{@code FLOWTRACE_OUTPUT} environment variable.</li>
 *   <li>{@code .flowtrace/<ISO-instant>.jsonl} relative to cwd.</li>
 * </ol>
 *
 * <p>W3C ID validation is enforced on every emit; invalid events are dropped
 * with a stderr warning.
 */
public final class FlowtraceEmitter {

    private static final Pattern TRACE_ID_RE = Pattern.compile("^[0-9a-f]{32}$");
    private static final Pattern SPAN_ID_RE  = Pattern.compile("^[0-9a-f]{16}$");

    private static final DateTimeFormatter TS_FMT =
            DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss'Z'").withZone(ZoneOffset.UTC);

    private static volatile FlowtraceEmitter INSTANCE;

    private BufferedWriter writer; // guarded by this

    private FlowtraceEmitter() {}

    public static FlowtraceEmitter getInstance() {
        if (INSTANCE == null) {
            synchronized (FlowtraceEmitter.class) {
                if (INSTANCE == null) {
                    INSTANCE = new FlowtraceEmitter();
                }
            }
        }
        return INSTANCE;
    }

    public void emit(TraceEvent event) {
        if (!validateIds(event)) return;
        try {
            String line = toJson(event);
            synchronized (this) {
                ensureWriter();
                writer.write(line);
                writer.newLine();
                writer.flush();
            }
        } catch (IOException | RuntimeException e) {
            System.err.println("[flowtrace] emit error: " + e);
        }
    }

    // ---- hand-rolled JSON serialization (no external deps) ----

    private static String toJson(TraceEvent e) {
        StringBuilder sb = new StringBuilder(256);
        sb.append('{');

        appendDouble(sb, "ts", e.getTs()); sb.append(',');
        appendStr(sb, "trace_id", e.getTraceId()); sb.append(',');
        appendStr(sb, "span_id", e.getSpanId()); sb.append(',');
        appendStrOrNull(sb, "parent_id", e.getParentId()); sb.append(',');
        appendStr(sb, "event", e.getEvent()); sb.append(',');
        appendStr(sb, "thread", e.getThread()); sb.append(',');
        appendStr(sb, "lang", e.getLang()); sb.append(',');
        appendStr(sb, "module", e.getModule()); sb.append(',');
        appendStr(sb, "class", e.getClassName()); sb.append(',');
        appendStr(sb, "method", e.getMethod()); sb.append(',');
        appendStr(sb, "visibility", e.getVisibility()); sb.append(',');
        appendMap(sb, "args", e.getArgs()); sb.append(',');
        sb.append('"').append("depth").append("\":").append(e.getDepth());

        // exit-only fields
        if (e.getDurationNs() != null) {
            sb.append(',');
            sb.append('"').append("duration_ns").append("\":").append(e.getDurationNs());
        }
        if (e.getResult() != null) {
            sb.append(',');
            appendMap(sb, "result", e.getResult());
        }
        if (e.getError() != null) {
            sb.append(',');
            appendError(sb, e.getError());
        }

        sb.append('}');
        return sb.toString();
    }

    private static void appendStr(StringBuilder sb, String key, String val) {
        sb.append('"').append(escapeJson(key)).append("\":\"")
          .append(val == null ? "" : escapeJson(val)).append('"');
    }

    private static void appendStrOrNull(StringBuilder sb, String key, String val) {
        sb.append('"').append(escapeJson(key)).append("\":");
        if (val == null) sb.append("null");
        else sb.append('"').append(escapeJson(val)).append('"');
    }

    private static void appendDouble(StringBuilder sb, String key, double val) {
        // Plain decimal, six fraction digits (microseconds), never localized.
        // Locale is load-bearing, not defensive: String.format without an
        // explicit locale uses the JVM default, and the default in Chile — or
        // most of Europe and Latin America — renders a comma as the decimal
        // separator: `"ts":1785481163,844`. That is not merely ugly, it is
        // invalid JSON, so every line of a Java trace becomes unparseable for
        // every consumer. CI runs under an English locale, which is why no
        // test ever saw it. Formatting by hand from a long sidesteps the
        // locale machinery entirely and is cheaper than String.format on a
        // path that runs twice per traced call.
        sb.append('"').append(escapeJson(key)).append("\":");
        if (Double.isNaN(val) || Double.isInfinite(val)) val = 0d;
        long micros = Math.round(val * 1_000_000d);
        if (micros < 0) {
            sb.append('-');
            micros = -micros;
        }
        long seconds = micros / 1_000_000L;
        long fraction = micros % 1_000_000L;
        sb.append(seconds).append('.');
        String frac = Long.toString(fraction);
        for (int i = frac.length(); i < 6; i++) sb.append('0');
        sb.append(frac);
    }

    @SuppressWarnings("unchecked")
    private static void appendMap(StringBuilder sb, String key, Map<String, Object> map) {
        sb.append('"').append(escapeJson(key)).append("\":{");
        if (map != null && !map.isEmpty()) {
            boolean first = true;
            for (Map.Entry<String, Object> entry : map.entrySet()) {
                if (!first) sb.append(',');
                first = false;
                sb.append('"').append(escapeJson(entry.getKey())).append("\":");
                appendRawValue(sb, entry.getValue());
            }
        }
        sb.append('}');
    }

    /**
     * One {@code args} / {@code result} value. Already-rendered fragments are
     * written verbatim — re-measuring them would truncate a truncation marker.
     * Anything else goes through the full structural + truncation rule, so an
     * event built directly (tests, future callers) gets the same treatment as
     * one built by the advice.
     */
    private static void appendRawValue(StringBuilder sb, Object val) {
        if (val instanceof JsonFragment) {
            sb.append(((JsonFragment) val).json());
        } else {
            sb.append(ValueSerializer.serializeValue(val).json());
        }
    }

    private static void appendError(StringBuilder sb, ErrorInfo err) {
        sb.append('"').append("error").append("\":{");
        sb.append('"').append("type").append("\":\"").append(escapeJson(err.getType())).append("\",");
        sb.append('"').append("msg").append("\":\"").append(escapeJson(err.getMsg())).append("\",");
        sb.append('"').append("stack").append("\":[");
        List<String> stack = err.getStack();
        if (stack != null) {
            for (int i = 0; i < stack.size(); i++) {
                if (i > 0) sb.append(',');
                sb.append('"').append(escapeJson(stack.get(i))).append('"');
            }
        }
        sb.append("]}");
    }

    private static String escapeJson(String s) {
        return ValueSerializer.escapeJson(s);
    }

    // ---- ID validation ----

    private boolean validateIds(TraceEvent event) {
        if (event.getTraceId() == null || !TRACE_ID_RE.matcher(event.getTraceId()).matches()) {
            System.err.println("[flowtrace] DROP invalid trace_id='" + event.getTraceId() + "'");
            return false;
        }
        if (event.getSpanId() == null || !SPAN_ID_RE.matcher(event.getSpanId()).matches()) {
            System.err.println("[flowtrace] DROP invalid span_id='" + event.getSpanId() + "'");
            return false;
        }
        if (event.getParentId() != null && !SPAN_ID_RE.matcher(event.getParentId()).matches()) {
            System.err.println("[flowtrace] DROP invalid parent_id='" + event.getParentId() + "'");
            return false;
        }
        return true;
    }

    // ---- writer lifecycle ----

    private void ensureWriter() throws IOException {
        if (writer != null) return;
        String sysProp = System.getProperty("flowtrace.output");
        String envPath = (sysProp != null && !sysProp.isEmpty())
                ? sysProp : System.getenv("FLOWTRACE_OUTPUT");
        File outFile;
        if (envPath != null && !envPath.isEmpty()) {
            outFile = new File(envPath);
        } else {
            File dir = new File(".flowtrace");
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
            outFile = new File(dir, TS_FMT.format(Instant.now()) + ".jsonl");
        }
        // Explicit UTF-8: FileWriter used the platform default charset, so a
        // JVM started with -Dfile.encoding=ISO-8859-1 (or any pre-JEP-400
        // JDK on a non-UTF-8 locale) wrote non-Latin-1 arguments as '?'.
        // Every consumer reads the file as UTF-8.
        writer = new BufferedWriter(new OutputStreamWriter(
                new FileOutputStream(outFile, true), StandardCharsets.UTF_8));
        registerShutdownHook();
    }

    private static final AtomicBoolean HOOK_REGISTERED = new AtomicBoolean();

    /**
     * Closes the writer when the JVM exits. Every line is flushed as it is
     * written, so this loses nothing if it never runs (SIGKILL); it exists so
     * the file descriptor is released cleanly and the last buffered bytes of a
     * partial write are not stranded. Registered once per JVM, not per
     * instance: {@link #resetForTesting()} creates many instances.
     */
    private static void registerShutdownHook() {
        if (!HOOK_REGISTERED.compareAndSet(false, true)) return;
        try {
            Runtime.getRuntime().addShutdownHook(new Thread(() -> {
                FlowtraceEmitter current = INSTANCE;
                if (current != null) current.close();
            }, "flowtrace-emitter-close"));
        } catch (Throwable t) {
            // Already shutting down, or a SecurityManager said no: per-line
            // flush makes this a no-op loss.
        }
    }

    public synchronized void close() {
        if (writer != null) {
            try { writer.close(); } catch (IOException ignored) {}
            finally { writer = null; }
        }
    }

    static void resetForTesting() {
        if (INSTANCE != null) {
            INSTANCE.close();
            INSTANCE = null;
        }
    }
}
