package io.flowtrace.advice;

import io.opentelemetry.context.Context;
import io.opentelemetry.context.Scope;
import net.bytebuddy.asm.Advice;

/**
 * Woven onto {@code Thread.run()} / {@code VirtualThread.run()}.
 *
 * <p>Restores the {@link Context} stashed by {@link ThreadStartAdvice} — if
 * any — as the current context for the duration of {@code run()}, so any
 * FlowtraceAdvice-instrumented method called from this thread links back to
 * the span active on the thread that started it, instead of beginning a new,
 * disconnected trace.
 */
public class ThreadRunAdvice {

    @Advice.OnMethodEnter(suppress = Throwable.class)
    public static void onEnter(
            @Advice.This Thread thread,
            @Advice.Local("flowtraceThreadScope") Scope scope) {
        Context context = PendingThreadContext.take(thread);
        if (context != null) {
            scope = context.makeCurrent();
        }
    }

    @Advice.OnMethodExit(onThrowable = Throwable.class, suppress = Throwable.class)
    public static void onExit(@Advice.Local("flowtraceThreadScope") Scope scope) {
        if (scope != null) {
            scope.close();
        }
    }
}
