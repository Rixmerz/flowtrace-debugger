package io.flowtrace.extension;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

/**
 * Where one class's methods are declared, read from its class file: the
 * source file ({@code file}) and, per method, the first line of its body
 * ({@code line}). These become the {@code file} / {@code line} of every
 * {@code enter} event, which is how a static indexer joins a runtime span to
 * the symbol that declares the method.
 *
 * <h2>Why this is resolved at weave time, and why that is safe</h2>
 *
 * <p>The advice runs on every traced call, so the location must cost nothing
 * there. It is therefore resolved once per class, while the agent is
 * transforming it, and bound into the advice as two constants
 * ({@link SourceLocationMapping}): the woven method carries an {@code ldc} of
 * its own file and line, with no lookup, no map and no reflection at runtime.
 * The alternatives were worse on both axes:
 * <ul>
 *   <li>A stack frame captured on a method's first call
 *       ({@code StackWalker}) reports the line being <em>executed</em>, and
 *       inlined enter advice sits before the method's first line-table entry
 *       — the JVM has no line for it. It would also need a per-call cache
 *       lookup.</li>
 *   <li>A lookup table filled here and read by the advice cannot work as a
 *       plain static: this code runs in the agent's extension classloader,
 *       the advice's helpers are injected into the application's, and the two
 *       would each see their own copy of the table.</li>
 * </ul>
 *
 * <p>The class file is parsed by hand rather than with ASM. The OTel agent
 * ships ByteBuddy with ASM under {@code org.objectweb.asm}, the ByteBuddy
 * artifact this module compiles against relocates it to
 * {@code net.bytebuddy.jar.asm}, so code written against either name fails to
 * link under the other. The slice of the format needed — constant pool,
 * {@code SourceFile}, each method's {@code LineNumberTable} — is small and
 * has been stable since JDK 1.0.2, and a parser with no dependencies cannot
 * be broken by an agent upgrade.
 *
 * <p>The bytes come from the defining loader's own {@code .class} resource,
 * the same place ByteBuddy's type pool reads them from during this very
 * transformation. Anything that cannot be read or parsed — a class generated
 * at runtime, a truncated file, a format this does not understand — yields
 * {@link #UNKNOWN}, and the event simply carries no location: an absent
 * {@code file} costs a consumer one unjoined span, a wrong one joins the span
 * to the wrong symbol. Nothing here ever throws into the transformation.
 *
 * <h2>The hand-off to the advice mapping</h2>
 *
 * <p>ByteBuddy resolves an advice parameter from the instrumented type's
 * <em>description</em>, which has neither the classloader nor the bytes. So
 * {@link FlowtraceTypeInstrumentation} registers a transformer ahead of the
 * advice that reads the locations — it is handed the loader — and
 * {@linkplain #publish publishes} them to a thread-local that
 * {@link SourceLocationMapping} reads back. This relies on two properties of
 * {@code AgentBuilder}: the transformers of one type run in registration
 * order, and the class is then built, all on the thread that is defining the
 * class. The entry is keyed by class name and overwritten on every
 * transformation, and the reader rejects an entry for any other class, so a
 * broken assumption degrades to "no location" rather than to another class's.
 * A thread-local rather than a shared map because two loaders can define
 * same-named classes concurrently; per thread there is exactly one class in
 * flight.
 */
final class SourceLocations {

    /** Nothing known: no {@code file}, no lines. */
    static final SourceLocations UNKNOWN = new SourceLocations(null, null, Collections.<String, Integer>emptyMap());

    private static final ThreadLocal<Object[]> CURRENT = new ThreadLocal<>();

    /** Internal name the parsed bytes declare; null for {@link #UNKNOWN}. */
    private final String declaredName;
    private final String file;
    private final Map<String, Integer> firstLines;

    private SourceLocations(String declaredName, String file, Map<String, Integer> firstLines) {
        this.declaredName = declaredName;
        this.file = file;
        this.firstLines = firstLines;
    }

    /**
     * Package path + {@code SourceFile}, POSIX separators, relative to the
     * source root; {@code null} when the class has no {@code SourceFile}.
     */
    String file() {
        return file;
    }

