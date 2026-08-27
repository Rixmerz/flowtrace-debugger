package io.flowtrace.extension;

import io.opentelemetry.javaagent.extension.instrumentation.TypeInstrumentation;
import io.opentelemetry.javaagent.extension.instrumentation.TypeTransformer;
import net.bytebuddy.description.type.TypeDescription;
import net.bytebuddy.matcher.ElementMatcher;

import static net.bytebuddy.matcher.ElementMatchers.*;

/**
 * Weaves context-propagation advice onto {@code java.lang.VirtualThread}'s
 * own {@code start()}/{@code run()}.
 *
 * <p>Covers virtual threads only. A {@code named("java.lang.Thread")} matcher
 * was tried too, but it never actually applies: {@code java.lang.Thread} is
 * loaded by the JVM bootstrap sequence before the javaagent's {@code premain}
 * runs, so byte-buddy never gets a retransform opportunity on it — confirmed
 * by both {@code new Thread(r).start()} and a {@code Thread} subclass
 * overriding {@code run()} leaving {@link io.flowtrace.advice.PendingThreadContext}
 * untouched and producing a disconnected child trace with a null parent, with
 * or without that matcher present. Fixing platform-thread propagation would
 * need a different mechanism (e.g. instrumenting a JDK bootstrap-loaded
 * caller of {@code Thread.start0()}, or an agent-level {@code Instrumentation}
 * hook applied before class loading) — out of scope here; see AC1 in
 * {@code docs/changes/2026-08-27-java21-dogfood.md}, which scoped this fix to
 * virtual threads specifically.
 *
 * <p>Independent of {@link FlowtraceTypeInstrumentation}'s package-prefix
 * scoping: this fixes context continuity across a thread boundary, which is
 * a JVM-wide concern, not specific to the instrumented application's
 * package.
 */
public class ThreadContextInstrumentation implements TypeInstrumentation {

    @Override
    public ElementMatcher<TypeDescription> typeMatcher() {
        return named("java.lang.VirtualThread");
    }

    @Override
    public void transform(TypeTransformer transformer) {
        transformer.applyAdviceToMethod(
                named("start").and(takesArguments(0)),
                "io.flowtrace.advice.ThreadStartAdvice"
        );
        // VirtualThread's public no-arg run() (overriding Thread.run()) is
        // never actually invoked by its continuation — the continuation calls
        // the private one-arg run(Runnable) directly (see VirtualThread's
        // bytecode: runWith(Object, Runnable) -> the private run(Runnable)).
        // Matching plain "run" catches both that no-arg override (harmless,
        // just never fires) and the one-arg method that actually runs.
        transformer.applyAdviceToMethod(
                named("run"),
                "io.flowtrace.advice.ThreadRunAdvice"
        );
    }
}
