package com.example.golden;

import java.util.concurrent.CountDownLatch;

/**
 * Minimal Java 21 sample for the virtual-thread FlowTrace regression test.
 * Call tree: run() starts a virtual thread whose body calls onVirtualThread().
 * No FlowTrace imports / annotations: zero source modification is the v2 contract.
 */
public class VirtualThreadRunner {

    public void run() throws InterruptedException {
        CountDownLatch latch = new CountDownLatch(1);
        Thread.ofVirtual().start(() -> {
            onVirtualThread();
            latch.countDown();
        });
        latch.await();
    }

    public void onVirtualThread() {
        // Body only needs to exist and be instrumented — the call path across
        // the Thread.ofVirtual() boundary is what's under test.
    }

    public static void main(String[] args) throws InterruptedException {
        new VirtualThreadRunner().run();
    }
}