    /**
     * First line of the body of the method with this name and JVM descriptor
     * (overloads differ by descriptor), or {@code 0} when unknown. Always
     * {@code 0} when {@link #file()} is {@code null}: a line with no file to
     * resolve it in is noise.
     */
    int firstLine(String methodName, String descriptor) {
        Integer line = firstLines.get(methodName + descriptor);
        return line == null ? 0 : line;
    }

    // ---- hand-off (see class comment) ----

    static void publish(String className, SourceLocations locations) {
        CURRENT.set(new Object[] {className, locations});
    }

    static SourceLocations current(String className) {
        Object[] entry = CURRENT.get();
        if (entry == null || !entry[0].equals(className)) return UNKNOWN;
        return (SourceLocations) entry[1];
    }

    // ---- reading ----

    /** @param internalName {@code com/acme/Outer$Inner} */
    static SourceLocations read(ClassLoader loader, String internalName) {
        try {
            String resource = internalName + ".class";
            InputStream in = loader != null
                    ? loader.getResourceAsStream(resource)
                    : ClassLoader.getSystemResourceAsStream(resource);
            if (in == null) return UNKNOWN;
            try {
                ByteArrayOutputStream out = new ByteArrayOutputStream(8192);
                byte[] chunk = new byte[8192];
                for (int n; (n = in.read(chunk)) > 0; ) out.write(chunk, 0, n);
                SourceLocations parsed = parse(out.toByteArray());
                // A loader that answered with some other class's bytes (a
                // relocating one, say) is not describing this class's lines.
                return internalName.equals(parsed.declaredName) ? parsed : UNKNOWN;
            } finally {
                in.close();
            }
        } catch (Throwable t) {
            return UNKNOWN;
        }
    }

    /** Never throws: unparseable bytes are {@link #UNKNOWN}. */
    static SourceLocations parse(byte[] classFile) {
        try {
            return doParse(ByteBuffer.wrap(classFile));
        } catch (Throwable t) {
            // BufferUnderflowException, a bad index, a constant-pool tag from
            // a class-file version newer than this parser.
            return UNKNOWN;
        }
    }

    private static SourceLocations doParse(ByteBuffer b) {
        if (b.getInt() != 0xCAFEBABE) return UNKNOWN;
        b.getInt(); // minor, major

        // Constant pool. Only Utf8 offsets and Class name indexes are kept.
        int cpCount = b.getShort() & 0xFFFF;
        int[] utf8At = new int[cpCount];
        int[] classNameIndex = new int[cpCount];
        for (int i = 1; i < cpCount; i++) {
            int tag = b.get() & 0xFF;
            switch (tag) {
                case 1: // Utf8
                    utf8At[i] = b.position();
                    skip(b, 2 + (b.getShort(b.position()) & 0xFFFF));
                    break;
                case 7: // Class
                    classNameIndex[i] = b.getShort() & 0xFFFF;
                    break;
                case 8: case 16: case 19: case 20: // String, MethodType, Module, Package
                    skip(b, 2);
                    break;
                case 15: // MethodHandle
                    skip(b, 3);
                    break;
                case 3: case 4: case 9: case 10: case 11: case 12: case 17: case 18:
                    skip(b, 4);
                    break;
                case 5: case 6: // Long, Double take two slots
                    skip(b, 8);
                    i++;
                    break;
                default:
                    return UNKNOWN;
            }
        }

        b.getShort(); // access_flags
        String thisClass = utf8(b, utf8At, classNameIndex[b.getShort() & 0xFFFF]);
        b.getShort(); // super_class
        skip(b, 2 * (b.getShort() & 0xFFFF)); // interfaces

        int fields = b.getShort() & 0xFFFF;
        for (int i = 0; i < fields; i++) {
            skip(b, 6);
            skipAttributes(b);
        }

        Map<String, Integer> firstLines = new HashMap<>();
        int methods = b.getShort() & 0xFFFF;
        for (int i = 0; i < methods; i++) {
            b.getShort(); // access_flags
            String name = utf8(b, utf8At, b.getShort() & 0xFFFF);
            String descriptor = utf8(b, utf8At, b.getShort() & 0xFFFF);
            int line = 0;
            int attributes = b.getShort() & 0xFFFF;
            for (int a = 0; a < attributes; a++) {
                String attribute = utf8(b, utf8At, b.getShort() & 0xFFFF);
                int end = b.getInt() + b.position();
                if ("Code".equals(attribute)) line = firstLineOfCode(b, utf8At);
                b.position(end);
            }
            if (line > 0) firstLines.put(name + descriptor, line);
        }

        String sourceFile = null;
        int attributes = b.getShort() & 0xFFFF;
        for (int a = 0; a < attributes; a++) {
            String attribute = utf8(b, utf8At, b.getShort() & 0xFFFF);
            int end = b.getInt() + b.position();
            if ("SourceFile".equals(attribute)) sourceFile = utf8(b, utf8At, b.getShort() & 0xFFFF);
            b.position(end);
        }

        // SourceFile is specified as a bare file name. A generator that wrote
        // a path there has left us unable to say where the package directory
        // ends, so that is "unknown", not something to stitch together.
        if (sourceFile == null || sourceFile.isEmpty()
                || sourceFile.indexOf('/') >= 0 || sourceFile.indexOf('\\') >= 0) {
            return new SourceLocations(thisClass, null, Collections.<String, Integer>emptyMap());
        }
        // Nested, local, anonymous and lambda-holding classes share the
        // package of their outermost class, and SourceFile already names that
        // class's file, so the package directory is all the name contributes.
        int slash = thisClass.lastIndexOf('/');
        String file = slash < 0 ? sourceFile : thisClass.substring(0, slash + 1) + sourceFile;
        return new SourceLocations(thisClass, file, firstLines);
    }

