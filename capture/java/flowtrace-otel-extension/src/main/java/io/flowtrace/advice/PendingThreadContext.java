package io.flowtrace.advice;

import io.opentelemetry.context.Context;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Carries an OTel {@link Context} from a thread that calls {@code start()} to
 * the thread (platform or virtual) that runs it.
 *
 * <p>Why this exists: OTel's default {@code Context} storage is a plain
 * {@link ThreadLocal} and does not inherit across a {@code Thread.start()}
 * boundary — every OS thread and, per JEP 444, every virtual thread begins
 * with a fresh, empty context. Without this, a call path that crosses a
 * {@code Thread.ofVirtual().start(...)} boundary was silently starting a
 * brand-new trace with a null parent — not attributed to the wrong parent,
 * just dropped, which is worse because nothing about the emitted JSONL says
 * so. Covers virtual threads only; a platform {@code new Thread(...).start()}
 * boundary is not instrumented — see {@link io.flowtrace.extension.ThreadContextInstrumentation}
 * for why.
 *
 * <p>Keyed by the {@link Thread} instance itself (default identity
 * equals/hashCode) rather than a {@code ThreadLocal}, because the value must
 * be readable from a <em>different</em> thread than the one that wrote it —
 * exactly the case a {@code ThreadLocal} cannot cover. This is the intra-process
 * counterpart to {@link TraceparentSeed}, which does the same job across a
 * process boundary using a serialized W3C traceparent instead of a live
 * {@link Context} object.
 */
public final class PendingThreadContext {

    private PendingThreadContext() {}

    private static final Map<Thread, Context> PENDING = new ConcurrentHashMap<>();

    /** Stashes {@code context} for the thread that will run it. */
    public static void put(Thread thread, Context context) {
        if (thread != null && context != null) {
            PENDING.put(thread, context);
        }
    }

    /** Retrieves and removes the context stashed for {@code thread}, or {@code null} if none. */
    public static Context take(Thread thread) {
        return thread != null ? PENDING.remove(thread) : null;
    }

    /** Number of stashed entries. Test-only: asserts nothing leaks past a failed {@code start()}. */
    static int sizeForTesting() {
        return PENDING.size();
    }
}
