"""Error-path golden fixture — Python.

Two traced frames deep so the fixture asserts more than "a throw is recorded":
inner() raises, outer() does not catch, so BOTH exit events must carry the
error. An agent that only tagged the frame where the throw originated would
still pass a single-frame fixture.

The try/except sits at module level, outside any traced function, so the
process exits 0 and the trace contains exactly two enter/exit pairs.
"""


def inner(n: int) -> int:
    raise ValueError(f"inner refused {n}")


def outer(n: int) -> int:
    return inner(n)


if __name__ == "__main__":
    try:
        outer(7)
    except ValueError as exc:
        print(f"caught: {exc}")
