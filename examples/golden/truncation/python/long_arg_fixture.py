"""Truncation golden fixture — Python.
Calls a function with a 1000-char string argument.
When run with FLOWTRACE_MAX_ARG_LENGTH=64, the arg must appear truncated in JSONL.
"""


def process(data: str) -> str:
    return f"processed:{len(data)}"


def main() -> None:
    long_arg = "x" * 1000
    result = process(long_arg)
    print(f"result={result}")


if __name__ == "__main__":
    main()
