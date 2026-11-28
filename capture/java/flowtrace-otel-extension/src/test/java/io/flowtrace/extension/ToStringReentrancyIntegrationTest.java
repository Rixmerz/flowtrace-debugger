package io.flowtrace.extension;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.File;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * The tracer renders arguments and results with toString(); when that class is
 * itself instrumented, the call must not show up as a span of the program.
 * Runs under the real agent: only a woven class proves the advice honours
 * {@link io.flowtrace.emitter.CaptureGuard}.
 */
class ToStringReentrancyIntegrationTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    void toStringCalledBySerialisationIsNotTraced(@TempDir Path tempDir) throws Exception {
        List<String> lines = SourceLocationIntegrationTest.runUnderAgent(tempDir,
                new File(SourceLocationIntegrationTest.projectBase(), "target/test-classes").getAbsolutePath(),
                "io.flowtrace.runner.ReentrantRunner", "com.example.reentrant");

        List<JsonNode> events = new ArrayList<>();
        for (String l : lines) events.add(MAPPER.readTree(l));
        String dump = String.join("\n", lines);

        // Person.<init>, Registry.register and the Person constructor's getName
        // are not guaranteed names; assert on what must NOT be there and on what must.
        assertTrue(events.stream().noneMatch(e -> "toString".equals(e.get("method").asText())),
                "toString() was called by the tracer, not by the program:\n" + dump);
        assertTrue(events.stream().noneMatch(e -> "getName".equals(e.get("method").asText())),
                "getName() runs only inside toString() here:\n" + dump);
        assertTrue(events.stream().anyMatch(e -> "register".equals(e.get("method").asText())
                        && "enter".equals(e.get("event").asText())),
                "the real call is still traced:\n" + dump);
        // The rendered text still reaches the trace.
        assertTrue(dump.contains("Person[ada]"), "toString() output is still recorded:\n" + dump);
        // Depth stays balanced: a suppressed call must not shift its neighbours.
        for (JsonNode e : events) {
            if ("register".equals(e.get("method").asText())) assertEquals(0, e.get("depth").asInt(), dump);
        }
    }
}
