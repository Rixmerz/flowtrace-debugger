package io.flowtrace.advice;

import io.flowtrace.emitter.JsonFragment;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Method;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * How {@link FlowtraceAdvice#buildArgs(Method, Object[])} keys and renders
 * arguments. Test sources are compiled with {@code -parameters} (see
 * pom.xml) so {@link Fixture} carries real names; main sources are not, so
 * a method from {@link FlowtraceAdvice} itself pins the {@code argN}
 * fallback. Both preconditions are asserted, not assumed: if either compile
 * flag changes, the test says so instead of passing vacuously.
 */
class FlowtraceAdviceArgsTest {

    @AfterEach
    void clear() {
        System.clearProperty("flowtrace.max-arg-length");
    }

    /** Compiled with -parameters. */
    @SuppressWarnings("unused")
    static final class Fixture {
        public static void login(String username, String password, int attempt) {}
        public static void fetch(String targetUrl, Map<String, Object> headers) {}
        public static void plain(Object first, Object second) {}
    }

    private static Method method(Class<?> owner, String name) {
        for (Method m : owner.getDeclaredMethods()) {
            if (m.getName().equals(name)) return m;
        }
        throw new AssertionError("no method " + name);
    }

    @Test
    void realParameterNamesAreUsedWhenTheClassWasCompiledWithParameters() {
        Method login = method(Fixture.class, "login");
        assertTrue(login.getParameters()[0].isNamePresent(),
                "test sources must be compiled with -parameters (pom.xml default-testCompile)");

        Map<String, Object> args = FlowtraceAdvice.buildArgs(login, new Object[]{"bob", "hunter2", 3});
        assertEquals("[username, password, attempt]", args.keySet().toString());
        assertEquals("\"bob\"", args.get("username").toString());
        assertEquals("3", args.get("attempt").toString());
    }

    @Test
    void namedParametersAreRedactedByName() {
        Method login = method(Fixture.class, "login");
        Map<String, Object> args = FlowtraceAdvice.buildArgs(login, new Object[]{"bob", "hunter2", 3});
        assertEquals("\"<redacted>\"", args.get("password").toString());

        Method fetch = method(Fixture.class, "fetch");
        Map<String, Object> f = FlowtraceAdvice.buildArgs(fetch,
                new Object[]{"https://x", java.util.Collections.singletonMap("Authorization", "Bearer t")});
        assertEquals("\"<redacted>\"", f.get("targetUrl").toString(), "'url' is a substring of targetUrl");
        assertEquals("{\"Authorization\":\"<redacted>\"}", f.get("headers").toString());
    }

    @Test
    void argNFallbackWhenNamesAreAbsent() throws Exception {
        Method noNames = FlowtraceAdvice.class.getMethod("extractModule", String.class);
        assertFalse(noNames.getParameters()[0].isNamePresent(),
                "main sources must NOT be compiled with -parameters, or this test no longer pins the fallback");

        Map<String, Object> args = FlowtraceAdvice.buildArgs(noNames, new Object[]{"com.example.Foo"});
        assertEquals("[arg0]", args.keySet().toString());
        assertEquals("\"com.example.Foo\"", args.get("arg0").toString());
    }

    @Test
    void nullMethodAndArityMismatchFallBackToArgN() {
        Map<String, Object> noMethod = FlowtraceAdvice.buildArgs(null, new Object[]{1, 2});
        assertEquals("[arg0, arg1]", noMethod.keySet().toString());

        Method login = method(Fixture.class, "login");
        Map<String, Object> mismatch = FlowtraceAdvice.buildArgs(login, new Object[]{1});
        assertEquals("[arg0]", mismatch.keySet().toString());

        assertTrue(FlowtraceAdvice.buildArgs(login, null).isEmpty());
        assertNull(FlowtraceAdvice.parameterNames(null, 0));
    }

    @Test
    void oneHostileArgumentCostsOnlyItself() {
        Object bomb = new Object() {
            @Override public String toString() { throw new RuntimeException("no"); }
        };
        Method plain = method(Fixture.class, "plain");
        Map<String, Object> args = FlowtraceAdvice.buildArgs(plain, new Object[]{bomb, "ok"});
        assertEquals(2, args.size());
        assertTrue(args.get("first").toString().startsWith("\"<unserializable: "), args.toString());
        assertEquals("\"ok\"", args.get("second").toString());
    }

    @Test
    void valuesArriveAsRenderedFragmentsSoTheEmitterWritesThemVerbatim() {
        System.setProperty("flowtrace.max-arg-length", "16");
        Method plain = method(Fixture.class, "plain");
        Map<String, Object> args = FlowtraceAdvice.buildArgs(plain, new Object[]{"y".repeat(100), new int[]{1, 2}});
        assertTrue(args.get("first") instanceof JsonFragment);
        assertEquals("\"<truncated:\\\"" + "y".repeat(15) + "...>\"", args.get("first").toString());
        assertEquals("[1,2]", args.get("second").toString());
    }
}
