package io.flowtrace.advice;

import io.opentelemetry.context.Context;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Regression test for a {@link PendingThreadContext} leak: {@code start()}
 * throwing before {@code run()} ever fires left the entry {@link
 * ThreadStartAdvice#onEnter} stashed with nothing to remove it — a strong
 * reference to a dead {@link Thread} plus its {@link Context}, held forever.
 *
 * <p>Calls the advice methods directly rather than weaving them onto a real
 * {@code Thread}/{@code VirtualThread} class: byte-buddy advice methods are
 * plain static methods, so this exercises the same logic the woven advice
 * runs without needing an agent-attached JVM (see {@link TraceparentSeedTest}
 * for the same directness in this package).
 */
class ThreadStartAdviceTest {

    @Test
    void failedStartRemovesPendingEntry() {
        Thread thread = new Thread(() -> {});

        ThreadStartAdvice.onEnter(thread);
        assertEquals(1, PendingThreadContext.sizeForTesting(),
                "onEnter must stash a context for the about-to-run thread");

        // Simulates start() throwing before run() ever gets a chance to run
        // — e.g. IllegalThreadStateException from restarting a terminated
        // thread, or RejectedExecutionException from a scheduler.
        ThreadStartAdvice.onExit(thread, new IllegalThreadStateException("already started"));

        assertEquals(0, PendingThreadContext.sizeForTesting(),
                "a failed start() must not leave its stashed context behind");
        assertNull(PendingThreadContext.take(thread),
                "the entry must actually be gone, not just uncounted");
    }

    @Test
    void successfulStartLeavesPendingEntryForRunAdvice() {
        Thread thread = new Thread(() -> {});

        ThreadStartAdvice.onEnter(thread);
        ThreadStartAdvice.onExit(thread, null);

        assertEquals(1, PendingThreadContext.sizeForTesting(),
                "a start() that did not throw must leave its context for "
                        + "ThreadRunAdvice to pick up in run()");

        assertNotNull(PendingThreadContext.take(thread));
    }

    @Test
    void repeatedFailedStartsDoNotAccumulate() {
        // Regression shape for the reported leak: 50x a thread whose start()
        // throws (e.g. restarting an already-terminated thread) left
        // PENDING at size 50 — one leaked entry per failed start().
        for (int i = 0; i < 50; i++) {
            Thread thread = new Thread(() -> {});
            ThreadStartAdvice.onEnter(thread);
            ThreadStartAdvice.onExit(thread, new IllegalThreadStateException("thread " + i));
        }

        assertEquals(0, PendingThreadContext.sizeForTesting(),
                "repeated failed start()s must not accumulate in PENDING");
    }
}
