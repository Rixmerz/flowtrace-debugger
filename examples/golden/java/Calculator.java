package com.example.golden;

/**
 * Minimal Java sample for FlowTrace v2 golden fixture.
 * Call tree: run() -> add(a,b) -> _validate(x) (private).
 * No FlowTrace imports / annotations: zero source modification is the v2 contract.
 */
public class Calculator {

    public int run() {
        return add(2, 3);
    }

    public int add(int a, int b) {
        validate(a);
        validate(b);
        return a + b;
    }

    private void validate(int x) {
        if (x < 0) {
            throw new IllegalArgumentException("negative: " + x);
        }
    }

    /** Plain static method: still a class in Java, but exercises the error shape below. */
    static String describe(String label) {
        return "calc:" + label;
    }

    /** Error path: exercises the exit event's `error` + required `result` field. */
    static void mustFail() {
        throw new IllegalStateException("golden failure");
    }

    public static void main(String[] args) {
        System.out.println(new Calculator().run());
        System.out.println(describe("golden"));
        try {
            mustFail();
        } catch (IllegalStateException e) {
            // Swallowed on purpose: the fixture must exit 0 so the harness can
            // compare its output, while still producing an error exit event.
        }
    }
}
