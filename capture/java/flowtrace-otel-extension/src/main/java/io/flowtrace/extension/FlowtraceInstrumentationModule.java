package io.flowtrace.extension;

import io.opentelemetry.javaagent.extension.instrumentation.InstrumentationModule;
import io.opentelemetry.javaagent.extension.instrumentation.TypeInstrumentation;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * OTel javaagent InstrumentationModule for FlowTrace.
 *
 * <p>Module name: {@code flowtrace}.
 *
 * <p>The {@code flowtrace.package-prefix} system property scopes instrumentation
 * to user code. If unset, the module logs a warning and returns no
 * TypeInstrumentations — matching nothing is safer than flooding stdlib.
 *
 * <p>Registered via META-INF/services/io.opentelemetry.javaagent.extension
 * .instrumentation.InstrumentationModule (SPI).
 */
public class FlowtraceInstrumentationModule extends InstrumentationModule {

    public FlowtraceInstrumentationModule() {
        super("flowtrace", "flowtrace-1.0");
    }

    @Override
    public List<TypeInstrumentation> typeInstrumentations() {
        String prefix = System.getProperty("flowtrace.package-prefix");
        if (prefix == null || prefix.trim().isEmpty()) {
            System.err.println("[flowtrace] WARNING: flowtrace.package-prefix is not set. "
                    + "No classes will be instrumented. "
                    + "Set -Dflowtrace.package-prefix=com.example to scope instrumentation.");
            return Collections.emptyList();
        }
        return Arrays.asList(new FlowtraceTypeInstrumentation(), new ThreadContextInstrumentation());
    }

    @Override
    public List<String> getAdditionalHelperClassNames() {
        return Arrays.asList(
                "io.flowtrace.emitter.ErrorInfo",
                "io.flowtrace.emitter.FlowtraceEmitter",
                "io.flowtrace.emitter.TraceEvent",
                "io.flowtrace.emitter.JsonFragment",
                "io.flowtrace.emitter.ValueSerializer",
                "io.flowtrace.advice.DepthTracker",
                // Advice is inlined into the target class, which lives in the
                // application's classloader — so every type it touches must be
                // injected there too. Omitting this made onEnter throw
                // NoClassDefFoundError, which the advice swallows: the trace
                // then contained exit events only, with null ids and absurd
                // durations, and nothing said why.
                "io.flowtrace.advice.TraceparentSeed",
                "io.flowtrace.advice.FlowtraceAdvice",
                // ThreadStartAdvice/ThreadRunAdvice inline into
                // java.lang.VirtualThread, which lives on the bootstrap
                // classloader — PendingThreadContext must be injected there too,
                // same reasoning as above.
                "io.flowtrace.advice.PendingThreadContext",
                "io.flowtrace.advice.ThreadStartAdvice",
                "io.flowtrace.advice.ThreadRunAdvice"
        );
    }
}
