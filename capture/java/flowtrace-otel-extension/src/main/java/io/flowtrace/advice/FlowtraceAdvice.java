package io.flowtrace.advice;

import io.flowtrace.emitter.ErrorInfo;
import io.flowtrace.emitter.FlowtraceEmitter;
import io.flowtrace.emitter.TraceEvent;
import io.flowtrace.emitter.ValueSerializer;
import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanContext;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.context.Context;
import io.opentelemetry.context.Scope;
import net.bytebuddy.asm.Advice;
import net.bytebuddy.implementation.bytecode.assign.Assigner;

import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.lang.reflect.Parameter;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * ByteBuddy Advice that captures enter/exit events for instrumented methods.
 *
 * <p>Design decisions:
 * <ul>
 *   <li>Depth is tracked via {@link DepthTracker} ThreadLocal — simpler than
 *       traversing OTel SpanContext parent chains.</li>
 *   <li>A new OTel Span is started per method call so trace_id / span_id /
 *       parent_id form a correct tree. The enclosing span context is captured
 *       before {@code makeCurrent()} so parent_id is correct.</li>
 *   <li>Args are keyed by parameter name when the class was compiled with
 *       {@code -parameters} (the only case in which the JVM exposes real
 *       names), otherwise {@code arg0}, {@code arg1}, … Values are rendered by
 *       {@link ValueSerializer} — redaction, structural JSON, truncation —
 *       <em>once</em>, at entry, and carried to the exit event through an
 *       {@code @Advice.Local}, so both events carry identical {@code args}
 *       even if the method mutates its arguments.</li>
 *   <li>Result is wrapped as {@code {"value": result}}; void, {@code null} and
 *       throwing calls emit an empty object.</li>
 *   <li>Modifiers are read from {@code @Advice.Origin Method} — the only
 *       reliable way to get them without reflection on the class loader.</li>
 * </ul>
 */
public class FlowtraceAdvice {

    // Baseline for sub-ms precision ts: compute once at class-load time.
    // ts = (BASELINE_MS / 1000.0) + (nanoTime() - BASELINE_NS) / 1e9
    // Must be public: ByteBuddy inlines advice into the target class, which
    // accesses these fields directly and requires them to be accessible.
    public static final long BASELINE_MS = System.currentTimeMillis();
    public static final long BASELINE_NS = System.nanoTime();

    @Advice.OnMethodEnter(suppress = Throwable.class)
    public static void onEnter(
            @Advice.Origin("#t") String className,
            @Advice.Origin("#m") String methodName,
            @Advice.Origin Method  originMethod,
            @Advice.AllArguments  Object[] allArgs,
            @Advice.Local("flowtraceSpan")    Span   span,
            @Advice.Local("flowtraceScope")   Scope  scope,
            @Advice.Local("flowtraceStart")   long   startNanos,
            @Advice.Local("flowtraceDepth")   int    depth,
            @Advice.Local("flowtraceParent")  String parentId,
            @Advice.Local("flowtraceTraceId") String traceId,
            @Advice.Local("flowtraceSpanId")  String spanId,
            @Advice.Local("flowtraceArgs")    Map<String, Object> args
    ) {
        try {
            depth = DepthTracker.enterAndGet();

            // Capture enclosing span BEFORE starting a new one — this is the parent.
            Context parentContext = Context.current();
            Span enclosingSpan = Span.fromContext(parentContext);
            SpanContext enclosingSc = enclosingSpan.getSpanContext();

            // No enclosing span means this is a local root. Before letting OTel
            // mint a brand-new trace_id, adopt an inbound context from the
            // environment carrier so the trace continues across the process
            // boundary. The OTel agent handles the *network* boundary itself
            // but knows nothing about env vars, and Node and Python both honour
            // FLOWTRACE_TRACEPARENT — so without this a Node parent spawning a
            // Java child produced two unrelated traces.
            if (!enclosingSc.isValid()) {
                SpanContext seeded = TraceparentSeed.get();
                if (seeded != null) {
                    parentContext = parentContext.with(Span.wrap(seeded));
                    enclosingSc = seeded;
                }
            }
            parentId = enclosingSc.isValid() ? enclosingSc.getSpanId() : null;

            Tracer tracer = GlobalOpenTelemetry.getTracer("io.flowtrace", "2.1.0");
            // setParent is required: without it the builder falls back to
            // Context.current(), which does NOT contain the seeded span.
            span      = tracer.spanBuilder(methodName).setParent(parentContext).startSpan();
            scope     = parentContext.with(span).makeCurrent();
            startNanos = System.nanoTime();

            SpanContext sc = span.getSpanContext();
            traceId = sc.getTraceId();
            spanId  = sc.getSpanId();

            int modifiers = originMethod != null ? originMethod.getModifiers() : 0;

            TraceEvent event = new TraceEvent();
            event.setTs(BASELINE_MS / 1000.0 + (System.nanoTime() - BASELINE_NS) / 1e9);
            event.setTraceId(traceId);
            event.setSpanId(spanId);
            event.setParentId(parentId);
            event.setEvent("enter");
            event.setThread(Thread.currentThread().getName());
            event.setModule(extractModule(className));
            event.setClassName(extractSimpleClass(className));
            event.setMethod(methodName);
            event.setVisibility(visibilityFromModifiers(modifiers));
            args = buildArgs(originMethod, allArgs);
            event.setArgs(args);
            event.setDepth(depth);

            FlowtraceEmitter.getInstance().emit(event);
        } catch (Throwable t) {
            System.err.println("[flowtrace] onEnter error: " + t);
        }
    }

