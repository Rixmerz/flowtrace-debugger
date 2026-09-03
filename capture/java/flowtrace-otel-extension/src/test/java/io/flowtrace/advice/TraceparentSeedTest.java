package io.flowtrace.advice;

import io.opentelemetry.api.trace.SpanContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Parser conformance for the env/property trace-context carrier.
 *
 * <p>Deliberately mirrors the case list in the Node
 * ({@code test/test-propagation.mjs}) and Python
 * ({@code tests/test_propagation.py}) suites. Three independent parsers of the
 * same spec drift silently unless they are held to the same table — and a drift
 * here does not throw, it just quietly fails to join a trace.
 */
class TraceparentSeedTest {

    private static final String TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
    private static final String SPAN = "00f067aa0ba902b7";
    private static final String VALID = "00-" + TRACE + "-" + SPAN + "-01";

    @AfterEach
    void tearDown() {
        System.clearProperty(TraceparentSeed.SYS_PROP);
        TraceparentSeed.resetForTesting();
    }

    @Test
    void parsesCanonicalW3cExample() {
        SpanContext sc = TraceparentSeed.parse(VALID);
        assertNotNull(sc);
        assertEquals(TRACE, sc.getTraceId());
        assertEquals(SPAN, sc.getSpanId());
        assertTrue(sc.isValid());
        assertTrue(sc.isRemote(), "a seeded context must be marked remote");
        assertTrue(sc.getTraceFlags().isSampled());
    }

    @Test
    void readsSampledFlag() {
        assertTrue(TraceparentSeed.parse("00-" + TRACE + "-" + SPAN + "-01")
                .getTraceFlags().isSampled());
        assertFalse(TraceparentSeed.parse("00-" + TRACE + "-" + SPAN + "-00")
                .getTraceFlags().isSampled());
        // Only bit 0 is "sampled"; other bits must not be misread.
        assertTrue(TraceparentSeed.parse("00-" + TRACE + "-" + SPAN + "-03")
                .getTraceFlags().isSampled());
        assertFalse(TraceparentSeed.parse("00-" + TRACE + "-" + SPAN + "-02")
                .getTraceFlags().isSampled());
    }

    /**
     * The spec mandates lowercase hex, and the Node/Python/Go parsers reject
     * uppercase and surrounding whitespace outright. Java used to normalize
     * both, so a carrier three runtimes refused was silently joined by the
     * fourth — the asymmetric kind of bug nothing but a parity table catches.
     */
    @Test
    void rejectsUppercaseAndWhitespaceLikeTheOtherRuntimes() {
        assertNull(TraceparentSeed.parse(
                "00-" + TRACE.toUpperCase() + "-" + SPAN.toUpperCase() + "-01"), "uppercase");
        assertNull(TraceparentSeed.parse("00-" + TRACE + "-" + SPAN + "-01 "), "trailing space");
        assertNull(TraceparentSeed.parse(" 00-" + TRACE + "-" + SPAN + "-01"), "leading space");
        assertNull(TraceparentSeed.parse("  " + VALID + "  "), "surrounding whitespace");
        assertNull(TraceparentSeed.parse(VALID + "\n"), "trailing newline");
        // Lowercase, unpadded: still accepted, so this test is not just "rejects everything".
        assertNotNull(TraceparentSeed.parse(VALID));
    }

    @Test
    void rejectsMalformedWithoutThrowing() {
        String[] bad = {
                null,
                "",
                "garbage",
                "00-" + TRACE + "-" + SPAN,              // missing flags
                "00-" + TRACE,                            // missing span
                "00-" + TRACE + "-" + SPAN + "-01-extra", // v00 must have 4 fields
                "00-" + TRACE + "-" + SPAN + "-01-",      // trailing empty field is a 5th field
                "-00-" + TRACE + "-" + SPAN + "-01",      // leading empty field shifts everything
                "zz-" + TRACE + "-" + SPAN + "-01",       // non-hex version
                "ff-" + TRACE + "-" + SPAN + "-01",       // version ff is forbidden
                "00-" + TRACE.substring(0, 31) + "-" + SPAN + "-01",  // short trace
                "00-" + TRACE + "-" + SPAN.substring(0, 15) + "-01",  // short span
                "00-" + "g".repeat(32) + "-" + SPAN + "-01",          // non-hex trace
                "00-" + TRACE + "-" + SPAN + "-zz",                   // non-hex flags
                "00-" + "0".repeat(32) + "-" + SPAN + "-01",          // all-zero trace
                "00-" + TRACE + "-" + "0".repeat(16) + "-01",         // all-zero span
        };
        for (String value : bad) {
            assertNull(TraceparentSeed.parse(value), "should reject: " + value);
        }
    }

    @Test
    void toleratesUnknownFutureVersions() {
        // Forward compatibility is required by the spec: read the first 4 fields.
        SpanContext sc = TraceparentSeed.parse("01-" + TRACE + "-" + SPAN + "-01-somethingnew");
        assertNotNull(sc);
        assertEquals(TRACE, sc.getTraceId());
    }

    @Test
    void systemPropertyIsHonouredAndCached() {
        System.setProperty(TraceparentSeed.SYS_PROP, VALID);
        TraceparentSeed.resetForTesting();

        SpanContext sc = TraceparentSeed.get();
        assertNotNull(sc);
        assertEquals(TRACE, sc.getTraceId());
        assertEquals(SPAN, sc.getSpanId());

        // Cached: changing the property without a reset must not change the
        // answer, because get() is called for every root span.
        System.setProperty(TraceparentSeed.SYS_PROP, "00-" + "a".repeat(32) + "-" + SPAN + "-01");
        assertEquals(TRACE, TraceparentSeed.get().getTraceId());

        TraceparentSeed.resetForTesting();
        assertEquals("a".repeat(32), TraceparentSeed.get().getTraceId());
    }

    @Test
    void absentCarrierYieldsNoSeed() {
        System.clearProperty(TraceparentSeed.SYS_PROP);
        TraceparentSeed.resetForTesting();
        // The env var is not set in the test JVM, so this exercises the
        // "nothing configured" path: no seed, and the process starts its own
        // trace rather than failing.
        assertNull(TraceparentSeed.get());
    }

    @Test
    void malformedCarrierYieldsNoSeedRatherThanAnInvalidContext() {
        System.setProperty(TraceparentSeed.SYS_PROP, "total-garbage");
        TraceparentSeed.resetForTesting();
        assertNull(TraceparentSeed.get());
    }
}
