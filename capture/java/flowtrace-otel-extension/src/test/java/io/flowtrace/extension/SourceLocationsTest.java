package io.flowtrace.extension;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import javax.tools.JavaCompiler;
import javax.tools.ToolProvider;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;

/**
 * The class-file reader behind the {@code file} / {@code line} of enter
 * events, on real javac output. The debug-info cases are compiled here, with
 * the flag under test, because the module's own test classes are all built
 * with full debug info.
 */
class SourceLocationsTest {

    // Line numbers below are positions in this string: line 1 is `package`.
    private static final String SOURCE = String.join("\n",
            "package com.acme.billing;",                          // 1
            "",                                                   // 2
            "public class InvoiceService {",                      // 3
            "    public int total(int cents) {",                  // 4
            "        return cents * 2;",                          // 5
            "    }",                                              // 6
            "",                                                   // 7
            "    public int total(",                              // 8
            "            String cents",                           // 9
            "    ) {",                                            // 10
            "        return Integer.parseInt(cents);",            // 11
            "    }",                                              // 12
            "",                                                   // 13
            "    public static class Line {",                     // 14
            "        public long amount() {",                     // 15
            "            return 42L;",                            // 16
            "        }",                                          // 17
            "    }",                                              // 18
            "",                                                   // 19
            "    public Runnable later() {",                      // 20
            "        return new Runnable() {",                    // 21
            "            @Override public void run() {",          // 22
            "                System.nanoTime();",                 // 23
            "            }",                                      // 24
            "        };",                                         // 25
            "    }",                                              // 26
            "",                                                   // 27
            "    public abstract static class Shape {",           // 28
            "        public abstract double area();",             // 29
            "    }",                                              // 30
            "}",                                                  // 31
            "");

    @Test
    void file_isPackagePathPlusSourceFile(@TempDir Path dir) throws Exception {
        SourceLocations outer = compile(dir, "-g", "InvoiceService");

        assertEquals("com/acme/billing/InvoiceService.java", outer.file());
    }

    @Test
    void overloads_getTheirOwnFirstBodyLine(@TempDir Path dir) throws Exception {
        SourceLocations outer = compile(dir, "-g", "InvoiceService");

        int ofInt = outer.firstLine("total", "(I)I");
        int ofString = outer.firstLine("total", "(Ljava/lang/String;)I");

        assertEquals(5, ofInt, "total(int): first line of the body, not the declaration on 4");
        assertEquals(11, ofString,
                "total(String): first line of the body, not the declaration spread over 8-10");
        assertNotEquals(ofInt, ofString, "overloads must not share a line");
    }

    @Test
    void nestedAndAnonymousClasses_reportTheOuterFile(@TempDir Path dir) throws Exception {
        SourceLocations nested = compile(dir, "-g", "InvoiceService$Line");
        SourceLocations anonymous = compile(dir, "-g", "InvoiceService$1");

        assertEquals("com/acme/billing/InvoiceService.java", nested.file());
        assertEquals(16, nested.firstLine("amount", "()J"));
        assertEquals("com/acme/billing/InvoiceService.java", anonymous.file());
        assertEquals(23, anonymous.firstLine("run", "()V"));
    }

    @Test
    void unknownMethodAndAbstractMethod_haveNoLine(@TempDir Path dir) throws Exception {
        SourceLocations outer = compile(dir, "-g", "InvoiceService");
        SourceLocations shape = compile(dir, "-g", "InvoiceService$Shape");

        assertEquals(0, outer.firstLine("total", "(J)I"), "no such overload");
        assertEquals(0, outer.firstLine("missing", "()V"));
        assertEquals(0, shape.firstLine("area", "()D"), "an abstract method has no Code attribute");
    }

    @Test
    void classCompiledWithoutDebugInfo_hasNeitherFileNorLine(@TempDir Path dir) throws Exception {
        SourceLocations none = compile(dir, "-g:none", "InvoiceService");

        assertNull(none.file(), "-g:none drops SourceFile; the file must not be guessed from the class name");
        assertEquals(0, none.firstLine("total", "(I)I"));
        assertEquals(0, none.firstLine("total", "(Ljava/lang/String;)I"));
    }

    @Test
    void classWithSourceFileButNoLineTable_hasFileOnly(@TempDir Path dir) throws Exception {
        SourceLocations sourceOnly = compile(dir, "-g:source", "InvoiceService");

        assertEquals("com/acme/billing/InvoiceService.java", sourceOnly.file());
        assertEquals(0, sourceOnly.firstLine("total", "(I)I"));
    }

