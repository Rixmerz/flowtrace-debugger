package io.flowtrace.advice;

import io.opentelemetry.context.Context;
import net.bytebuddy.asm.Advice;

/**
 * Woven onto {@code Thread.start()} / {@code VirtualThread.start()}.
 *
 * <p>Snapshots whatever {@link Context} is current on the <em>calling</em>
 * thread — the one invoking {@code start()} — and stashes it against the
 * {@link Thread} instance about to run, for {@link ThreadRunAdvice} to pick
 * up once execution actually begins there. See {@link PendingThreadContext}.
 */
public class ThreadStartAdvice {

    @Advice.OnMethodEnter(suppress = Throwable.class)
    public static void onEnter(@Advice.This Thread thread) {
        PendingThreadContext.put(thread, Context.current());
    }

    /**
     * If {@code start()} itself threw — e.g. {@link IllegalThreadStateException}
     * from restarting an already-terminated thread, or a scheduler rejecting
     * with {@code RejectedExecutionException} — {@code run()} never fires, so
     * {@link ThreadRunAdvice} never gets a chance to remove the entry {@link
     * #onEnter} just stashed. Without this, that entry (a strong reference to
     * the dead {@link Thread} plus its {@link Context}) sits in {@link
     * PendingThreadContext} forever. Clean it up here instead.
     */
    @Advice.OnMethodExit(onThrowable = Throwable.class, suppress = Throwable.class)
    public static void onExit(@Advice.This Thread thread, @Advice.Thrown Throwable thrown) {
        if (thrown != null) {
            PendingThreadContext.take(thread);
        }
    }
}
