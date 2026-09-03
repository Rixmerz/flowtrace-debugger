package io.flowtrace.probe;

import io.flowtrace.emitter.FlowtraceEmitter;
import io.flowtrace.emitter.TraceEvent;
import io.flowtrace.emitter.ValueSerializer;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Main class run in a forked JVM by {@code ForkedJvmEmitterTest}, so that
 * JVM-wide settings a running test JVM cannot change — {@code file.encoding},
 * environment variables — can be asserted through the real emitter path.
 *
 * <p>The non-ASCII text is a constant rather than an argv value: how the JVM
 * decodes argv depends on {@code sun.jnu.encoding}, which is exactly the kind
 * of platform detail this probe exists to be independent of.
 *
 * <p>Args are built through {@link ValueSerializer} directly, not through
 * {@code FlowtraceAdvice}: the advice class references OTel API types in its
 * enter/exit signatures, which the child classpath (main + test classes only)
 * does not carry. Parameter-name resolution has its own unit test.
 */
public final class EmitterProbe {

    /** ñ is Latin-1 (but not UTF-8-identical); 日本語 and € are not Latin-1 at all. */
    public static final String NON_ASCII = "ñ 日本語 €";

    private EmitterProbe() {}

    /**
     * Usage: {@code EmitterProbe <mode>} where mode is {@code utf8} (emit
     * {@link #NON_ASCII}) or {@code long} (emit a 200-char string). Output
     * file comes from {@code -Dflowtrace.output}.
     */
    public static void main(String[] argv) throws Exception {
        String value = "utf8".equals(argv[0]) ? NON_ASCII : "x".repeat(200);
        Map<String, Object> args = new LinkedHashMap<>();
        args.put("message", ValueSerializer.serializeNamed("message", value));

        TraceEvent e = new TraceEvent();
        e.setTs(1700000000.123456);
        e.setTraceId("f10c17ace000000000000000000000a1");
        e.setSpanId("0000000000000001");
        e.setEvent("enter");
        e.setThread("main");
        e.setModule("io.flowtrace.probe");
        e.setClassName("EmitterProbe");
        e.setMethod("greet");
        e.setVisibility("public");
        e.setArgs(args);
        e.setDepth(0);
        FlowtraceEmitter.getInstance().emit(e);
        // Deliberately no close(): the shutdown hook is part of what is under test.
    }
}
