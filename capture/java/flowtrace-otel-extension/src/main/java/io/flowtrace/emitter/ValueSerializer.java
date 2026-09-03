package io.flowtrace.emitter;

import java.lang.reflect.Array;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.Collection;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Renders argument and result values to JSON under the rules every FlowTrace
 * capture layer shares (see {@code TRUNCATION_SYSTEM.md}):
 *
 * <ol>
 *   <li><b>Redaction first.</b> A value whose parameter name — or, inside a
 *       {@link Map}, whose key — contains one of the redact-key substrings
 *       (case-insensitive) is replaced by the string {@code <redacted>}. The
 *       built-in list is {@link #DEFAULT_REDACT_KEYS}; {@code -Dflowtrace.redact-keys}
 *       / {@code FLOWTRACE_REDACT_KEYS} is a comma-separated <em>additive</em>
 *       list.</li>
 *   <li><b>Structural serialization.</b> {@code Map}, {@code Collection},
 *       arrays (primitive arrays included), numbers, booleans, strings,
 *       characters, enums and {@code Optional} become proper JSON, to a depth
 *       of {@link #MAX_DEPTH} containers and {@link #MAX_ELEMENTS} entries per
 *       container. Anything else is {@code toString()} as a JSON string.
 *       {@code NaN} and infinities become {@code null}: bare {@code NaN} is not
 *       JSON, and one such value made the whole line unparseable.</li>
 *   <li><b>Truncation last.</b> If the rendered JSON of one value is longer
 *       than {@link #maxArgLength()} characters, the value is replaced by the
 *       string {@code <truncated:{first N chars of the JSON}...>}. The limit is
 *       measured on the JSON text (quotes and escapes included), which is what
 *       Node, Python and Go measure — a {@code toString()} length is not
 *       comparable across runtimes.</li>
 * </ol>
 *
 * <p>Nothing here throws into the traced method: {@link #serializeValue}
 * catches every {@link Throwable} — including {@link StackOverflowError} from a
 * recursive {@code toString()} — and yields {@code <unserializable: FQCN>}
 * for that one value, so a single hostile argument cannot drop the event.
 *
 * <p>Injected into the application classloader as a helper class alongside
 * {@link FlowtraceEmitter}; must stay dependency-free and Java 11 compatible.
 */
public final class ValueSerializer {

    public static final String MAX_ARG_LENGTH_PROPERTY = "flowtrace.max-arg-length";
    public static final String MAX_ARG_LENGTH_ENV = "FLOWTRACE_MAX_ARG_LENGTH";
    public static final int DEFAULT_MAX_ARG_LENGTH = 512;

    public static final String REDACT_KEYS_PROPERTY = "flowtrace.redact-keys";
    public static final String REDACT_KEYS_ENV = "FLOWTRACE_REDACT_KEYS";
    public static final String DEFAULT_REDACT_KEYS =
            "password,secret,token,authorization,api_key,url,dsn,connection_string,email";
    public static final String REDACTED = "<redacted>";

    /** Containers nested deeper than this are rendered via {@code toString()}. */
    public static final int MAX_DEPTH = 3;
    /** Entries per container beyond this are collapsed into a {@code ...(+N)} element. */
    public static final int MAX_ELEMENTS = 100;

    private static volatile String[] redactKeysCache;

    private ValueSerializer() {}

    // ---- entry points used by the advice and the emitter ----

    /**
     * Serializes a named argument: redaction by parameter name, then
     * {@link #serializeValue}. A redacted value is never rendered at all —
     * its {@code toString()} is not even called — and is never truncated,
     * since the marker is the whole point.
     */
    public static JsonFragment serializeNamed(String name, Object value) {
        if (name != null && isRedactedKey(name)) {
            return JsonFragment.ofString(REDACTED);
        }
        return serializeValue(value);
    }

    /**
     * Serializes one argument or result value: structural JSON with nested
     * key redaction, then truncation on the rendered text. Never throws.
     */
    public static JsonFragment serializeValue(Object value) {
        if (value instanceof JsonFragment) return (JsonFragment) value;
        String json;
        try {
            StringBuilder sb = new StringBuilder(64);
            appendJson(sb, value, 0);
            json = sb.toString();
        } catch (Throwable t) {
            // StackOverflowError included: a recursive toString() must cost
            // one argument, not the event and certainly not the traced call.
            return JsonFragment.ofString("<unserializable: " + safeClassName(value) + ">");
        }
        return truncate(json);
    }

    /** Applies the truncation rule to already-rendered JSON. */
    public static JsonFragment truncate(String json) {
        int max = maxArgLength();
        if (max > 0 && json.length() > max) {
            int cut = max;
            // Do not split a surrogate pair: a lone surrogate cannot be encoded.
            if (Character.isHighSurrogate(json.charAt(cut - 1))) cut--;
            return JsonFragment.ofString("<truncated:" + json.substring(0, cut) + "...>");
        }
        return new JsonFragment(json);
    }

    // ---- configuration ----

    /**
     * The per-value JSON length limit: {@code -Dflowtrace.max-arg-length},
     * else {@code FLOWTRACE_MAX_ARG_LENGTH}, else 512. {@code 0} disables
     * truncation; an unparseable value falls back to the default and a
     * negative one to {@code 0}, because a bad knob must not take down the
     * traced application.
     */
    public static int maxArgLength() {
        String raw = null;
        try {
            raw = System.getProperty(MAX_ARG_LENGTH_PROPERTY);
            if (raw == null || raw.isEmpty()) raw = System.getenv(MAX_ARG_LENGTH_ENV);
        } catch (Throwable ignored) {
            // SecurityManager may forbid either lookup: use the default.
        }
        if (raw == null || raw.trim().isEmpty()) return DEFAULT_MAX_ARG_LENGTH;
        try {
            return Math.max(0, Integer.parseInt(raw.trim()));
        } catch (NumberFormatException e) {
            return DEFAULT_MAX_ARG_LENGTH;
        }
    }

    /**
     * The redact-key substrings, lower-cased: the built-in list plus whatever
     * the property/env var adds. Resolved once and cached — this runs for every
     * key of every map argument of every call.
     */
    public static String[] redactKeys() {
        String[] keys = redactKeysCache;
        if (keys == null) {
            keys = loadRedactKeys();
            redactKeysCache = keys;
        }
        return keys;
    }

    private static String[] loadRedactKeys() {
        StringBuilder all = new StringBuilder(DEFAULT_REDACT_KEYS);
        try {
            String extra = System.getProperty(REDACT_KEYS_PROPERTY);
            if (extra == null || extra.trim().isEmpty()) extra = System.getenv(REDACT_KEYS_ENV);
            if (extra != null) all.append(',').append(extra);
        } catch (Throwable ignored) {
            // SecurityManager: defaults only.
        }
        java.util.List<String> out = new java.util.ArrayList<>();
        for (String part : all.toString().split(",")) {
            String k = part.trim().toLowerCase(Locale.ROOT);
            if (!k.isEmpty() && !out.contains(k)) out.add(k);
        }
        return out.toArray(new String[0]);
    }

    /** Case-insensitive substring match of {@code key} against {@link #redactKeys()}. */
    public static boolean isRedactedKey(String key) {
        if (key == null) return false;
        String lowered = key.toLowerCase(Locale.ROOT);
        for (String k : redactKeys()) {
            if (lowered.contains(k)) return true;
        }
        return false;
    }

    /** Drops the cached redact keys. Tests only. */
    static void resetForTesting() {
        redactKeysCache = null;
    }

    // ---- structural rendering ----

    /**
     * Appends {@code value} as JSON. {@code depth} is the container nesting
     * level of {@code value} itself (a top-level argument is 0); a container
     * at {@link #MAX_DEPTH} or deeper is rendered as its {@code toString()}.
     * May throw — callers that need the no-throw guarantee go through
     * {@link #serializeValue}.
     */
    public static void appendJson(StringBuilder sb, Object value, int depth) {
        if (value == null) {
            sb.append("null");
        } else if (value instanceof JsonFragment) {
            sb.append(((JsonFragment) value).json());
        } else if (value instanceof String) {
            appendString(sb, (String) value);
        } else if (value instanceof Boolean) {
            sb.append(((Boolean) value).booleanValue());
        } else if (value instanceof Number) {
            appendNumber(sb, (Number) value);
        } else if (value instanceof Character) {
            appendString(sb, String.valueOf(value));
        } else if (value instanceof Enum) {
            appendString(sb, ((Enum<?>) value).name());
        } else if (value instanceof Optional) {
            // Transparent: an Optional is a wrapper, not a level of nesting.
            Optional<?> o = (Optional<?>) value;
            if (o.isPresent()) appendJson(sb, o.get(), depth); else sb.append("null");
        } else if (value instanceof Map) {
            if (depth >= MAX_DEPTH) appendString(sb, String.valueOf(value));
            else appendMap(sb, (Map<?, ?>) value, depth);
        } else if (value instanceof Collection) {
            if (depth >= MAX_DEPTH) appendString(sb, String.valueOf(value));
            else appendCollection(sb, (Collection<?>) value, depth);
        } else if (value.getClass().isArray()) {
            if (depth >= MAX_DEPTH) appendString(sb, arrayToString(value));
            else appendArray(sb, value, depth);
        } else {
            appendString(sb, String.valueOf(value));
        }
    }

    private static void appendMap(StringBuilder sb, Map<?, ?> map, int depth) {
        sb.append('{');
        int size = map.size();
        int n = 0;
        for (Map.Entry<?, ?> entry : map.entrySet()) {
            if (n == MAX_ELEMENTS) {
                if (n > 0) sb.append(',');
                sb.append("\"...\":\"(+").append(Math.max(size - n, 1)).append(")\"");
                break;
            }
            if (n > 0) sb.append(',');
            // String.valueOf rather than a cast: Map<Integer, ?> is common and a
            // ClassCastException here used to drop the whole event.
            String key = String.valueOf(entry.getKey());
            appendString(sb, key);
            sb.append(':');
            if (isRedactedKey(key)) appendString(sb, REDACTED);
            else appendJson(sb, entry.getValue(), depth + 1);
            n++;
        }
        sb.append('}');
    }

    private static void appendCollection(StringBuilder sb, Collection<?> col, int depth) {
        sb.append('[');
        int size = col.size();
        int n = 0;
        Iterator<?> it = col.iterator();
        while (it.hasNext()) {
            Object element = it.next();
            if (n == MAX_ELEMENTS) {
                if (n > 0) sb.append(',');
                appendString(sb, "...(+" + Math.max(size - n, 1) + ")");
                break;
            }
            if (n > 0) sb.append(',');
            appendJson(sb, element, depth + 1);
            n++;
        }
        sb.append(']');
    }

    private static void appendArray(StringBuilder sb, Object array, int depth) {
        sb.append('[');
        int length = Array.getLength(array);
        int shown = Math.min(length, MAX_ELEMENTS);
        for (int i = 0; i < shown; i++) {
            if (i > 0) sb.append(',');
            appendJson(sb, Array.get(array, i), depth + 1);
        }
        if (length > shown) {
            if (shown > 0) sb.append(',');
            appendString(sb, "...(+" + (length - shown) + ")");
        }
        sb.append(']');
    }

    private static String arrayToString(Object array) {
        return array.getClass().getComponentType().getSimpleName() + "[" + Array.getLength(array) + "]";
    }

    private static void appendNumber(StringBuilder sb, Number n) {
        if (n instanceof Double || n instanceof Float) {
            double d = n.doubleValue();
            if (Double.isNaN(d) || Double.isInfinite(d)) sb.append("null");
            else sb.append(n instanceof Float ? Float.toString(n.floatValue()) : Double.toString(d));
        } else if (n instanceof Integer || n instanceof Long || n instanceof Short || n instanceof Byte
                || n instanceof BigInteger || n instanceof BigDecimal
                || n instanceof AtomicInteger || n instanceof AtomicLong) {
            sb.append(n.toString());
        } else {
            // Unknown Number subclass: trust toString() only if it is a JSON number.
            String s = n.toString();
            if (isJsonNumber(s)) {
                sb.append(s);
            } else {
                double d = n.doubleValue();
                if (Double.isNaN(d) || Double.isInfinite(d)) sb.append("null");
                else sb.append(d);
            }
        }
    }

    /** JSON number grammar: -?digits(.digits)?([eE][+-]?digits)?. */
    static boolean isJsonNumber(String s) {
        int i = 0, len = s.length();
        if (len == 0) return false;
        if (s.charAt(i) == '-') i++;
        int start = i;
        while (i < len && Character.isDigit(s.charAt(i))) i++;
        if (i == start) return false;
        if (i < len && s.charAt(i) == '.') {
            i++;
            start = i;
            while (i < len && Character.isDigit(s.charAt(i))) i++;
            if (i == start) return false;
        }
        if (i < len && (s.charAt(i) == 'e' || s.charAt(i) == 'E')) {
            i++;
            if (i < len && (s.charAt(i) == '+' || s.charAt(i) == '-')) i++;
            start = i;
            while (i < len && Character.isDigit(s.charAt(i))) i++;
            if (i == start) return false;
        }
        return i == len;
    }

    /** Appends {@code s} as a quoted, escaped JSON string literal. */
    public static void appendString(StringBuilder sb, String s) {
        sb.append('"').append(escapeJson(s)).append('"');
    }

    /** Escapes {@code s} for use inside a JSON string literal (no quotes added). */
    public static String escapeJson(String s) {
        if (s == null) return "";
        StringBuilder sb = new StringBuilder(s.length() + 8);
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
                        sb.append(String.format(Locale.ROOT, "\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        return sb.toString();
    }

    private static String safeClassName(Object value) {
        try {
            return value == null ? "null" : value.getClass().getName();
        } catch (Throwable t) {
            return "unknown";
        }
    }
}
