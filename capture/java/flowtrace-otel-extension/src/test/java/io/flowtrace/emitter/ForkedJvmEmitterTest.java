package io.flowtrace.emitter;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.flowtrace.probe.EmitterProbe;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Settings that are fixed for the life of a JVM — the default charset and
 * the process environment — are asserted by forking a child JVM running
 * {@link EmitterProbe} against the compiled main + test classes. No agent is
 * attached: this is the emitter path, not the weave.
 */
class ForkedJvmEmitterTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    void outputIsUtf8EvenWhenTheDefaultCharsetIsLatin1(@TempDir Path tmp) throws Exception {
        Path out = tmp.resolve("utf8.jsonl");
        run(out, "utf8", List.of("-Dfile.encoding=ISO-8859-1", "-Dsun.stdout.encoding=ISO-8859-1"), Map.of());

        byte[] raw = Files.readAllBytes(out);
        String line = new String(raw, StandardCharsets.UTF_8).trim();
        JsonNode node = MAPPER.readTree(line);
        assertEquals(EmitterProbe.NON_ASCII, node.get("args").get("message").asText(),
                "non-ASCII argument must round-trip as UTF-8; got bytes " + hex(raw));
        assertFalse(line.contains("?"), "a '?' means the default charset replaced a character: " + line);
    }

    @Test
    void maxArgLengthEnvVarIsHonouredWhenThePropertyIsAbsent(@TempDir Path tmp) throws Exception {
        Path out = tmp.resolve("env.jsonl");
        run(out, "long", List.of(), Map.of("FLOWTRACE_MAX_ARG_LENGTH", "16"));

        JsonNode node = MAPPER.readTree(Files.readString(out, StandardCharsets.UTF_8).trim());
        String message = node.get("args").get("message").asText();
        assertEquals("<truncated:\"" + "x".repeat(15) + "...>", message);
    }

    @Test
    void systemPropertyTakesPrecedenceOverTheEnvVar(@TempDir Path tmp) throws Exception {
        Path out = tmp.resolve("prop.jsonl");
        run(out, "long", List.of("-Dflowtrace.max-arg-length=0"), Map.of("FLOWTRACE_MAX_ARG_LENGTH", "16"));

        JsonNode node = MAPPER.readTree(Files.readString(out, StandardCharsets.UTF_8).trim());
        assertEquals("x".repeat(200), node.get("args").get("message").asText());
    }

    @Test
    void tsCarriesMicrosecondsAndTheShutdownHookFlushes(@TempDir Path tmp) throws Exception {
        Path out = tmp.resolve("ts.jsonl");
        // The probe never calls close(): the line below exists only if the
        // per-line flush and the shutdown hook did their job.
        run(out, "long", List.of(), Map.of());
        String line = Files.readString(out, StandardCharsets.UTF_8).trim();
        assertTrue(line.contains("\"ts\":1700000000.123456"), line);
    }

    // ---- helpers ----

    private static void run(Path out, String mode, List<String> jvmArgs, Map<String, String> env) throws Exception {
        File base = new File(System.getProperty("project.basedir", new File("").getAbsolutePath()));
        String classpath = new File(base, "target/classes").getAbsolutePath()
                + File.pathSeparator + new File(base, "target/test-classes").getAbsolutePath();
        String java = System.getProperty("java.home") + File.separator + "bin" + File.separator + "java";

        List<String> cmd = new ArrayList<>();
        cmd.add(java);
        cmd.addAll(jvmArgs);
        cmd.add("-Dflowtrace.output=" + out.toAbsolutePath());
        cmd.add("-cp");
        cmd.add(classpath);
        cmd.add(EmitterProbe.class.getName());
        cmd.add(mode);

        ProcessBuilder pb = new ProcessBuilder(cmd);
        pb.environment().remove("FLOWTRACE_MAX_ARG_LENGTH");
        pb.environment().putAll(env);
        File log = out.resolveSibling(out.getFileName() + ".log").toFile();
        pb.redirectErrorStream(true);
        pb.redirectOutput(log);
        Process p = pb.start();
        assertTrue(p.waitFor(60, TimeUnit.SECONDS), "probe JVM did not finish");
        assertEquals(0, p.exitValue(), "probe JVM failed:\n" + Files.readString(log.toPath()));
        assertTrue(Files.exists(out), "probe emitted nothing:\n" + Files.readString(log.toPath()));
    }

    private static String hex(byte[] bytes) {
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) sb.append(String.format("%02x ", b));
        return sb.toString();
    }
}
