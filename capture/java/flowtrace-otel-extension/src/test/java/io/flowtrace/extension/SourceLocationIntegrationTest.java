package io.flowtrace.extension;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import javax.tools.JavaCompiler;
import javax.tools.ToolProvider;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * {@code file} / {@code line} end to end: a child JVM under the real OTel
 * agent and the jar this build produced.
 *
 * <p>{@link SourceLocationsTest} proves the class-file reader. What only a
 * woven class can prove is the rest of the chain — that the locations read in
 * one transformer reach the advice mapping in the next, per method, and come
 * out of the emitter in the right place — and that chain fails silently: a
 * broken hand-off yields perfectly valid events that merely lack two optional
 * fields.
 *
 * <p>Skips, or fails under {@code -Dflowtrace.it.required=true}, exactly like
 * {@link FlowtraceIntegrationTest}.
 */
class SourceLocationIntegrationTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String LOCATED_FILE = "com/example/location/Located.java";

    @Test
    void enterEvents_carryDeclaringFileAndFirstBodyLine(@TempDir Path tempDir) throws Exception {
        File projectBase = projectBase();
        Map<String, Integer> expected = markedLines(
                new File(projectBase, "src/test/java/" + LOCATED_FILE).toPath());

        List<String> lines = runUnderAgent(tempDir,
                new File(projectBase, "target/test-classes").getAbsolutePath(),
                "io.flowtrace.runner.LocatedRunner", "com.example.location");
        List<JsonNode> events = parse(lines);

        // describe(int), describe(String), viaNested, ping, anonymous, get
        assertEquals(12, events.size(), "6 calls, enter + exit each:\n" + String.join("\n", lines));

        List<JsonNode> enters = events.stream()
                .filter(e -> "enter".equals(e.get("event").asText())).collect(Collectors.toList());
        List<JsonNode> describes = enters.stream()
                .filter(e -> "describe".equals(e.get("method").asText())).collect(Collectors.toList());
        assertEquals(2, describes.size());

        // Overloads: same class, same method name, told apart by descriptor.
        int ofInt = describes.get(0).get("line").asInt();
        int ofString = describes.get(1).get("line").asInt();
        assertEquals(expected.get("describe(I)").intValue(), ofInt);
        assertEquals(expected.get("describe(String)").intValue(), ofString);
        assertNotEquals(ofInt, ofString, "overloads must not share a line");

        assertEquals(expected.get("viaNested").intValue(), enter(enters, "Located", "viaNested").get("line").asInt());
        assertEquals(expected.get("anonymous").intValue(), enter(enters, "Located", "anonymous").get("line").asInt());

        // Nested and anonymous classes: their own class name, the OUTER file.
        JsonNode ping = enter(enters, "Located$Inner", "ping");
        assertEquals(LOCATED_FILE, ping.get("file").asText());
        assertEquals(expected.get("ping").intValue(), ping.get("line").asInt());
        JsonNode get = enter(enters, "Located$1", "get");
        assertEquals(LOCATED_FILE, get.get("file").asText());
        assertEquals(expected.get("get").intValue(), get.get("line").asInt());

        for (JsonNode e : enters) {
            assertEquals(LOCATED_FILE, e.get("file").asText(), "file on every enter: " + e);
        }

        // Placement: the last two keys of an enter event, absent from exit.
        Pattern tail = Pattern.compile(",\"depth\":\\d+,\"file\":\"[^\"]+\",\"line\":\\d+}$");
        for (String line : lines) {
            if (line.contains("\"event\":\"enter\"")) {
                assertTrue(tail.matcher(line).find(), "file and line must close the enter event: " + line);
            } else {
                assertFalse(line.contains("\"file\":") || line.contains("\"line\":"),
                        "exit events carry no location: " + line);
            }
        }
    }

    @Test
    void classCompiledWithoutDebugInfo_emitsNeitherFileNorLine(@TempDir Path tempDir) throws Exception {
        Path sourceDir = Files.createDirectory(tempDir.resolve("src"));
        Path classes = Files.createDirectory(tempDir.resolve("classes"));
        Path source = sourceDir.resolve("NoDebug.java");
        Files.write(source, String.join("\n",
                "public class NoDebug {",
                "    static int twice(int n) {",
                "        return n * 2;",
                "    }",
                "    public static void main(String[] args) {",
                "        twice(21);",
                "    }",
                "}",
                "").getBytes(StandardCharsets.UTF_8));
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        assertNotNull(compiler, "this test needs a JDK, not a JRE");
        ByteArrayOutputStream diagnostics = new ByteArrayOutputStream();
        assertEquals(0, compiler.run(null, null, diagnostics,
                "-g:none", "-d", classes.toString(), source.toString()), "javac failed: " + diagnostics);

        List<String> lines = runUnderAgent(tempDir, classes.toString(), "NoDebug", "NoDebug");

        assertEquals(4, lines.size(), "main + twice, enter + exit each:\n" + String.join("\n", lines));
        for (String line : lines) {
            assertFalse(line.contains("\"file\":") || line.contains("\"line\":"),
                    "no SourceFile attribute, so nothing may be reported: " + line);
        }
    }

    // ---- helpers ----

    /** {@code // @line:<key>} markers of a source file, as key to 1-indexed line. */
    private static Map<String, Integer> markedLines(Path source) throws Exception {
        Pattern marker = Pattern.compile("// @line:(\\S+)\\s*$");
        Map<String, Integer> lines = new HashMap<>();
        List<String> text = Files.readAllLines(source, StandardCharsets.UTF_8);
        for (int i = 0; i < text.size(); i++) {
            Matcher m = marker.matcher(text.get(i));
            if (m.find()) lines.put(m.group(1), i + 1);
        }
        assertEquals(6, lines.size(), "markers in " + source + ": " + lines);
        return lines;
    }

    private static JsonNode enter(List<JsonNode> enters, String className, String method) {
        return enters.stream()
                .filter(e -> className.equals(e.get("class").asText()) && method.equals(e.get("method").asText()))
                .findFirst()
                .orElseThrow(() -> new AssertionError("no enter event for " + className + "." + method));
    }

    private static List<JsonNode> parse(List<String> lines) throws Exception {
        List<JsonNode> events = new ArrayList<>();
        for (String line : lines) events.add(MAPPER.readTree(line));
        return events;
    }

    static File projectBase() {
        return new File(System.getProperty("project.basedir", new File("").getAbsolutePath()));
    }

    /** Runs {@code mainClass} under the agent and returns the non-blank JSONL lines. */
    static List<String> runUnderAgent(Path tempDir, String classpath, String mainClass, String prefix)
            throws Exception {
        File projectBase = projectBase();
        File agent = new File(projectBase, "target/dependency/opentelemetry-javaagent.jar");
        requireArtifact(agent.exists(), "OTel agent jar not present at " + agent.getAbsolutePath());
        String version = System.getProperty("project.version", "").trim();
        // By exact name, never "newest in target/": see FlowtraceIntegrationTest#findExtensionJar.
        File extension = new File(projectBase, "target/flowtrace-otel-extension-" + version + ".jar");
        requireArtifact(!version.isEmpty() && extension.isFile(),
                extension.getName() + " not present under target/ — run 'mvn package' first.");

        Path output = tempDir.resolve("flowtrace-" + mainClass + ".jsonl");
        File stderr = tempDir.resolve("child-stderr-" + mainClass + ".log").toFile();

        List<String> cmd = new ArrayList<>();
        cmd.add(System.getProperty("java.home") + File.separator + "bin" + File.separator + "java");
        cmd.add("-javaagent:" + agent.getAbsolutePath());
        cmd.add("-Dotel.javaagent.extensions=" + extension.getAbsolutePath());
        cmd.add("-Dotel.traces.exporter=none");
        cmd.add("-Dotel.metrics.exporter=none");
        cmd.add("-Dotel.logs.exporter=none");
        cmd.add("-Dflowtrace.package-prefix=" + prefix);
        cmd.add("-Dflowtrace.output=" + output.toAbsolutePath());
        cmd.add("-cp");
        cmd.add(classpath);
        cmd.add(mainClass);

        ProcessBuilder pb = new ProcessBuilder(cmd);
        // To files, not pipes: with agent logging on, an unread pipe can fill
        // and deadlock against waitFor.
        pb.redirectError(stderr);
        pb.redirectOutput(tempDir.resolve("child-stdout-" + mainClass + ".log").toFile());
        pb.environment().put("OTEL_TRACES_EXPORTER", "none");
        pb.environment().put("OTEL_METRICS_EXPORTER", "none");
        pb.environment().put("OTEL_LOGS_EXPORTER", "none");

        Process process = pb.start();
        boolean finished = process.waitFor(60, TimeUnit.SECONDS);
        if (!finished) process.destroyForcibly();
        String diagnostics = "\n  JDK: " + System.getProperty("java.version") + "\n  child stderr:\n"
                + (stderr.exists() ? new String(Files.readAllBytes(stderr.toPath()), StandardCharsets.UTF_8) : "<none>");
        assertTrue(finished, "child JVM did not finish within 60 s" + diagnostics);
        assertEquals(0, process.exitValue(), "child JVM failed" + diagnostics);
        assertTrue(output.toFile().exists(), "no trace written: the agent instrumented nothing" + diagnostics);

        return Files.readAllLines(output, StandardCharsets.UTF_8).stream()
                .filter(l -> !l.trim().isEmpty()).collect(Collectors.toList());
    }

    private static void requireArtifact(boolean present, String message) {
        if (Boolean.getBoolean("flowtrace.it.required")) {
            assertTrue(present, message + " (flowtrace.it.required=true)");
        } else {
            assumeTrue(present, message + " Skipping integration test.");
        }
    }
}
