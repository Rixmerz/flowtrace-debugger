package io.flowtrace.extension;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.junit.jupiter.api.io.TempDir;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * Integration test: spawns a child JVM with the OTel javaagent + FlowTrace
 * extension attached, runs the Calculator golden example, and validates
 * the emitted JSONL against the v2 schema invariants.
 *
 * <p>Requirements to run:
 * <ol>
 *   <li>The OTel standalone agent jar must be present at
 *       {@code target/dependency/opentelemetry-javaagent.jar} (downloaded by
 *       Maven dependency-plugin during the {@code prepare-integration-test}
 *       phase, or by running {@code mvn process-test-resources}).</li>
 *   <li>The extension jar must have been built:
 *       {@code target/flowtrace-otel-extension-2.0.0-SNAPSHOT.jar}.</li>
 *   <li>The Calculator class must be compiled to
 *       {@code target/test-classes/} — achieved by the test-compile phase
 *       picking up {@code src/test/java/com/example/golden/Calculator.java}.</li>
 * </ol>
 *
 * <p>If the OTel agent jar is absent the test is skipped (not failed) so that
 * {@code mvn test} in offline/sandbox environments still passes.
 */
class FlowtraceIntegrationTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /**
     * Full end-to-end: Calculator emits 8 JSONL lines matching the golden
     * call tree (run, add, validate×2 — each with enter+exit).
     */
    @Test
    void calculator_emits_golden_call_tree(@TempDir Path tempDir) throws Exception {

        // --- locate artefacts ---
        File projectBase = new File(System.getProperty("project.basedir",
                new File("").getAbsolutePath()));

        File otelAgentJar = new File(projectBase,
                "target/dependency/opentelemetry-javaagent.jar");
        assumeTrue(otelAgentJar.exists(),
                "OTel agent jar not present at " + otelAgentJar.getAbsolutePath()
                        + " — run 'mvn process-test-resources' with network access first. "
                        + "Skipping integration test.");

        File extensionJar = new File(projectBase,
                "target/flowtrace-otel-extension-2.0.0-SNAPSHOT.jar");
        assumeTrue(extensionJar.exists(),
                "Extension jar not built — run 'mvn package' first. Skipping integration test.");

        // Calculator is compiled to target/test-classes during test-compile phase.
        File testClasses = new File(projectBase, "target/test-classes");

        Path outputJsonl = tempDir.resolve("flowtrace-test.jsonl");

        // --- build the child JVM command ---
        String javaHome = System.getProperty("java.home");
        String javaBin  = javaHome + File.separator + "bin" + File.separator + "java";

        List<String> cmd = new ArrayList<>();
        cmd.add(javaBin);
        cmd.add("-javaagent:" + otelAgentJar.getAbsolutePath());
        cmd.add("-Dotel.javaagent.extensions=" + extensionJar.getAbsolutePath());
        cmd.add("-Dotel.traces.exporter=none");
        cmd.add("-Dotel.metrics.exporter=none");
        cmd.add("-Dotel.logs.exporter=none");
        cmd.add("-Dotel.javaagent.logging=none");
        cmd.add("-Dflowtrace.package-prefix=com.example.golden");
        cmd.add("-Dflowtrace.output=" + outputJsonl.toAbsolutePath());
        cmd.add("-cp");
        cmd.add(testClasses.getAbsolutePath());
        // CalcRunner lives outside the instrumented prefix so only Calculator's
        // 4 methods are captured, giving exactly 8 JSONL lines (4 enter + 4 exit).
        cmd.add("io.flowtrace.runner.CalcRunner");

        ProcessBuilder pb = new ProcessBuilder(cmd);
        pb.redirectErrorStream(false);
        pb.environment().put("OTEL_TRACES_EXPORTER", "none");
        pb.environment().put("OTEL_METRICS_EXPORTER", "none");
        pb.environment().put("OTEL_LOGS_EXPORTER", "none");

        Process process = pb.start();
        boolean finished = process.waitFor(60, TimeUnit.SECONDS);
        assertTrue(finished, "Child JVM did not finish within 60 s");

        // Capture stderr for diagnostics on failure.
        String stderr = new String(process.getErrorStream().readAllBytes());
        int exitCode = process.exitValue();
        assertEquals(0, exitCode,
                "Child JVM exited with code " + exitCode + ". stderr:\n" + stderr);

        // --- parse and validate JSONL ---
        assertTrue(outputJsonl.toFile().exists(),
                "flowtrace.jsonl was not created at " + outputJsonl);

        List<String> lines = Files.readAllLines(outputJsonl);
        // Filter blank lines.
        lines = lines.stream()
                .filter(l -> !l.isBlank())
                .collect(java.util.stream.Collectors.toList());

        assertEquals(8, lines.size(),
                "Expected 8 JSONL lines (4 enter + 4 exit). Got " + lines.size()
                        + ".\nContent:\n" + String.join("\n", lines));

        // --- parse all events ---
        List<JsonNode> events = new ArrayList<>();
        for (String line : lines) {
            events.add(MAPPER.readTree(line));
        }

        // --- schema invariants ---
        String traceId = null;
        for (JsonNode ev : events) {
            // required fields
            assertFieldPresent(ev, "ts");
            assertFieldPresent(ev, "trace_id");
            assertFieldPresent(ev, "span_id");
            assertFieldPresent(ev, "event");
            assertFieldPresent(ev, "thread");
            assertFieldPresent(ev, "lang");
            assertFieldPresent(ev, "class");
            assertFieldPresent(ev, "method");
            assertFieldPresent(ev, "visibility");
            assertFieldPresent(ev, "depth");

            // lang must be "java"
            assertEquals("java", ev.get("lang").asText());

            // event must be enter or exit
            String eventType = ev.get("event").asText();
            assertTrue("enter".equals(eventType) || "exit".equals(eventType),
                    "event must be 'enter' or 'exit', got: " + eventType);

            // W3C id format
            String tid = ev.get("trace_id").asText();
            assertTrue(tid.matches("[0-9a-f]{32}"),
                    "trace_id format invalid: " + tid);
            String sid = ev.get("span_id").asText();
            assertTrue(sid.matches("[0-9a-f]{16}"),
                    "span_id format invalid: " + sid);

            // All events share one trace_id
            if (traceId == null) {
                traceId = tid;
            } else {
                assertEquals(traceId, tid, "All events must share one trace_id");
            }

            // exit events must have duration_ns
            if ("exit".equals(eventType)) {
                assertFieldPresent(ev, "duration_ns");
                assertTrue(ev.get("duration_ns").asLong() >= 0,
                        "duration_ns must be non-negative");
            }
        }

        // --- validate method set ---
        long validatePrivateEnters = events.stream()
                .filter(ev -> "enter".equals(ev.get("event").asText()))
                .filter(ev -> "validate".equals(ev.get("method").asText()))
                .filter(ev -> "private".equals(ev.get("visibility").asText()))
                .count();
        assertEquals(2, validatePrivateEnters,
                "Expected 2 private 'validate' enter events");

        // --- validate parent linkage (depth 0 → run, depth 1 → add, depth 2 → validate) ---
        JsonNode runEnter = findFirstEvent(events, "enter", "run");
        assertNotNull(runEnter, "Missing enter event for run()");
        assertTrue(runEnter.get("parent_id") == null || runEnter.get("parent_id").isNull(),
                "run() should have null parent_id (root span)");
        assertEquals(0, runEnter.get("depth").asInt(), "run() depth must be 0");

        JsonNode addEnter = findFirstEvent(events, "enter", "add");
        assertNotNull(addEnter, "Missing enter event for add()");
        assertNotNull(addEnter.get("parent_id"), "add() must have a parent_id");
        assertFalse(addEnter.get("parent_id").isNull(), "add() parent_id must not be null");
        assertEquals(runEnter.get("span_id").asText(), addEnter.get("parent_id").asText(),
                "add() parent_id must equal run() span_id");
        assertEquals(1, addEnter.get("depth").asInt(), "add() depth must be 1");

        JsonNode validateEnter = findFirstEvent(events, "enter", "validate");
        assertNotNull(validateEnter, "Missing enter event for validate()");
        assertEquals(2, validateEnter.get("depth").asInt(), "validate() depth must be 2");
        assertEquals(addEnter.get("span_id").asText(), validateEnter.get("parent_id").asText(),
                "validate() parent_id must equal add() span_id");
    }

    // ---- helpers ----

    private static void assertFieldPresent(JsonNode node, String field) {
        assertNotNull(node.get(field), "Missing required field '" + field + "' in: " + node);
    }

    private static JsonNode findFirstEvent(List<JsonNode> events, String eventType, String method) {
        return events.stream()
                .filter(ev -> eventType.equals(ev.get("event").asText())
                        && method.equals(ev.get("method").asText()))
                .findFirst()
                .orElse(null);
    }
}
