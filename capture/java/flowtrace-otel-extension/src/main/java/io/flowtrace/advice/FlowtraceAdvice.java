package io.flowtrace.advice;

import io.flowtrace.emitter.ErrorInfo;
import io.flowtrace.emitter.FlowtraceEmitter;
import io.flowtrace.emitter.TraceEvent;
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
 *   <li>Args keyed {@code arg0}, {@code arg1}, … Primitive wrapper types are
 *       stored as their actual value; others via {@code toString()} truncated to
 *       {@code flowtrace.max-arg-length} (default 512).</li>
 *   <li>Result is wrapped as {@code {"value": result}} to match golden fixture;
 *       void returns emit an empty object.</li>
 *   <li>Modifiers are read from {@code @Advice.Origin Method} — the only
 *       reliable way to get them without reflection on the class loader.</li>
 * </ul>
 */
public class FlowtraceAdvice {

    private static final int DEFAULT_MAX_ARG_LENGTH = 512;

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
            @Advice.Local("flowtraceSpanId")  String spanId
    ) {
        try {
            depth = DepthTracker.enterAndGet();

            // Capture enclosing span BEFORE starting a new one — this is the parent.
            Span enclosingSpan = Span.fromContext(Context.current());
            SpanContext enclosingSc = enclosingSpan.getSpanContext();
            parentId = enclosingSc.isValid() ? enclosingSc.getSpanId() : null;

            Tracer tracer = GlobalOpenTelemetry.getTracer("io.flowtrace", "2.0.0");
            span      = tracer.spanBuilder(methodName).startSpan();
            scope     = Context.current().with(span).makeCurrent();
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
            event.setArgs(buildArgs(allArgs));
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
            @Advice.AllArguments  Object[] allArgs,
            @Advice.Return(typing = Assigner.Typing.DYNAMIC) Object result,
            @Advice.Thrown Throwable thrown,
            @Advice.Local("flowtraceSpan")    Span   span,
            @Advice.Local("flowtraceScope")   Scope  scope,
            @Advice.Local("flowtraceStart")   long   startNanos,
            @Advice.Local("flowtraceDepth")   int    depth,
            @Advice.Local("flowtraceParent")  String parentId,
            @Advice.Local("flowtraceTraceId") String traceId,
            @Advice.Local("flowtraceSpanId")  String spanId
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
            event.setArgs(buildArgs(allArgs));
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
                    resultMap.put("value", result);
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

    public static String visibilityFromModifiers(int mod) {
        if (Modifier.isPublic(mod))    return "public";
        if (Modifier.isPrivate(mod))   return "private";
        if (Modifier.isProtected(mod)) return "protected";
        return "internal"; // package-private
    }

    public static Map<String, Object> buildArgs(Object[] args) {
        Map<String, Object> map = new LinkedHashMap<>();
        if (args == null) return map;
        int maxLen = maxArgLength();
        for (int i = 0; i < args.length; i++) {
            Object arg = args[i];
            if (arg == null) {
                map.put("arg" + i, null);
            } else if (arg instanceof Number || arg instanceof Boolean || arg instanceof Character) {
                map.put("arg" + i, arg);
            } else {
                String s = arg.toString();
                if (maxLen > 0 && s.length() > maxLen) {
                    s = s.substring(0, maxLen) + "...[truncated]";
                }
                map.put("arg" + i, s);
            }
        }
        return map;
    }

    public static int maxArgLength() {
        String prop = System.getProperty("flowtrace.max-arg-length");
        if (prop != null) {
            try { return Integer.parseInt(prop); } catch (NumberFormatException ignored) {}
        }
        return DEFAULT_MAX_ARG_LENGTH;
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
