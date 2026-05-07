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

    public static void main(String[] args) {
        System.out.println(new Calculator().run());
    }
}
