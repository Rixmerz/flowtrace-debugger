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
import java.util.HashMap;
import java.util.List;
import java.util.Map;
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
