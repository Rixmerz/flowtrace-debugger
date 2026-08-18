package io.flowtrace.emitter;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;

import static org.junit.jupiter.api.Assertions.*;

/**
 * The emitted JSONL must be valid regardless of the JVM's default locale.
 *
 * This is not a hypothetical: the agent runs inside the user's application, on
 * their machine, under their locale. In Chile, Spain, Germany, France, Brazil —
 * most of Europe and Latin America — the default decimal separator is a comma,
 * so an unlocalised String.format("%.3f") emits `"ts":1785481163,844` and every
 * line of the trace becomes unparseable. CI runs under an English locale, which
 * is exactly why this went unnoticed.
 */
class LocaleIndependenceTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private final Locale original = Locale.getDefault();

    @AfterEach
    void restoreLocale() {
        Locale.setDefault(original);
    }

    private TraceEvent sampleEvent() {
        TraceEvent e = new TraceEvent();
        e.setTs(1785481163.844);
        e.setTraceId("f10c17ace000000000000000000000a1");
        e.setSpanId("0000000000000001");
        e.setParentId(null);
        e.setEvent("exit");
        e.setThread("main");
        e.setModule("com.example");
        e.setClassName("Calculator");
        e.setMethod("add");
        e.setVisibility("public");
        e.setArgs(new LinkedHashMap<>());
        e.setResult(new LinkedHashMap<>());
        e.setDurationNs(1234L);
        e.setDepth(0);
        return e;
    }

    /** Every locale whose decimal separator is a comma is a landmine here. */
    @Test
    void emittedJsonlParsesUnderCommaDecimalLocales() throws Exception {
        Locale[] commaLocales = {
                new Locale("es", "CL"),   // Chile
                new Locale("es", "ES"),   // Spain
                Locale.GERMANY,
                Locale.FRANCE,
                new Locale("pt", "BR"),   // Brazil
        };

        for (Locale locale : commaLocales) {
            Locale.setDefault(locale);
            Path out = Files.createTempFile("flowtrace-locale-", ".jsonl");
            try {
                FlowtraceEmitter.resetForTesting();
                System.setProperty("flowtrace.output", out.toAbsolutePath().toString());
                FlowtraceEmitter.getInstance().emit(sampleEvent());
                FlowtraceEmitter.getInstance().close();

                List<String> lines = Files.readAllLines(out);
                assertFalse(lines.isEmpty(), "no event written under " + locale);
                for (String line : lines) {
                    if (line.isBlank()) continue;
                    // The assertion that matters: it must parse as JSON at all.
                    assertDoesNotThrow(() -> MAPPER.readTree(line),
                            "invalid JSON under locale " + locale + ": " + line);
                    assertTrue(MAPPER.readTree(line).get("ts").isNumber(),
                            "ts is not a number under locale " + locale + ": " + line);
                }
            } finally {
                Files.deleteIfExists(out);
                System.clearProperty("flowtrace.output");
            }
        }
    }

    @Test
    void tsKeepsItsDecimalPointNotAComma() throws Exception {
        Locale.setDefault(new Locale("es", "CL"));
        Path out = Files.createTempFile("flowtrace-locale-", ".jsonl");
        try {
            FlowtraceEmitter.resetForTesting();
            System.setProperty("flowtrace.output", out.toAbsolutePath().toString());
            FlowtraceEmitter.getInstance().emit(sampleEvent());
            FlowtraceEmitter.getInstance().close();

            String line = Files.readAllLines(out).get(0);
            assertTrue(line.contains("\"ts\":1785481163.844"),
                    "expected a decimal point in ts, got: " + line);
        } finally {
            Files.deleteIfExists(out);
            System.clearProperty("flowtrace.output");
        }
    }
}
