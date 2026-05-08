package io.flowtrace.advice;

/**
 * Per-thread call depth counter.
 *
 * <p>Depth is incremented on method enter and decremented on method exit.
 * This is simpler and more reliable than traversing the OTel SpanContext
 * parent chain, which would require iterating context baggage — not
 * available without an active Context.
 *
 * <p>Thread-safe by design: each thread gets its own {@code Integer} instance
 * via {@link ThreadLocal}.
 */
public final class DepthTracker {

    private DepthTracker() {}

    public static final ThreadLocal<int[]> DEPTH = ThreadLocal.withInitial(() -> new int[]{0});

    /** Returns the current call depth before incrementing (i.e. the depth of the entering method). */
    public static int enterAndGet() {
        int[] d = DEPTH.get();
        int current = d[0];
        d[0]++;
        return current;
    }

    /** Decrements the depth counter and returns the depth of the exiting method. */
    public static int exitAndGet() {
        int[] d = DEPTH.get();
        if (d[0] > 0) {
            d[0]--;
        }
        return d[0];
    }
}
