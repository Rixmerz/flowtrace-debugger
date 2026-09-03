package io.flowtrace.emitter;

/**
 * A value that has already been rendered to JSON.
 *
 * <p>Arguments and results are serialized exactly once, at method entry (see
 * {@link io.flowtrace.advice.FlowtraceAdvice}), because the truncation rule is
 * measured on the JSON form and because both the enter and the exit event
 * must carry byte-identical {@code args}. The rendered text travels inside the
 * event's {@code Map<String, Object>} wrapped in this type so that
 * {@link FlowtraceEmitter} writes it verbatim instead of quoting it as a
 * string or serializing it a second time.
 */
public final class JsonFragment {

    private final String json;

    public JsonFragment(String json) {
        this.json = json == null ? "null" : json;
    }

    /** A fragment holding {@code s} as a JSON string literal (quoted, escaped). */
    public static JsonFragment ofString(String s) {
        StringBuilder sb = new StringBuilder(s.length() + 2);
        ValueSerializer.appendString(sb, s);
        return new JsonFragment(sb.toString());
    }

    /** The rendered JSON, ready to be appended to a document. */
    public String json() {
        return json;
    }

    @Override
    public String toString() {
        return json;
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof JsonFragment && json.equals(((JsonFragment) o).json);
    }

    @Override
    public int hashCode() {
        return json.hashCode();
    }
}
