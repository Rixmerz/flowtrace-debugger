package io.flowtrace.extension;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
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
 * extension attached, runs {@code VirtualThreadRunner} (a JDK-21-only
 * fixture that calls an instrumented method from inside a
 * {@code Thread.ofVirtual()} body), and asserts the call stays in one trace.
 *
 * <p>Lives under {@code src/test/java21}, not {@code src/test/java}, and is
 * compiled only by the {@code jdk21-fixtures} Maven profile — see the pom's
 * profile activation ({@code jdk >= 21}). The module's agent code targets
 * bytecode 11 as a compatibility floor, but this test's fixture needs
 * {@code Thread.ofVirtual()} (JDK 21), and the module is exercised by CI on
 * JDK 17 as well — compiling that fixture unconditionally into
 * {@code src/test/java} would break the JDK 17 leg of the matrix.
 *
 * <p>Structured as a standalone copy of {@link FlowtraceIntegrationTest}'s
 * plumbing rather than a shared base class: keeping the two test classes
 * independent means a JDK-17 build (which never even sees this source root)
 * needs no knowledge that this one exists.
 *
 * <p>Regression test for: a virtual thread's call path landing in its own,
 * disconnected trace with a null parent instead of continuing the trace of
 * whichever thread started it. Root cause: OTel's default {@code Context}
 * storage is a plain {@code ThreadLocal}, which a virtual thread — like any
 * new {@code Thread} — does not inherit.
 */
class VirtualThreadIntegrationTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    void virtual_thread_call_path_attributed_to_parent_span(@TempDir Path tempDir) throws Exception {

        File projectBase = new File(System.getProperty("project.basedir",
                new File("").getAbsolutePath()));

        File otelAgentJar = new File(projectBase,
                "target/dependency/opentelemetry-javaagent.jar");
        requireArtifact(otelAgentJar.exists(),
                "OTel agent jar not present at " + otelAgentJar.getAbsolutePath()
                        + " — run 'mvn process-test-resources' with network access first.");

        File extensionJar = findExtensionJar(projectBase);
        requireArtifact(extensionJar != null,
                "Extension jar not built under " + new File(projectBase, "target")
                        + " — run 'mvn package' first.");

        // VirtualThreadRunner/VirtualThreadCalcRunner are compiled to
        // target/test-classes by the jdk21-fixtures profile's extra
        // testCompile execution, into the same output dir as src/test/java.
        File testClasses = new File(projectBase, "target/test-classes");

        Path outputJsonl = tempDir.resolve("flowtrace-vthread-test.jsonl");

        String javaHome = System.getProperty("java.home");
        String javaBin  = javaHome + File.separator + "bin" + File.separator + "java";

        List<String> cmd = new ArrayList<>();
        cmd.add(javaBin);
        cmd.add("-javaagent:" + otelAgentJar.getAbsolutePath());
        cmd.add("-Dotel.javaagent.extensions=" + extensionJar.getAbsolutePath());
        cmd.add("-Dotel.traces.exporter=none");
        cmd.add("-Dotel.metrics.exporter=none");
        cmd.add("-Dotel.logs.exporter=none");
        cmd.add("-Dflowtrace.package-prefix=com.example.golden");
        cmd.add("-Dflowtrace.output=" + outputJsonl.toAbsolutePath());
        cmd.add("-cp");
        cmd.add(testClasses.getAbsolutePath());
        cmd.add("io.flowtrace.runner.VirtualThreadCalcRunner");

        ProcessBuilder pb = new ProcessBuilder(cmd);
        File stderrFile = tempDir.resolve("child-stderr.log").toFile();
        pb.redirectError(stderrFile);
        pb.environment().put("OTEL_TRACES_EXPORTER", "none");
        pb.environment().put("OTEL_METRICS_EXPORTER", "none");
        pb.environment().put("OTEL_LOGS_EXPORTER", "none");

        Process process = pb.start();
        boolean finished = process.waitFor(60, TimeUnit.SECONDS);
        if (!finished) {
            process.destroyForcibly();
        }
        assertTrue(finished, "Child JVM did not finish within 60 s." + diagnostics(stderrFile));

