/**
 * FlowTrace v2 benchmark — 10k hot-loop, add() calls _validate() each iteration.
 * Class in com.example.bench package (compiled without package dir for harness simplicity).
 * Used by benchmarks/run-bench.sh for both baseline and instrumented runs.
 */
public class Bench {

    private static void _validate(int x) {
        if (x < 0) throw new IllegalArgumentException("negative: " + x);
    }

    public static int add(int x, int y) {
        _validate(x);
        return x + y;
    }

    public static void runHotLoop() {
        int acc = 0;
        for (int i = 0; i < 10_000; i++) {
            acc += add(i, 1);
        }
        // Prevent dead-code elimination.
        if (acc < 0) System.out.println("unreachable:" + acc);
    }

    public static void main(String[] args) {
        // Warm-up (not measured).
        for (int i = 0; i < 500; i++) {
            add(i, 1);
        }

        long start = System.nanoTime();
        runHotLoop();
        long end = System.nanoTime();

        // Nanoseconds, not milliseconds: an uninstrumented 10k loop of add()
        // takes well under 1 ms, so a millisecond reading is 0 and every derived
        // figure (overhead %, per-event cost) collapses to garbage.
        System.out.println("BENCH_RESULT_NS=" + (end - start));
    }
}
