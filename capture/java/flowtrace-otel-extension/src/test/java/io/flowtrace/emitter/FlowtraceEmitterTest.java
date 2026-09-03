package io.flowtrace.emitter;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import static org.junit.jupiter.api.Assertions.*;

class FlowtraceEmitterTest {

    @TempDir
    Path tempDir;

    private Path outFile;
    private final ObjectMapper mapper = new ObjectMapper();

    @BeforeEach
    void setUp() {
        FlowtraceEmitter.resetForTesting();
        outFile = tempDir.resolve("flowtrace-test.jsonl");
        // Use the system property override supported by FlowtraceEmitter
        // (env vars cannot be mutated reliably within a running JVM).
        System.setProperty("flowtrace.output", outFile.toString());
    }

    @AfterEach
    void tearDown() {
        FlowtraceEmitter.resetForTesting();
        System.clearProperty("flowtrace.output");
        System.clearProperty("flowtrace.max-arg-length");
    }

    // -------------------------------------------------------------------------
    // 1. Basic enter + exit round-trip
    // -------------------------------------------------------------------------

    @Test
    void enterAndExitEventsWrittenAndStructurallyValid() throws Exception {
        FlowtraceEmitter emitter = FlowtraceEmitter.getInstance();

        emitter.emit(buildEnter("aabbccddeeff00112233445566778899", "0011223344556677", null));
        emitter.emit(buildExit ("aabbccddeeff00112233445566778899", "0011223344556677", null, 1_500_000L));
        emitter.close();

        List<String> lines = Files.readAllLines(outFile);
        assertEquals(2, lines.size(), "Expected exactly 2 lines");

        // --- enter event ---
        JsonNode enter = mapper.readTree(lines.get(0));
        assertEquals("enter",  enter.get("event").asText());
        assertEquals("java",   enter.get("lang").asText());
        assertTrue(enter.has("ts"));
        assertTrue(enter.has("trace_id"));
        assertTrue(enter.has("span_id"));
        assertTrue(enter.has("thread"));
        assertTrue(enter.has("module"));
        assertTrue(enter.has("class"));
        assertTrue(enter.has("method"));
        assertTrue(enter.has("visibility"));
        assertTrue(enter.has("args"));
        assertTrue(enter.has("depth"));
        assertFalse(enter.has("result"),      "enter must not have result");
        assertFalse(enter.has("duration_ns"), "enter must not have duration_ns");
        assertFalse(enter.has("error"),       "enter must not have error");

        // --- exit event ---
        JsonNode exit = mapper.readTree(lines.get(1));
        assertEquals("exit",   exit.get("event").asText());
        assertTrue(exit.has("result"));
        assertTrue(exit.has("duration_ns"));
        assertEquals(1_500_000L, exit.get("duration_ns").asLong());
    }

    // -------------------------------------------------------------------------
    // 2. W3C ID validation — bad trace_id drops the event
    // -------------------------------------------------------------------------

    @Test
    void badTraceIdDropsEventAndWritesToStderr() throws Exception {
        ByteArrayOutputStream errBuf = new ByteArrayOutputStream();
        PrintStream origErr = System.err;
        System.setErr(new PrintStream(errBuf));
        try {
            FlowtraceEmitter emitter = FlowtraceEmitter.getInstance();
            // Invalid: contains uppercase + only 31 chars
            TraceEvent bad = buildEnter("BADBADBADBADBADBADBADBADBADBAD0", "0011223344556677", null);
            emitter.emit(bad);
            emitter.close();
        } finally {
            System.setErr(origErr);
        }

        // File should be empty (event dropped) or not even contain lines
        boolean fileEmpty = !Files.exists(outFile) || Files.readAllLines(outFile).isEmpty();
        assertTrue(fileEmpty, "Dropped event must not appear in output");

        String stderr = errBuf.toString();
        assertTrue(stderr.contains("DROP"), "Stderr must contain DROP notice");
    }

