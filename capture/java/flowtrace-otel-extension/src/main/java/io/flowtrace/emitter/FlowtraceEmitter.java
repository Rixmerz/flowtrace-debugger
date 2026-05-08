package io.flowtrace.emitter;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Singleton JSONL emitter for FlowTrace v2.
 *
 * <p>This class is injected into the agent/bootstrap classloader as a helper
 * class by the OTel extension. It must have <strong>zero external
 * dependencies</strong> — Jackson is not available in that classloader context.
 * JSONL serialization is therefore done with a hand-rolled builder that covers
 * exactly the {@link TraceEvent} schema.
 *
 * <p>Thread-safe: all writes go through a single synchronized
 * {@link BufferedWriter}.
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
        } catch (IOException e) {
            System.err.println("[flowtrace] emit error: " + e.getMessage());
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
            appendValue(sb, "result", e.getResult());
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
        // Use plain decimal format (no scientific notation) to match schema expectations.
        sb.append('"').append(escapeJson(key)).append("\":").append(String.format("%.3f", val));
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

    @SuppressWarnings("unchecked")
    private static void appendValue(StringBuilder sb, String key, Object val) {
        sb.append('"').append(escapeJson(key)).append("\":");
        appendRawValue(sb, val);
    }

    private static void appendRawValue(StringBuilder sb, Object val) {
        if (val == null) {
            sb.append("null");
        } else if (val instanceof Map) {
            @SuppressWarnings("unchecked")
            Map<String, Object> m = (Map<String, Object>) val;
            sb.append('{');
            boolean first = true;
            for (Map.Entry<String, Object> entry : m.entrySet()) {
                if (!first) sb.append(',');
                first = false;
                sb.append('"').append(escapeJson(entry.getKey())).append("\":");
                appendRawValue(sb, entry.getValue());
            }
            sb.append('}');
        } else if (val instanceof Number || val instanceof Boolean) {
            sb.append(val);
        } else {
            sb.append('"').append(escapeJson(val.toString())).append('"');
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
        if (s == null) return "";
        StringBuilder sb = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"':  sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n");  break;
                case '\r': sb.append("\\r");  break;
                case '\t': sb.append("\\t");  break;
                default:
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        return sb.toString();
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
        writer = new BufferedWriter(new FileWriter(outFile, true));
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
