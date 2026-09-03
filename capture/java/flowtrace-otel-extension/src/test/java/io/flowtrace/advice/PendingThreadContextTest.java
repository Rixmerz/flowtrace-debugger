package io.flowtrace.advice;

import io.opentelemetry.context.Context;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * {@link PendingThreadContext} must not pin threads. The map was strongly
 * keyed and only ever cleaned by {@code take()} or a failed {@code start()},
 * so a thread whose {@code run()} the advice never observed stayed reachable
 * — with its {@link Context} — for the life of the JVM.
 */
class PendingThreadContextTest {

    @Test
    void unreachableThreadIsNotPinnedByAStashedContext() throws Exception {
        Thread thread = new Thread(() -> {}, "flowtrace-pending-gc-probe");
        PendingThreadContext.put(thread, Context.root());
        assertEquals(1, PendingThreadContext.sizeForTesting());

        // Drop the only strong reference and let the collector find it.
        // WeakHashMap expunges stale entries on size(), so no take() is needed.
        thread = null;
        long deadline = System.nanoTime() + 10_000_000_000L;
        while (PendingThreadContext.sizeForTesting() > 0 && System.nanoTime() < deadline) {
            System.gc();
            Thread.sleep(25);
        }
        assertEquals(0, PendingThreadContext.sizeForTesting(),
                "a thread nobody references any more must not be kept alive by PENDING");
    }

    @Test
    void reachableThreadKeepsItsEntryUntilTaken() throws Exception {
        Thread thread = new Thread(() -> {}, "flowtrace-pending-reachable");
        Context ctx = Context.root();
        PendingThreadContext.put(thread, ctx);
        System.gc();
        Thread.sleep(25);
        assertEquals(1, PendingThreadContext.sizeForTesting(),
                "a live thread's entry must survive GC — the key is weak, not the intent");
        assertSame(ctx, PendingThreadContext.take(thread));
        assertNull(PendingThreadContext.take(thread));
    }
}
