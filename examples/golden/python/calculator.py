"""Minimal Python sample for FlowTrace v2 golden fixture.

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


if __name__ == "__main__":
    print(Calculator().run())
