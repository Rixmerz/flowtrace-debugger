"""Minimal Python sample for FlowTrace v2 golden fixture.

# This fixture also covers two shapes it originally missed, each of which hid a
# real schema violation in one of the layers for an entire release:
#   - a PLAIN function (no enclosing class), which must emit class:""
#   - an ERROR exit, which must carry both a top-level `error` and the required
#     `result` field.


Call tree: run() -> add(a,b) -> _validate(x) (name-mangled private convention).
No FlowTrace imports / decorators: zero source modification is the v2 contract.
"""


class Calculator:
    def run(self) -> int:
        return self.add(2, 3)

    def add(self, a: int, b: int) -> int:
        self._validate(a)
        self._validate(b)
        return a + b

    def _validate(self, x: int) -> None:
        if x < 0:
            raise ValueError(f"negative: {x}")


def describe(label: str) -> str:
    """Plain function: exercises class:"" (no enclosing class)."""
    return f"calc:{label}"


def must_fail() -> None:
    """Error path: exercises the exit event's `error` + `result` shape."""
    raise TypeError("golden failure")


if __name__ == "__main__":
    print(Calculator().run())
    print(describe("golden"))
    try:
        must_fail()
    except TypeError:
        # Swallowed on purpose: the fixture must exit 0 so the harness can
        # compare its output, while still producing an error exit event.
        pass
