package io.flowtrace.runner;

import com.example.golden.Calculator;

/**
 * Entry-point for the FlowTrace integration test.
 *
 * This class lives in {@code io.flowtrace.runner}, which is intentionally
 * outside the instrumented prefix {@code com.example.golden}. That way only
 * the four Calculator methods (run, add, validate, validate) are captured,
 * producing exactly 8 JSONL lines (4 enter + 4 exit).
 */
public class CalcRunner {
    public static void main(String[] args) {
        int result = new Calculator().run();
        System.out.println(result);
    }
}
