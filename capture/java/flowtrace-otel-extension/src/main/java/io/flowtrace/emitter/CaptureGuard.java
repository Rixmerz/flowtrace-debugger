package io.flowtrace.emitter;

/**
 * Per-thread re-entrancy guard: set while the tracer itself is rendering a
 * value.
 *
 * <p>Rendering an argument or a result calls {@code toString()} (and friends)
 * on user objects. When those classes are instrumented, the calls are traced
 * like any other, and a static index then reads the tracer's own
 * {@code Owner.getPets -> NamedEntity.toString} as a real caller -> callee
 * edge. While this guard is set on the current thread,
 * {@link io.flowtrace.advice.FlowtraceAdvice} emits nothing, opens no span and
 * leaves the depth alone, so whatever the callback calls in turn is suppressed
 * too. The user's code still runs and its text still lands in the trace.
 *
 * <p>Same intent as the {@code _in_capture} guard in the Python layer.
 * Public: the advice is inlined into woven classes.
 */
public final class CaptureGuard {

    private CaptureGuard() {}

    private static final ThreadLocal<int[]> DEPTH = ThreadLocal.withInitial(() -> new int[]{0});

    /** True while this thread is inside the tracer's own serialisation. */
    public static boolean active() {
        return DEPTH.get()[0] > 0;
    }

    /** Marks serialisation as started; pair with {@link #leave()} in a finally. */
    public static void enter() {
        DEPTH.get()[0]++;
    }

    public static void leave() {
        int[] d = DEPTH.get();
        if (d[0] > 0) d[0]--;
    }
}
