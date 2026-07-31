package io.flowtrace.advice;

import org.junit.jupiter.api.Test;

import java.lang.reflect.Modifier;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Java access modifiers must map onto the schema's visibility enum.
 *
 * <p>The enum is {@code public | private | internal | unknown}. This used to
 * return {@code "protected"} verbatim — not a permitted value — so every event
 * from a protected method was schema-invalid. Protected methods are everywhere in
 * Java: template methods, and anything extending a framework base class.
 *
 * <p>The critical assertion is not which value protected maps to, but that no
 * modifier can produce a value outside the enum. That is the shape of the bug.
 */
class VisibilityMappingTest {

    /** The only values schema/flowtrace-v2.json permits for `visibility`. */
    private static final Set<String> PERMITTED =
            Set.of("public", "private", "internal", "unknown");

    @Test
    void publicAndPrivateMapDirectly() {
        assertEquals("public", FlowtraceAdvice.visibilityFromModifiers(Modifier.PUBLIC));
        assertEquals("private", FlowtraceAdvice.visibilityFromModifiers(Modifier.PRIVATE));
    }

    @Test
    void protectedMapsToInternalRatherThanLeakingProtected() {
        // The regression: "protected" is not in the enum.
        assertEquals("internal", FlowtraceAdvice.visibilityFromModifiers(Modifier.PROTECTED));
    }

    @Test
    void packagePrivateMapsToInternal() {
        // No modifier bits set at all.
        assertEquals("internal", FlowtraceAdvice.visibilityFromModifiers(0));
    }

    @Test
    void noModifierCombinationEscapesTheSchemaEnum() {
        // Exhaustive over the access bits and their realistic companions, rather
        // than over the four cases the mapping happens to branch on — a future
        // edit that adds a branch must still land inside the enum.
        int[] accessBits = { Modifier.PUBLIC, Modifier.PRIVATE, Modifier.PROTECTED, 0 };
        int[] companions = {
                0, Modifier.STATIC, Modifier.FINAL, Modifier.SYNCHRONIZED,
                Modifier.ABSTRACT, Modifier.NATIVE, Modifier.STRICT,
                Modifier.STATIC | Modifier.FINAL,
        };

        for (int access : accessBits) {
            for (int companion : companions) {
                String visibility = FlowtraceAdvice.visibilityFromModifiers(access | companion);
                assertTrue(
                        PERMITTED.contains(visibility),
                        "modifiers " + Modifier.toString(access | companion)
                                + " produced \"" + visibility + "\", which is not in the schema enum"
                );
            }
        }
    }

    @Test
    void companionModifiersDoNotChangeTheAccessLevel() {
        // A `public static final` method is still public.
        assertEquals(
                "public",
                FlowtraceAdvice.visibilityFromModifiers(
                        Modifier.PUBLIC | Modifier.STATIC | Modifier.FINAL)
        );
        assertEquals(
                "private",
                FlowtraceAdvice.visibilityFromModifiers(Modifier.PRIVATE | Modifier.STATIC)
        );
        assertEquals(
                "internal",
                FlowtraceAdvice.visibilityFromModifiers(Modifier.PROTECTED | Modifier.ABSTRACT)
        );
    }
}
