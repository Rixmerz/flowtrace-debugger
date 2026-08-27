package io.flowtrace.runner;

import com.example.golden.VirtualThreadRunner;

/**
 * Entry-point for the virtual-thread FlowTrace integration test.
 *
 * Lives outside the instrumented prefix {@code com.example.golden}, same
 * convention as {@link CalcRunner}.
 */
public class VirtualThreadCalcRunner {
    public static void main(String[] args) throws InterruptedException {
        new VirtualThreadRunner().run();
    }
}