    @Advice.OnMethodExit(onThrowable = Throwable.class, suppress = Throwable.class)
    public static void onExit(
            @Advice.Origin("#t") String className,
            @Advice.Origin("#m") String methodName,
            @Advice.Origin Method  originMethod,
            @Advice.Return(typing = Assigner.Typing.DYNAMIC) Object result,
            @Advice.Thrown Throwable thrown,
            @Advice.Local("flowtraceSpan")    Span   span,
            @Advice.Local("flowtraceScope")   Scope  scope,
            @Advice.Local("flowtraceStart")   long   startNanos,
            @Advice.Local("flowtraceDepth")   int    depth,
            @Advice.Local("flowtraceParent")  String parentId,
            @Advice.Local("flowtraceTraceId") String traceId,
            @Advice.Local("flowtraceSpanId")  String spanId,
            @Advice.Local("flowtraceArgs")    Map<String, Object> args
    ) {
        try {
            long durationNs = System.nanoTime() - startNanos;
            int exitDepth   = DepthTracker.exitAndGet();

            int modifiers = originMethod != null ? originMethod.getModifiers() : 0;

            TraceEvent event = new TraceEvent();
            event.setTs(BASELINE_MS / 1000.0 + (System.nanoTime() - BASELINE_NS) / 1e9);
            event.setTraceId(traceId != null ? traceId : "00000000000000000000000000000000");
            event.setSpanId(spanId   != null ? spanId  : "0000000000000000");
            event.setParentId(parentId);
            event.setEvent("exit");
            event.setThread(Thread.currentThread().getName());
            event.setModule(extractModule(className));
            event.setClassName(extractSimpleClass(className));
            event.setMethod(methodName);
            event.setVisibility(visibilityFromModifiers(modifiers));
            // Serialized at entry; null only if onEnter failed before reaching it.
            event.setArgs(args != null ? args : new LinkedHashMap<>());
            event.setDepth(exitDepth);
            event.setDurationNs(durationNs);

            if (thrown != null) {
                List<String> stack = Arrays.stream(thrown.getStackTrace())
                        .limit(20)
                        .map(StackTraceElement::toString)
                        .collect(Collectors.toList());
                event.setError(new ErrorInfo(
                        thrown.getClass().getName(),
                        thrown.getMessage(),
                        stack
                ));
                // `result` is required on every exit event by schema v2, and
                // TraceEvent omits nulls — so leaving it unset here emitted
                // events that failed our own schema. A throwing call produced
                // no value, and {} is already how a void return is encoded.
                event.setResult(new LinkedHashMap<>());
            } else {
                if (result != null) {
                    Map<String, Object> resultMap = new LinkedHashMap<>();
                    resultMap.put("value", ValueSerializer.serializeValue(result));
                    event.setResult(resultMap);
                } else {
                    // void return — emit empty object to match golden
                    event.setResult(new LinkedHashMap<>());
                }
            }

            FlowtraceEmitter.getInstance().emit(event);

            if (scope != null) scope.close();
            if (span  != null) span.end();
        } catch (Throwable t) {
            System.err.println("[flowtrace] onExit error: " + t);
        }
    }

