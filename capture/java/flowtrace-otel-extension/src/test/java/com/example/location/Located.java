package com.example.location;

/**
 * Fixture for the {@code file} / {@code line} of enter events. The tests find
 * each expected line by its {@code // @line:<key>} marker rather than by
 * number, so editing this file cannot silently move the expectation — but each
 * marker must stay on the FIRST statement of its method's body.
 */
public class Located {

    public String describe(int value) {
        String text = "int:" + value; // @line:describe(I)
        return text;
    }

    // Deliberately far from the overload above, with a signature spread over
    // several lines: `line` is the first line of the body, not the line of the
    // declaration and not that of the caller.
    public String describe(
            String value
    ) {
        String text = "string:" + value; // @line:describe(String)
        return text;
    }

    public String viaNested() {
        return new Inner().ping() + anonymous().get(); // @line:viaNested
    }

    private java.util.function.Supplier<String> anonymous() {
        return new java.util.function.Supplier<String>() { // @line:anonymous
            @Override
            public String get() {
                return "anon"; // @line:get
            }
        };
    }

    /** Compiles to {@code Located$Inner.class}; its SourceFile is still Located.java. */
    public static class Inner {
        public String ping() {
            return "pong"; // @line:ping
        }
    }
}