    @Test
    void badSpanIdDropsEvent() throws Exception {
        ByteArrayOutputStream errBuf = new ByteArrayOutputStream();
        PrintStream origErr = System.err;
        System.setErr(new PrintStream(errBuf));
        try {
            FlowtraceEmitter emitter = FlowtraceEmitter.getInstance();
            // Valid trace_id, invalid span_id (too short)
            TraceEvent bad = buildEnter("aabbccddeeff00112233445566778899", "short", null);
            emitter.emit(bad);
            emitter.close();
        } finally {
            System.setErr(origErr);
        }

        boolean fileEmpty = !Files.exists(outFile) || Files.readAllLines(outFile).isEmpty();
        assertTrue(fileEmpty);
        assertTrue(errBuf.toString().contains("DROP"));
    }

    // -------------------------------------------------------------------------
    // 3. Concurrency: 100 threads × 100 events = 10 000 lines, no interleaving
    // -------------------------------------------------------------------------

    @Test
    void concurrentEmitProducesExactlyTenThousandLines() throws Exception {
        int threads = 100;
        int eventsPerThread = 100;
        FlowtraceEmitter emitter = FlowtraceEmitter.getInstance();

        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch startGate = new CountDownLatch(1);
        CountDownLatch done = new CountDownLatch(threads);

        for (int t = 0; t < threads; t++) {
            final int tid = t;
            pool.submit(() -> {
                try {
                    startGate.await();
                    for (int i = 0; i < eventsPerThread; i++) {
                        // Use thread index to build deterministic but unique IDs
                        String traceId = String.format("%032x", (long) tid * 1_000_000L + i);
                        String spanId  = String.format("%016x", (long) tid * 100_000L  + i);
                        emitter.emit(buildEnter(traceId, spanId, null));
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                } finally {
                    done.countDown();
                }
            });
        }

        startGate.countDown(); // release all threads simultaneously
        done.await();
        pool.shutdown();
        emitter.close();

        List<String> lines = Files.readAllLines(outFile);
        assertEquals(threads * eventsPerThread, lines.size(),
                "Expected exactly " + (threads * eventsPerThread) + " lines");

        // Verify no line is interleaved (each line must parse as valid JSON)
        for (String line : lines) {
            JsonNode node = mapper.readTree(line);
            assertNotNull(node.get("event"), "Every line must have an 'event' field");
        }
    }


    // -------------------------------------------------------------------------
    // 4. args / result values: structural JSON, per-value truncation, never drop
    // -------------------------------------------------------------------------

    @Test
    void structuralValuesInArgsAndResultAreProperJson() throws Exception {
        FlowtraceEmitter emitter = FlowtraceEmitter.getInstance();
        TraceEvent e = buildExit("aabbccddeeff00112233445566778899", "0011223344556677", null, 1L);

        Map<String, Object> args = new LinkedHashMap<>();
        args.put("list", Arrays.asList(1, "two", null));
        args.put("ints", new int[]{1, 2});
        Map<Object, Object> intKeys = new LinkedHashMap<>();
        intKeys.put(7, "seven");
        args.put("map", intKeys);
        args.put("nan", Double.NaN);
        args.put("chr", 'x');
        args.put("enum", java.time.DayOfWeek.MONDAY);
        args.put("opt", Optional.of(3));
        args.put("none", Optional.empty());
        args.put("obj", new StringBuilder("sb"));
        e.setArgs(args);

        Map<String, Object> result = new LinkedHashMap<>();
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("items", Arrays.asList("a", "b"));
        payload.put("token", "secret-value");
        result.put("value", payload);
        e.setResult(result);

        emitter.emit(e);
        emitter.close();

        JsonNode node = mapper.readTree(Files.readAllLines(outFile).get(0));
        JsonNode a = node.get("args");
        assertEquals("two", a.get("list").get(1).asText());
        assertTrue(a.get("list").get(2).isNull());
        assertEquals(2, a.get("ints").get(1).asInt());
        assertEquals("seven", a.get("map").get("7").asText());
        assertTrue(a.get("nan").isNull(), "NaN must become null, not a bare NaN token");
        assertEquals("x", a.get("chr").asText());
        assertEquals("MONDAY", a.get("enum").asText());
        assertEquals(3, a.get("opt").asInt());
        assertTrue(a.get("none").isNull());
        assertEquals("sb", a.get("obj").asText());

        JsonNode r = node.get("result").get("value");
        assertEquals("b", r.get("items").get(1).asText());
        assertEquals("<redacted>", r.get("token").asText(), "map keys inside result are redacted too");
    }

    @Test
    void resultValueIsTruncatedIndependentlyOfTheWrapper() throws Exception {
        System.setProperty("flowtrace.max-arg-length", "20");
        FlowtraceEmitter emitter = FlowtraceEmitter.getInstance();
        TraceEvent e = buildExit("aabbccddeeff00112233445566778899", "0011223344556677", null, 1L);
        e.setResult(Map.of("value", "y".repeat(100)));
        emitter.emit(e);
        emitter.close();

        JsonNode node = mapper.readTree(Files.readAllLines(outFile).get(0));
        String value = node.get("result").get("value").asText();
        assertEquals("<truncated:\"" + "y".repeat(19) + "...>", value);
        assertTrue(node.get("result").isObject(), "the {\"value\": ...} wrapper itself is never truncated");
    }

    @Test
    void oneUnserializableValueDoesNotDropTheEvent() throws Exception {
        FlowtraceEmitter emitter = FlowtraceEmitter.getInstance();
        TraceEvent e = buildEnter("aabbccddeeff00112233445566778899", "0011223344556677", null);
        Object bomb = new Object() {
            @Override public String toString() { throw new IllegalStateException("nope"); }
        };
        Map<String, Object> args = new LinkedHashMap<>();
        args.put("arg0", bomb);
        args.put("arg1", "fine");
        e.setArgs(args);
        emitter.emit(e);
        emitter.close();

        List<String> lines = Files.readAllLines(outFile);
        assertEquals(1, lines.size(), "the event must still be written");
        JsonNode node = mapper.readTree(lines.get(0));
        assertEquals("<unserializable: " + bomb.getClass().getName() + ">", node.get("args").get("arg0").asText());
        assertEquals("fine", node.get("args").get("arg1").asText());
    }

    @Test
    void preRenderedFragmentsAreWrittenVerbatim() throws Exception {
        FlowtraceEmitter emitter = FlowtraceEmitter.getInstance();
        TraceEvent e = buildEnter("aabbccddeeff00112233445566778899", "0011223344556677", null);
        Map<String, Object> args = new LinkedHashMap<>();
        args.put("arg0", new JsonFragment("{\"pre\":[1,2]}"));
        e.setArgs(args);
        emitter.emit(e);
        emitter.close();

        String line = Files.readAllLines(outFile).get(0);
        assertTrue(line.contains("\"args\":{\"arg0\":{\"pre\":[1,2]}}"), line);
    }

    // -------------------------------------------------------------------------
    // 5. ts: microsecond precision, plain decimal
    // -------------------------------------------------------------------------

    @Test
    void tsHasSixFractionDigitsAndNoExponent() throws Exception {
        FlowtraceEmitter emitter = FlowtraceEmitter.getInstance();
        TraceEvent e = buildEnter("aabbccddeeff00112233445566778899", "0011223344556677", null);
        e.setTs(1785481163.000123);
        emitter.emit(e);
        TraceEvent whole = buildEnter("aabbccddeeff00112233445566778899", "0011223344556677", null);
        whole.setTs(1785481163d);
        emitter.emit(whole);
        emitter.close();

        List<String> lines = Files.readAllLines(outFile);
        assertTrue(lines.get(0).contains("\"ts\":1785481163.000123,"), lines.get(0));
        assertTrue(lines.get(1).contains("\"ts\":1785481163.000000,"), lines.get(1));
        assertEquals(1785481163.000123, mapper.readTree(lines.get(0)).get("ts").asDouble(), 1e-6);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private TraceEvent buildEnter(String traceId, String spanId, String parentId) {
        TraceEvent e = new TraceEvent();
        e.setTs(System.currentTimeMillis());
        e.setTraceId(traceId);
        e.setSpanId(spanId);
        e.setParentId(parentId);
        e.setEvent("enter");
        e.setThread(Thread.currentThread().getName());
        e.setModule("io.flowtrace.test");
        e.setClassName("TestClass");
        e.setMethod("testMethod");
        e.setVisibility("public");
        e.setArgs(new HashMap<>());
        e.setDepth(0);
        return e;
    }

    private TraceEvent buildExit(String traceId, String spanId, String parentId, long durationNs) {
        TraceEvent e = buildEnter(traceId, spanId, parentId);
        e.setEvent("exit");
        e.setResult(Map.of("value", "ok"));
        e.setDurationNs(durationNs);
        return e;
    }

}