    // ---- helpers — must be public: ByteBuddy inlines advice into the target class ----

    /**
     * Maps Java modifiers onto the schema's visibility enum, which is
     * {@code public | private | internal | unknown} — there is no
     * {@code protected}. Returning it emitted events that failed our own
     * schema for any protected method, and no golden fixture declares one, so
     * nothing caught it.
     *
     * <p>protected and package-private both collapse to "internal": visible
     * beyond the declaring type, but not public API.
     */
    public static String visibilityFromModifiers(int mod) {
        if (Modifier.isPublic(mod))  return "public";
        if (Modifier.isPrivate(mod)) return "private";
        return "internal"; // protected and package-private
    }

    /**
     * Renders the call's arguments once, keyed by parameter name where the
     * JVM knows it, {@code argN} otherwise. Each value goes through
     * {@link ValueSerializer#serializeNamed} independently, so one hostile
     * argument costs exactly one {@code <unserializable: ...>} entry.
     */
    public static Map<String, Object> buildArgs(Method method, Object[] args) {
        Map<String, Object> map = new LinkedHashMap<>();
        if (args == null) return map;
        String[] names = parameterNames(method, args.length);
        for (int i = 0; i < args.length; i++) {
            String name = names != null ? names[i] : "arg" + i;
            Object rendered;
            try {
                rendered = ValueSerializer.serializeNamed(name, args[i]);
            } catch (Throwable t) {
                // serializeNamed already never throws; this is belt and braces
                // for the one place where a failure would drop the event.
                rendered = "<unserializable: " + (args[i] == null ? "null" : args[i].getClass().getName()) + ">";
            }
            map.put(name, rendered);
        }
        return map;
    }

    /** {@code argN} keys only — kept for callers without an origin method. */
    public static Map<String, Object> buildArgs(Object[] args) {
        return buildArgs(null, args);
    }

    /**
     * Real parameter names, or {@code null} to fall back to {@code argN}.
     *
     * <p>The JVM only carries names when the class was compiled with
     * {@code -parameters} (the {@code MethodParameters} attribute) —
     * {@link Parameter#isNamePresent()} says so. ByteBuddy's own
     * {@code MethodDescription} sees exactly the same attribute at weave time
     * (the OTel agent parses class files in FAST mode, which skips the debug
     * {@code LocalVariableTable}), so reflection here costs nothing in
     * coverage and keeps the advice testable without weaving. Spring Boot's
     * parent POM turns {@code -parameters} on, so this is the common case in
     * practice; plain {@code javac} defaults are the {@code argN} case.
     */
    public static String[] parameterNames(Method method, int count) {
        if (method == null) return null;
        try {
            Parameter[] params = method.getParameters();
            if (params.length != count) return null;
            String[] names = new String[params.length];
            for (int i = 0; i < params.length; i++) {
                names[i] = params[i].isNamePresent() ? params[i].getName() : "arg" + i;
            }
            return names;
        } catch (Throwable t) {
            // MalformedParametersException, or anything else: argN is always safe.
            return null;
        }
    }

    /** @see ValueSerializer#maxArgLength() */
    public static int maxArgLength() {
        return ValueSerializer.maxArgLength();
    }

    public static String extractModule(String fqcn) {
        int lastDot = fqcn.lastIndexOf('.');
        return lastDot > 0 ? fqcn.substring(0, lastDot) : "";
    }

    public static String extractSimpleClass(String fqcn) {
        int lastDot = fqcn.lastIndexOf('.');
        return lastDot >= 0 ? fqcn.substring(lastDot + 1) : fqcn;
    }
}