    /**
     * The line of the lowest {@code start_pc} across the method's
     * {@code LineNumberTable}s: the first line executed, which for javac is
     * the first statement of the body. Not the smallest line number — a
     * compiler is free to place a later statement's code first only by also
     * giving it the lower pc, and "first executed" is what the schema asks of
     * a layer that sees bytecode only. Positioned just after the attribute
     * length of a {@code Code} attribute.
     */
    private static int firstLineOfCode(ByteBuffer b, int[] utf8At) {
        skip(b, 4); // max_stack, max_locals
        skip(b, b.getInt()); // code
        skip(b, 8 * (b.getShort() & 0xFFFF)); // exception_table
        int line = 0;
        int lowestPc = Integer.MAX_VALUE;
        int attributes = b.getShort() & 0xFFFF;
        for (int a = 0; a < attributes; a++) {
            String attribute = utf8(b, utf8At, b.getShort() & 0xFFFF);
            int end = b.getInt() + b.position();
            if ("LineNumberTable".equals(attribute)) {
                int entries = b.getShort() & 0xFFFF;
                for (int e = 0; e < entries; e++) {
                    int pc = b.getShort() & 0xFFFF;
                    int entryLine = b.getShort() & 0xFFFF;
                    if (pc < lowestPc && entryLine > 0) {
                        lowestPc = pc;
                        line = entryLine;
                    }
                }
            }
            b.position(end);
        }
        return line;
    }

    private static void skipAttributes(ByteBuffer b) {
        int attributes = b.getShort() & 0xFFFF;
        for (int a = 0; a < attributes; a++) {
            b.getShort();
            skip(b, b.getInt());
        }
    }

    private static void skip(ByteBuffer b, int bytes) {
        if (bytes < 0) throw new IllegalArgumentException("negative length");
        b.position(b.position() + bytes);
    }

    /**
     * The names read here — attribute names, a class name, a file name, method
     * names and descriptors — are compared with or emitted as ordinary
     * strings. Class files store "modified UTF-8", which differs from UTF-8
     * only for U+0000 and for characters outside the BMP; a name containing
     * either would decode differently, which at worst fails to match and
     * leaves that one location unknown.
     */
    private static String utf8(ByteBuffer b, int[] utf8At, int index) {
        int at = utf8At[index];
        if (at == 0) throw new IllegalArgumentException("not a Utf8 constant: " + index);
        int length = b.getShort(at) & 0xFFFF;
        return new String(b.array(), b.arrayOffset() + at + 2, length, StandardCharsets.UTF_8);
    }
}