    @Test
    void classWithLineTableButNoSourceFile_hasNoLineEither(@TempDir Path dir) throws Exception {
        SourceLocations linesOnly = compile(dir, "-g:lines", "InvoiceService");

        assertNull(linesOnly.file());
        assertEquals(0, linesOnly.firstLine("total", "(I)I"),
                "a line with no file to resolve it in must not be reported");
    }

    @Test
    void defaultPackageClass_fileIsTheBareSourceFile(@TempDir Path dir) throws Exception {
        Path source = dir.resolve("Bare.java");
        Files.write(source, "class Bare {\n    void go() {\n        System.nanoTime();\n    }\n}\n"
                .getBytes(StandardCharsets.UTF_8));
        javac(dir, "-g", source);

        SourceLocations bare = SourceLocations.parse(Files.readAllBytes(dir.resolve("Bare.class")));

        assertEquals("Bare.java", bare.file());
        assertEquals(3, bare.firstLine("go", "()V"));
    }

    @Test
    void garbageAndTruncatedBytes_areUnknown_notAnException(@TempDir Path dir) throws Exception {
        compile(dir, "-g", "InvoiceService");
        byte[] good = Files.readAllBytes(dir.resolve("com/acme/billing/InvoiceService.class"));

        assertSame(SourceLocations.UNKNOWN, SourceLocations.parse(new byte[0]));
        assertSame(SourceLocations.UNKNOWN, SourceLocations.parse("not a class file".getBytes(StandardCharsets.UTF_8)));
        // Every prefix: a parser that reads past the end must degrade, never throw.
        for (int length = 0; length < good.length; length += 7) {
            SourceLocations.parse(Arrays.copyOf(good, length));
        }
    }

    @Test
    void read_resolvesThroughTheClassLoader_andRejectsWhatItCannotFind() throws Exception {
        ClassLoader loader = getClass().getClassLoader();

        SourceLocations nested = SourceLocations.read(loader, "com/example/location/Located$Inner");
        assertEquals("com/example/location/Located.java", nested.file());

        assertSame(SourceLocations.UNKNOWN, SourceLocations.read(loader, "com/example/location/NoSuchClass"));

        // Bootstrap classes are reached with a null loader.
        try (InputStream in = ClassLoader.getSystemResourceAsStream("java/lang/String.class")) {
            assertNotNull(in, "precondition: the JDK exposes String.class as a resource");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            for (int n; (n = in.read(chunk)) > 0; ) out.write(chunk, 0, n);
            assertEquals("java/lang/String.java", SourceLocations.parse(out.toByteArray()).file());
        }
        assertEquals("java/lang/String.java", SourceLocations.read(null, "java/lang/String").file());
    }

    @Test
    void handOff_isPerClassName_soAStaleEntryIsNeverAnotherClasssLocation(@TempDir Path dir) throws Exception {
        SourceLocations outer = compile(dir, "-g", "InvoiceService");

        SourceLocations.publish("com.acme.billing.InvoiceService", outer);

        assertSame(outer, SourceLocations.current("com.acme.billing.InvoiceService"));
        assertSame(SourceLocations.UNKNOWN, SourceLocations.current("com.acme.billing.Other"),
                "an entry published for one class must not answer for another");

        Thread other = new Thread(() ->
                assertSame(SourceLocations.UNKNOWN, SourceLocations.current("com.acme.billing.InvoiceService")));
        Throwable[] failure = new Throwable[1];
        other.setUncaughtExceptionHandler((t, e) -> failure[0] = e);
        other.start();
        other.join();
        assertNull(failure[0], "the hand-off is thread-confined");
    }

    // ---- helpers ----

    /** Compiles {@link #SOURCE} with one debug flag and parses one of its class files. */
    private static SourceLocations compile(Path dir, String debugFlag, String binarySimpleName) throws IOException {
        Path source = dir.resolve("InvoiceService.java");
        Files.write(source, SOURCE.getBytes(StandardCharsets.UTF_8));
        javac(dir, debugFlag, source);
        return SourceLocations.parse(
                Files.readAllBytes(dir.resolve("com/acme/billing/" + binarySimpleName + ".class")));
    }

    private static void javac(Path dir, String debugFlag, Path source) {
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        assertNotNull(compiler, "these tests need a JDK, not a JRE");
        ByteArrayOutputStream diagnostics = new ByteArrayOutputStream();
        int status = compiler.run(null, null, diagnostics,
                debugFlag, "-d", dir.toString(), source.toString());
        assertEquals(0, status, "javac failed: " + diagnostics);
    }
}
