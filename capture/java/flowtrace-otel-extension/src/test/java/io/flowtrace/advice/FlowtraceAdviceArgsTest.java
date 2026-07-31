package io.flowtrace.advice;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Argument serialization.
 *
 * <p>The array cases are regression guards. {@code Object.toString()} on an array
 * yields a type descriptor plus an identity hash — {@code [Ljava.lang.String;@35cec305}
 * — which names no value and changes on every run. It was found because the Java
 * golden fixture could not reproduce itself, and it also disagreed with the Node
 * and Python layers, which both serialize contents.
 */
class FlowtraceAdviceArgsTest {

    @Test
    void primitivesAndBoxedTypesKeepTheirValue() {
        Map<String, Object> args = FlowtraceAdvice.buildArgs(new Object[]{1, 2L, 3.5, true, 'c'});
        assertEquals(1, args.get("arg0"));
        assertEquals(2L, args.get("arg1"));
        assertEquals(3.5, args.get("arg2"));
        assertEquals(true, args.get("arg3"));
        assertEquals('c', args.get("arg4"));
    }

    @Test
    void nullAndStringArgs() {
        Map<String, Object> args = FlowtraceAdvice.buildArgs(new Object[]{null, "hello"});
        assertNull(args.get("arg0"));
        assertEquals("hello", args.get("arg1"));
    }

    @Test
    void objectArraysSerializeTheirContents() {
        Map<String, Object> args = FlowtraceAdvice.buildArgs(
                new Object[]{new String[]{"a", "b"}});
        assertEquals("[a, b]", args.get("arg0"));
    }

    @Test
    void emptyArraySerializesAsEmpty() {
        // main(String[] args) with no CLI arguments — the exact case that broke
        // the golden fixture's determinism.
        Map<String, Object> args = FlowtraceAdvice.buildArgs(new Object[]{new String[]{}});
        assertEquals("[]", args.get("arg0"));
    }

    @Test
    void nestedArraysSerializeDeeply() {
        Map<String, Object> args = FlowtraceAdvice.buildArgs(
                new Object[]{new String[][]{{"a"}, {"b", "c"}}});
        assertEquals("[[a], [b, c]]", args.get("arg0"));
    }

    @Test
    void everyPrimitiveArrayTypeSerializesContents() {
        assertEquals("[1, 2]", FlowtraceAdvice.buildArgs(new Object[]{new int[]{1, 2}}).get("arg0"));
        assertEquals("[1, 2]", FlowtraceAdvice.buildArgs(new Object[]{new long[]{1L, 2L}}).get("arg0"));
        assertEquals("[1.5, 2.5]", FlowtraceAdvice.buildArgs(new Object[]{new double[]{1.5, 2.5}}).get("arg0"));
        assertEquals("[1.5, 2.5]", FlowtraceAdvice.buildArgs(new Object[]{new float[]{1.5f, 2.5f}}).get("arg0"));
        assertEquals("[1, 2]", FlowtraceAdvice.buildArgs(new Object[]{new short[]{1, 2}}).get("arg0"));
        assertEquals("[1, 2]", FlowtraceAdvice.buildArgs(new Object[]{new byte[]{1, 2}}).get("arg0"));
        assertEquals("[a, b]", FlowtraceAdvice.buildArgs(new Object[]{new char[]{'a', 'b'}}).get("arg0"));
        assertEquals("[true, false]",
                FlowtraceAdvice.buildArgs(new Object[]{new boolean[]{true, false}}).get("arg0"));
    }

    @Test
    void noArgSerializationLeaksAnIdentityHash() {
        // The shape "@<hex>" is what Object.toString() produces. If it ever
        // reappears in an args map, some type is falling through to the default
        // path when it should not.
        Map<String, Object> args = FlowtraceAdvice.buildArgs(new Object[]{
                new String[]{"a"}, new int[]{1}, new Object[][]{{"x"}},
        });
        for (Object value : args.values()) {
            assertFalse(String.valueOf(value).matches(".*@[0-9a-f]+$"),
                    "serialized arg looks like an identity hash: " + value);
        }
    }

    @Test
    void longValuesAreTruncatedWithTheSharedMarker() {
        String original = System.getProperty("flowtrace.max-arg-length");
        try {
            System.setProperty("flowtrace.max-arg-length", "10");
            Map<String, Object> args = FlowtraceAdvice.buildArgs(
                    new Object[]{"0123456789abcdefghij"});

            // The marker format is a CROSS-LANGUAGE contract, not a Java detail:
            // benchmarks/truncation-parity.sh asserts all three layers emit
            // "<truncated:". Java used to emit "PREFIX...[truncated]" — a third
            // format — and would have failed that check the moment it actually ran
            // (it was being skipped by a stale -SNAPSHOT jar glob).
            assertEquals("<truncated:0123456789...>", args.get("arg0"));
        } finally {
            if (original == null) System.clearProperty("flowtrace.max-arg-length");
            else System.setProperty("flowtrace.max-arg-length", original);
        }
    }

    @Test
    void truncationMarkerMatchesTheOtherLayersPrefixAndSuffix() {
        String original = System.getProperty("flowtrace.max-arg-length");
        try {
            System.setProperty("flowtrace.max-arg-length", "5");
            String value = (String) FlowtraceAdvice.buildArgs(
                    new Object[]{"abcdefghijklmnop"}).get("arg0");

            // Asserted as prefix/suffix rather than a whole string, so this keeps
            // holding if the elided content ever changes but the marker must not.
            assertTrue(value.startsWith("<truncated:"), "wrong prefix: " + value);
            assertTrue(value.endsWith("...>"), "wrong suffix: " + value);
        } finally {
            if (original == null) System.clearProperty("flowtrace.max-arg-length");
            else System.setProperty("flowtrace.max-arg-length", original);
        }
    }

    @Test
    void maxArgLengthOfZeroDisablesTruncation() {
        String original = System.getProperty("flowtrace.max-arg-length");
        try {
            System.setProperty("flowtrace.max-arg-length", "0");
            String long_ = "y".repeat(5000);
            assertEquals(long_, FlowtraceAdvice.buildArgs(new Object[]{long_}).get("arg0"),
                    "0 must mean unlimited, matching the documented knob");
        } finally {
            if (original == null) System.clearProperty("flowtrace.max-arg-length");
            else System.setProperty("flowtrace.max-arg-length", original);
        }
    }
}
