"""FlowTrace v2 benchmark — 10k hot-loop, add() calls _validate() each iteration."""
import sys
import time


def _validate(x: int) -> None:
    if x < 0:
        raise ValueError(f"negative: {x}")


def add(x: int, y: int) -> int:
    _validate(x)
    return x + y


def runHotLoop() -> None:
    acc = 0
    for i in range(10_000):
        acc += add(i, 1)
    # Prevent dead-code elimination.
    if acc < 0:
        print(f"unreachable:{acc}", file=sys.stderr)


def main() -> None:
    # Warm-up (not measured).
    for i in range(500):
        add(i, 1)

    start = time.perf_counter()
    runHotLoop()
    end = time.perf_counter()

    elapsed_ms = int((end - start) * 1000)
    print(f"BENCH_RESULT_MS={elapsed_ms}")


if __name__ == "__main__":
    main()