        int exitCode = process.exitValue();
        assertEquals(0, exitCode,
                "Child JVM exited with code " + exitCode + "." + diagnostics(stderrFile));

        assertTrue(outputJsonl.toFile().exists(),
                "flowtrace.jsonl was not created at " + outputJsonl
                        + ". The child JVM ran and exited cleanly, so the agent "
                        + "loaded but instrumented nothing." + diagnostics(stderrFile));

        List<String> lines = Files.readAllLines(outputJsonl).stream()
                .filter(l -> !l.isBlank())
                .collect(java.util.stream.Collectors.toList());

        List<JsonNode> events = new ArrayList<>();
        for (String line : lines) {
            events.add(MAPPER.readTree(line));
        }

        JsonNode runEnter = findFirstEvent(events, "enter", "run");
        assertNotNull(runEnter, "Missing enter event for run()."
                + "\nContent:\n" + String.join("\n", lines));

        JsonNode vtEnter = findFirstEvent(events, "enter", "onVirtualThread");
        assertNotNull(vtEnter, "Missing enter event for onVirtualThread() — the "
                + "virtual-thread call path was dropped entirely."
                + "\nContent:\n" + String.join("\n", lines));

        assertEquals(runEnter.get("trace_id").asText(), vtEnter.get("trace_id").asText(),
                "onVirtualThread(), called from a Thread.ofVirtual() body, must "
                        + "share run()'s trace_id, not start a disconnected trace."
                        + "\nContent:\n" + String.join("\n", lines));

        assertNotNull(vtEnter.get("parent_id"),
                "onVirtualThread() must not have a null parent_id — the virtual "
                        + "thread's call path must not be dropped from the tree.");
        assertFalse(vtEnter.get("parent_id").isNull(),
                "onVirtualThread() must not have a null parent_id — the virtual "
                        + "thread's call path must not be dropped from the tree.");
        assertEquals(runEnter.get("span_id").asText(), vtEnter.get("parent_id").asText(),
                "onVirtualThread()'s parent_id must equal run()'s span_id — it "
                        + "must not be attributed to the wrong parent span."
                        + "\nContent:\n" + String.join("\n", lines));
    }

    // ---- helpers (mirrors FlowtraceIntegrationTest; kept independent, see class doc) ----

    private static File findExtensionJar(File projectBase) {
        File[] candidates = new File(projectBase, "target").listFiles((dir, name) ->
                name.startsWith("flowtrace-otel-extension-")
                        && name.endsWith(".jar")
                        && !name.startsWith("original-"));
        if (candidates == null || candidates.length == 0) return null;
        File newest = candidates[0];
        for (File f : candidates) {
            if (f.lastModified() > newest.lastModified()) newest = f;
        }
        return newest;
    }

    private static void requireArtifact(boolean present, String message) {
        if (Boolean.getBoolean("flowtrace.it.required")) {
            assertTrue(present, message + " (flowtrace.it.required=true)");
        } else {
            assumeTrue(present, message + " Skipping integration test.");
        }
    }

    private static String diagnostics(File stderrFile) {
        StringBuilder sb = new StringBuilder();
        sb.append("\n  JDK: ").append(System.getProperty("java.version"))
          .append(" (").append(System.getProperty("java.vendor")).append(")");
        sb.append("\n  child stderr");
        if (!stderrFile.exists()) {
            sb.append(": <no file produced>");
            return sb.toString();
        }
        String content;
        try {
            content = new String(Files.readAllBytes(stderrFile.toPath())).trim();
        } catch (IOException e) {
            return sb.append(": <unreadable: ").append(e.getMessage()).append(">").toString();
        }
        if (content.isEmpty()) {
            sb.append(": <empty>");
        } else {
            sb.append(":\n").append(content);
        }
        return sb.toString();
    }

    private static JsonNode findFirstEvent(List<JsonNode> events, String eventType, String method) {
        return events.stream()
                .filter(ev -> eventType.equals(ev.get("event").asText())
                        && method.equals(ev.get("method").asText()))
                .findFirst()
                .orElse(null);
    }
}
