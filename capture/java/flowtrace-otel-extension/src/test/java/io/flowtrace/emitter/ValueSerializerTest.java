package io.flowtrace.emitter;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.*;

/**
 * The shared args/result rules — structural JSON, redaction, truncation, and
 * the never-throw guarantee — exercised on the serializer directly, one rule
 * per test, so a regression names the rule it broke.
 */
class ValueSerializerTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @BeforeEach
    @AfterEach
    void clearKnobs() {
        System.clearProperty(ValueSerializer.MAX_ARG_LENGTH_PROPERTY);
        System.clearProperty(ValueSerializer.REDACT_KEYS_PROPERTY);
        ValueSerializer.resetForTesting();
    }

    private static String json(Object value) {
        return ValueSerializer.serializeValue(value).json();
    }

    private static JsonNode parsed(Object value) throws Exception {
        return MAPPER.readTree(json(value));
    }

    // ---- structural serialization (task: appendRawValue) ----

    @Test
    void scalarsRenderAsJsonLiterals() {
        assertEquals("null", json(null));
        assertEquals("\"s\"", json("s"));
        assertEquals("true", json(Boolean.TRUE));
        assertEquals("42", json(42));
        assertEquals("42", json(42L));
        assertEquals("1.5", json(1.5d));
        assertEquals("1.5", json(1.5f));
        assertEquals("\"c\"", json('c'));
        assertEquals("\"SECONDS\"", json(java.util.concurrent.TimeUnit.SECONDS));
        assertEquals("12345678901234567890", json(new BigInteger("12345678901234567890")));
        assertEquals("0.10", json(new BigDecimal("0.10")));
        assertEquals("7", json(new AtomicLong(7)));
    }

    @Test
    void nanAndInfinityBecomeNullBecauseBareNaNIsNotJson() throws Exception {
        assertEquals("null", json(Double.NaN));
        assertEquals("null", json(Double.POSITIVE_INFINITY));
        assertEquals("null", json(Float.NEGATIVE_INFINITY));
        assertEquals("null", json(Float.NaN));
        // Inside a container too — that is where it actually bit.
        JsonNode node = parsed(Arrays.asList(1.0, Double.NaN, 2.0));
        assertTrue(node.get(1).isNull());
        assertEquals(2.0, node.get(2).asDouble());
    }

    @Test
    void unknownNumberSubclassWithNonNumericToStringFallsBackToDoubleValue() {
        Number odd = new Number() {
            @Override public int intValue() { return 3; }
            @Override public long longValue() { return 3; }
            @Override public float floatValue() { return 3f; }
            @Override public double doubleValue() { return 3d; }
            @Override public String toString() { return "three"; }
        };
        assertEquals("3.0", json(odd));
    }

    @Test
    void mapWithNonStringKeysUsesStringValueOf() throws Exception {
        Map<Object, Object> m = new LinkedHashMap<>();
        m.put(1, "one");
        m.put(null, "nil");
        m.put(java.util.concurrent.TimeUnit.DAYS, 2);
        JsonNode node = parsed(m);
        assertEquals("one", node.get("1").asText());
        assertEquals("nil", node.get("null").asText());
        assertEquals(2, node.get("DAYS").asInt());
    }

    @Test
    void collectionsAndArraysRenderAsJsonArrays() throws Exception {
        assertEquals("[1,2,3]", json(Arrays.asList(1, 2, 3)));
        assertEquals("[1,2,3]", json(new int[]{1, 2, 3}));
        assertEquals("[1.5,2.5]", json(new double[]{1.5, 2.5}));
        assertEquals("[true,false]", json(new boolean[]{true, false}));
        assertEquals("[\"a\",\"b\"]", json(new char[]{'a', 'b'}));
        assertEquals("[\"x\",null]", json(new String[]{"x", null}));
        assertEquals("[]", json(new String[0]));
        assertEquals("[[1],[2,3]]", json(new int[][]{{1}, {2, 3}}));
        JsonNode set = parsed(new java.util.TreeSet<>(Arrays.asList("b", "a")));
        assertEquals("a", set.get(0).asText());
    }

    @Test
    void optionalIsTransparent() {
        assertEquals("null", json(Optional.empty()));
        assertEquals("\"v\"", json(Optional.of("v")));
        assertEquals("[1]", json(Optional.of(Arrays.asList(1))));
    }

    @Test
    void nestedStructuresRenderToBoundedDepth() throws Exception {
        // depth 0: list, 1: map, 2: list — all structural.
        Map<String, Object> inner = new LinkedHashMap<>();
        inner.put("k", Arrays.asList("deep"));
        JsonNode node = parsed(Arrays.asList(inner));
        assertEquals("deep", node.get(0).get("k").get(0).asText());

        // A fourth level of container is rendered as its toString, as a string.
        List<Object> l3 = Arrays.asList("x");
        List<Object> l2 = Arrays.asList((Object) l3);
        List<Object> l1 = Arrays.asList((Object) l2);
        List<Object> l0 = Arrays.asList((Object) l1);
        JsonNode deep = parsed(l0);
        JsonNode third = deep.get(0).get(0).get(0);
        assertTrue(third.isTextual(), "container at depth 3 must be a string, got " + third);
        assertEquals("[x]", third.asText());

        int[] a3 = {1};
        JsonNode arr = parsed(Arrays.asList((Object) Arrays.asList((Object) Arrays.asList((Object) a3))));
        assertEquals("int[1]", arr.get(0).get(0).get(0).asText());
    }

    @Test
    void elementCountIsBoundedWithATrailingCountMarker() throws Exception {
        // The element cap is about shape, not size: keep truncation out of it.
        System.setProperty(ValueSerializer.MAX_ARG_LENGTH_PROPERTY, "0");
        List<Integer> big = new ArrayList<>();
        for (int i = 0; i < 250; i++) big.add(i);
        JsonNode list = parsed(big);
        assertEquals(101, list.size());
        assertEquals(99, list.get(99).asInt());
        assertEquals("...(+150)", list.get(100).asText());

        int[] arr = new int[105];
        JsonNode array = parsed(arr);
        assertEquals(101, array.size());
        assertEquals("...(+5)", array.get(100).asText());

        Map<String, Integer> map = new LinkedHashMap<>();
        for (int i = 0; i < 103; i++) map.put("k" + i, i);
        JsonNode m = parsed(map);
        assertEquals(101, m.size());
        assertEquals("(+3)", m.get("...").asText());
        assertNull(m.get("k100"));

        // Exactly at the limit: no marker.
        List<Integer> exact = new ArrayList<>();
        for (int i = 0; i < 100; i++) exact.add(i);
        assertEquals(100, parsed(exact).size());
    }

    @Test
    void arbitraryObjectsRenderAsToStringInAJsonString() {
        Object o = new Object() {
            @Override public String toString() { return "Custom{\"quoted\"}" + System.lineSeparator(); }
        };
        String rendered = json(o);
        assertTrue(rendered.startsWith("\"Custom{\\\"quoted\\\"}"), rendered);
        assertFalse(rendered.contains(System.lineSeparator()), "line breaks must be escaped: " + rendered);
        java.time.LocalDate date = java.time.LocalDate.of(2026, 1, 2);
        assertEquals("\"" + date + "\"", json(date));
    }

    @Test
    void quotesBackslashesAndControlCharactersRoundTrip() throws Exception {
        String s = "ab\"c\\d" + (char) 9 + "e" + (char) 1 + "f";
        JsonNode node = MAPPER.readTree(json(s));
        assertEquals(s, node.asText());
    }

    // ---- never throw (task: one bad argument must not kill the event) ----

    @Test
    void throwingToStringYieldsUnserializableMarkerForThatValueOnly() {
        Object bad = new Object() {
            @Override public String toString() { throw new IllegalStateException("boom"); }
        };
        String marker = json(bad);
        assertTrue(marker.startsWith("\"<unserializable: "), marker);
        assertTrue(marker.contains(bad.getClass().getName()), marker);
        assertTrue(marker.endsWith(">\""), marker);
        // A sibling value in the same call is untouched.
        assertEquals("\"fine\"", json("fine"));
    }

    @Test
    void stackOverflowInToStringIsContained() {
        class Recursive {
            @Override public String toString() { return "r" + this; } // infinite
        }
        Object r = new Recursive();
        String marker = json(r);
        assertTrue(marker.startsWith("\"<unserializable: "), marker);
        assertTrue(marker.contains("Recursive"), marker);
    }

    @Test
    void throwingIteratorDoesNotCorruptOutput() {
        List<Object> hostile = new ArrayList<Object>() {
            @Override public java.util.Iterator<Object> iterator() {
                throw new java.util.ConcurrentModificationException();
            }
        };
        String marker = json(hostile);
        assertTrue(marker.startsWith("\"<unserializable: "), marker);
        assertFalse(marker.contains("["), "no partial output may leak into the marker: " + marker);
    }

    // ---- redaction (task 8) ----

    @Test
    void defaultRedactKeysMatchCaseInsensitiveSubstringsOfArgumentNames() {
        for (String name : new String[]{"password", "PASSWORD", "userPassword", "secret", "apiToken",
                "Authorization", "api_key", "url", "dsn", "connection_string", "email", "callbackUrl"}) {
            assertEquals("\"<redacted>\"", ValueSerializer.serializeNamed(name, "value").json(), name);
        }
        assertEquals("\"value\"", ValueSerializer.serializeNamed("name", "value").json());
        assertEquals("\"value\"", ValueSerializer.serializeNamed("arg0", "value").json());
    }

    @Test
    void redactionAppliesToMapKeysAtAnyDepthInArgsAndResults() throws Exception {
        Map<String, Object> creds = new LinkedHashMap<>();
        creds.put("user", "bob");
        creds.put("Password", "hunter2");
        Map<String, Object> outer = new LinkedHashMap<>();
        outer.put("credentials", creds);
        outer.put("apiToken", "t");
        Map<Object, Object> nonString = new LinkedHashMap<>();
        nonString.put(1, "one");
        outer.put("ids", nonString);

        JsonNode node = parsed(outer);
        assertEquals("bob", node.get("credentials").get("user").asText());
        assertEquals("<redacted>", node.get("credentials").get("Password").asText());
        assertEquals("<redacted>", node.get("apiToken").asText());
        assertEquals("one", node.get("ids").get("1").asText());

        // Same rule for a result value: serializeValue is what the exit path uses.
        assertEquals("<redacted>", MAPPER.readTree(ValueSerializer.serializeValue(outer).json())
                .get("apiToken").asText());
    }

    @Test
    void redactedValueIsNeverRenderedSoItsToStringIsNotCalled() {
        Object bomb = new Object() {
            @Override public String toString() { throw new AssertionError("must not be called"); }
        };
        assertEquals("\"<redacted>\"", ValueSerializer.serializeNamed("password", bomb).json());
    }

    @Test
    void redactKeysPropertyIsAdditive() {
        System.setProperty(ValueSerializer.REDACT_KEYS_PROPERTY, " SSN , cardNumber ");
        ValueSerializer.resetForTesting();
        assertTrue(ValueSerializer.isRedactedKey("ssn"));
        assertTrue(ValueSerializer.isRedactedKey("CardNumber"));
        assertTrue(ValueSerializer.isRedactedKey("password"), "defaults must survive an extra list");
        assertFalse(ValueSerializer.isRedactedKey("name"));
        List<String> keys = Arrays.asList(ValueSerializer.redactKeys());
        assertEquals(keys.size(), new java.util.HashSet<>(keys).size(), "no duplicates");
    }

    @Test
    void redactionRunsBeforeTruncationAndTheMarkerIsNotTruncated() {
        System.setProperty(ValueSerializer.MAX_ARG_LENGTH_PROPERTY, "4");
        assertEquals("\"<redacted>\"", ValueSerializer.serializeNamed("token", "x".repeat(50)).json());
    }

    // ---- truncation (task 1) ----

    @Test
    void truncationMarkerMatchesTheOtherRuntimes() {
        System.setProperty(ValueSerializer.MAX_ARG_LENGTH_PROPERTY, "64");
        String marker = json("x".repeat(1000));
        // Measured on the serialized form: the opening quote is character 1,
        // so 63 x's follow it — exactly what examples/golden/truncation/node pins.
        String expected = "<truncated:\"" + "x".repeat(63) + "...>";
        assertEquals("\"" + ValueSerializer.escapeJson(expected) + "\"", marker);
        assertTrue(marker.startsWith("\"<truncated:\\\""), marker);
        assertTrue(marker.endsWith("...>\""), marker);
    }

    @Test
    void truncationIsMeasuredOnTheJsonNotOnToString() {
        System.setProperty(ValueSerializer.MAX_ARG_LENGTH_PROPERTY, "10");
        // 9 chars of text, 11 chars of JSON with quotes: over the limit.
        assertTrue(json("123456789").startsWith("\"<truncated:"));
        // 8 chars of text, 10 chars of JSON: exactly at the limit, untouched.
        assertEquals("\"12345678\"", json("12345678"));
        // A structure counts its brackets and quotes too.
        assertTrue(json(Arrays.asList("abc", "def")).startsWith("\"<truncated:[\\\"abc\\\""));
    }

    @Test
    void zeroDisablesTruncation() {
        System.setProperty(ValueSerializer.MAX_ARG_LENGTH_PROPERTY, "0");
        String big = "x".repeat(5000);
        assertEquals("\"" + big + "\"", json(big));
    }

    @Test
    void badOrNegativeLimitsDegradeInsteadOfFailing() {
        System.setProperty(ValueSerializer.MAX_ARG_LENGTH_PROPERTY, "lots");
        assertEquals(ValueSerializer.DEFAULT_MAX_ARG_LENGTH, ValueSerializer.maxArgLength());
        System.setProperty(ValueSerializer.MAX_ARG_LENGTH_PROPERTY, "-3");
        assertEquals(0, ValueSerializer.maxArgLength());
        System.setProperty(ValueSerializer.MAX_ARG_LENGTH_PROPERTY, "");
        assertEquals(ValueSerializer.DEFAULT_MAX_ARG_LENGTH, ValueSerializer.maxArgLength(),
                "an empty property falls through to the env var / default");
    }

    @Test
    void defaultLimitIs512() {
        assertEquals(512, ValueSerializer.maxArgLength());
        assertEquals("\"" + "x".repeat(510) + "\"", json("x".repeat(510)));
        assertTrue(json("x".repeat(511)).startsWith("\"<truncated:"));
    }

    @Test
    void alreadyRenderedFragmentsAreNotMeasuredAgain() {
        System.setProperty(ValueSerializer.MAX_ARG_LENGTH_PROPERTY, "8");
        JsonFragment once = ValueSerializer.serializeValue("x".repeat(100));
        assertTrue(once.json().startsWith("\"<truncated:"));
        assertSame(once, ValueSerializer.serializeValue(once),
                "a marker re-serialized must not become <truncated:\"<truncated:...");
    }
}
