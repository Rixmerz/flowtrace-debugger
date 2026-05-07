package com.example.golden;

/**
 * Thin entry-point used only by the integration test.
 * Calls Calculator.run() directly so the captured call tree is:
 *   run -> add -> validate(2), validate(3)
 * without a wrapping main() frame in the trace.
 */
public class CalcRunner {
    public static void main(String[] args) {
        int result = new Calculator().run();
        System.out.println(result);
    }
}
