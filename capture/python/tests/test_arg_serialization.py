"""Argument serialization for values JSON cannot represent.

Two of these were severe rather than cosmetic:

- ``json.dumps`` emits bare ``NaN`` / ``Infinity``. Python's own parser accepts
  them as a non-standard extension, but they are NOT valid JSON — and every
  consumer in this repository is JavaScript. ``JSON.parse`` rejects both, so a
  single non-finite float invalidated the entire event line for the MCP server,
  the dashboard analyzer and the schema validator alike.

- ``_to_json_safe`` recursed unconditionally, so a structure containing a
  reference to itself raised ``RecursionError`` *inside the traced program*.
  Instrumentation crashing the program it observes is the worst available outcome,
  and self-referential structures are ordinary: parent/child trees, ORM
  back-references, self-referential config.
"""

from __future__ import annotations

import json
import math

from flowtrace_runtime.runtime import _MAX_DEPTH, _to_json_safe


def _roundtrips(value) -> bool:
    """True if a JavaScript consumer could parse this value."""
    text = json.dumps({"v": value})
    # allow_nan=False is what a strict (JavaScript) parser enforces.
    try:
        json.dumps({"v": value}, allow_nan=False)
    except ValueError:
        return False
    return isinstance(json.loads(text), dict)


def test_scalars_pass_through():
    assert _to_json_safe(None) is None
    assert _to_json_safe(True) is True
    assert _to_json_safe(7) == 7
    assert _to_json_safe(1.5) == 1.5
    assert _to_json_safe("s") == "s"


def test_non_finite_floats_become_strings_not_invalid_json():
    assert _to_json_safe(float("nan")) == "NaN"
    assert _to_json_safe(float("inf")) == "Infinity"
    assert _to_json_safe(float("-inf")) == "-Infinity"

    # The consequence being guarded: the raw floats do not survive a strict
    # parser, the strings do.
    assert not _roundtrips(float("nan"))
    assert _roundtrips(_to_json_safe(float("nan")))
    assert _roundtrips(_to_json_safe(float("inf")))


def test_nested_non_finite_floats_are_also_converted():
    out = _to_json_safe({"a": [float("nan"), {"b": float("inf")}]})
    assert out == {"a": ["NaN", {"b": "Infinity"}]}
    assert _roundtrips(out)


def test_self_referential_dict_does_not_recurse_forever():
    d = {"n": 1}
    d["self"] = d
    # Before cycle detection this raised RecursionError and took the traced
    # program down with it.
    assert _to_json_safe(d) == {"n": 1, "self": "<circular>"}


def test_self_referential_list_does_not_recurse_forever():
    items: list = [1]
    items.append(items)
    assert _to_json_safe(items) == [1, "<circular>"]


def test_mutually_referential_structures_terminate():
    a: dict = {"name": "a"}
    b: dict = {"name": "b", "peer": a}
    a["peer"] = b
    out = _to_json_safe(a)
    assert out["name"] == "a"
    assert out["peer"]["name"] == "b"
    assert out["peer"]["peer"] == "<circular>"


def test_a_repeated_value_in_sibling_branches_is_not_called_circular():
    # `seen` is threaded per path, not shared across the whole walk. A DAG is not
    # a cycle, and reporting it as one would lose real data.
    shared = {"shared": True}
    out = _to_json_safe({"left": shared, "right": shared})
    assert out == {"left": {"shared": True}, "right": {"shared": True}}


def test_deeply_nested_acyclic_structure_is_capped():
    # Cycle detection alone does not bound the walk.
    deep: dict = {}
    node = deep
    for _ in range(_MAX_DEPTH + 5):
        node["next"] = {}
        node = node["next"]

    out = _to_json_safe(deep)
    text = json.dumps(out)
    assert "max depth" in text
    assert _roundtrips(out)


def test_unknown_objects_fall_back_to_repr():
    class Point:
        def __init__(self):
            self.x = 1

    out = _to_json_safe(Point())
    assert isinstance(out, str) and "Point" in out


def test_exceptions_serialize_informatively():
    # Passing an exception as an argument is common; it must not vanish.
    out = _to_json_safe(ValueError("boom"))
    assert isinstance(out, str)
    assert "ValueError" in out and "boom" in out


def test_sets_serialize_informatively():
    out = _to_json_safe({1, 2})
    assert isinstance(out, str)
    assert "1" in out and "2" in out
