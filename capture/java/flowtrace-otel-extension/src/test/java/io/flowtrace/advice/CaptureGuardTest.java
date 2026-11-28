package io.flowtrace.advice;

import io.flowtrace.emitter.CaptureGuard;
import io.flowtrace.emitter.ValueSerializer;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Rendering an argument calls toString() on user objects, and those classes are
 * instrumented too. The guard must be set for exactly the duration of that
 * rendering, and the advice must emit nothing while it is.
 */
class CaptureGuardTest {

    /** Records whether the guard was set when the serializer called it. */
    static final class Probe {
        static int calls;
        static boolean guardSeen;
        @Override public String toString() {
            calls++;
            guardSeen = CaptureGuard.active();
            return "probe";
        }
    }

    @Test
    void guardIsSetWhileToStringRunsAndClearedAfter() {
        Probe.calls = 0;
        assertFalse(CaptureGuard.active(), "precondition");
        assertEquals("\"probe\"", ValueSerializer.serializeValue(new Probe()).toString());
        assertEquals(1, Probe.calls);
        assertTrue(Probe.guardSeen, "toString ran with the guard set");
        assertFalse(CaptureGuard.active(), "guard released afterwards");
    }

    @Test
    void guardCoversNestedValuesAndIsReleasedAfterAFailure() {
        Probe.guardSeen = false;
        ValueSerializer.serializeValue(Map.of("k", List.of(new Probe())));
        assertTrue(Probe.guardSeen);

        Object bomb = new Object() {
            @Override public String toString() { throw new IllegalStateException("boom"); }
        };
        assertTrue(ValueSerializer.serializeValue(bomb).toString().startsWith("\"<unserializable"));
        assertFalse(CaptureGuard.active(), "released even when toString throws");
    }

    @Test
    void guardIsPerThread() throws Exception {
        CaptureGuard.enter();
        try {
            boolean[] other = new boolean[1];
            Thread t = new Thread(() -> other[0] = CaptureGuard.active());
            t.start();
            t.join();
            assertTrue(CaptureGuard.active());
            assertFalse(other[0], "another thread is not blinded");
        } finally {
            CaptureGuard.leave();
        }
    }

    @Test
    void adviceEmitsNothingAndKeepsDepthWhileGuardIsSet() {
        int before = DepthTracker.DEPTH.get()[0];
        CaptureGuard.enter();
        try {
            FlowtraceAdvice.onEnter("com.example.Owner", "toString", null, new Object[0],
                    "", 0, null, null, 0L, 0, null, null, null, null);
            assertEquals(before, DepthTracker.DEPTH.get()[0], "enter did not touch depth");
            FlowtraceAdvice.onExit("com.example.Owner", "toString", null, "x", null,
                    null, null, 0L, 0, null, null, null, null);
            assertEquals(before, DepthTracker.DEPTH.get()[0], "exit did not touch depth");
        } finally {
            CaptureGuard.leave();
        }
    }
}
