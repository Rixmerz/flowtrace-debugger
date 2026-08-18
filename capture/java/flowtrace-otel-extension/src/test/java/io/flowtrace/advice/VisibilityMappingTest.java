package io.flowtrace.advice;

import org.junit.jupiter.api.Test;

import java.lang.reflect.Modifier;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * The schema's visibility enum is public | private | internal | unknown.
 * Anything else makes the event invalid, and no golden fixture declares a
 * protected method, so only a direct test catches it.
 */
class VisibilityMappingTest {

    /** Every value the schema accepts. */
    private static final Set<String> ALLOWED = Set.of("public", "private", "internal", "unknown");

    @Test
    void publicMethodsMapToPublic() {
        assertEquals("public", FlowtraceAdvice.visibilityFromModifiers(Modifier.PUBLIC));
    }

    @Test
    void privateMethodsMapToPrivate() {
        assertEquals("private", FlowtraceAdvice.visibilityFromModifiers(Modifier.PRIVATE));
    }

    @Test
    void protectedMapsToInternal() {
        // It used to return "protected", a value the schema rejects outright.
        assertEquals("internal", FlowtraceAdvice.visibilityFromModifiers(Modifier.PROTECTED));
    }

    @Test
    void packagePrivateMapsToInternal() {
        assertEquals("internal", FlowtraceAdvice.visibilityFromModifiers(0));
    }

    @Test
    void noModifierCombinationEscapesTheSchemaEnum() {
        // Exhaustive over the access modifiers and the common flags they pair
        // with, so a future branch cannot introduce another invalid value.
        int[] access = {Modifier.PUBLIC, Modifier.PRIVATE, Modifier.PROTECTED, 0};
        int[] extras = {0, Modifier.STATIC, Modifier.FINAL, Modifier.SYNCHRONIZED,
                        Modifier.ABSTRACT, Modifier.NATIVE,
                        Modifier.STATIC | Modifier.FINAL};
        for (int a : access) {
            for (int e : extras) {
                String v = FlowtraceAdvice.visibilityFromModifiers(a | e);
                assertTrue(ALLOWED.contains(v),
                        "visibility '" + v + "' is not in the schema enum for modifiers " + (a | e));
            }
        }
    }
}
