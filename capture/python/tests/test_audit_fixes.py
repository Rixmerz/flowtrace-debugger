"""Regression tests for docs/changes/2026-08-26-audit-fixes.md AC1-AC3.

Each test drives the exact repro described in that spec through a real
subprocess (matching the pattern in test_module_file.py) rather than calling
runtime internals in-process, because the Emitter is a per-process singleton
and __ft_enter/__ft_exit only run against instrumented (AST-rewritten) code.
"""
from __future__ import annotations

import json
import subprocess
import sys
import textwrap
from pathlib import Path

PY_PKG = Path(__file__).resolve().parents[1]
PY_STUB = PY_PKG / "stub"


def _run(tmp_path, main_source: str, module_source: str, extra_env: dict | None = None):
    """Writes demo_pkg/calc.py = module_source, main.py = main_source, runs
    main.py instrumented with FLOWTRACE_PACKAGE_PREFIX=demo_pkg."""
    pkg = tmp_path / "demo_pkg"
    pkg.mkdir()
    (pkg / "__init__.py").write_text("", encoding="utf-8")
    (pkg / "calc.py").write_text(textwrap.dedent(module_source), encoding="utf-8")

    main = tmp_path / "main.py"
    main.write_text(textwrap.dedent(main_source), encoding="utf-8")

    out_path = tmp_path / "trace.jsonl"
    env = {
        "PATH": "/usr/bin:/bin",
        "PYTHONPATH": f"{PY_STUB}:{PY_PKG}:{tmp_path}",
        "FLOWTRACE_ENABLE": "1",
        "FLOWTRACE_PACKAGE_PREFIX": "demo_pkg",
        "FLOWTRACE_OUTPUT": str(out_path),
    }
    if extra_env:
        env.update(extra_env)
    res = subprocess.run(
        [sys.executable, str(main)],
        capture_output=True, text=True, env=env, cwd=str(tmp_path), timeout=60,
    )
    events = []
    if out_path.exists():
        events = [json.loads(l) for l in out_path.read_text(encoding="utf-8").splitlines() if l.strip()]
    return res, events


# -- AC1: _ft_exit must never crash the traced process on a non-serializable
#    dict result -------------------------------------------------------------

def test_dict_result_with_non_serializable_value_does_not_crash(tmp_path):
    res, events = _run(tmp_path,
        main_source="""
            from demo_pkg import calc
            print("RESULT:", calc.make_thing())
        """,
        module_source="""
            class SomeObject:
                def __repr__(self):
                    return "SomeObject()"

            def make_thing():
                return {"x": SomeObject()}
        """,
    )
    assert res.returncode == 0, f"traced process crashed:\n{res.stderr}"
    assert "TypeError" not in res.stderr
    # Child process's own return value/output is unaffected.
    assert "RESULT: {'x': SomeObject()}" in res.stdout

    exits = [e for e in events if e["event"] == "exit" and e["method"] == "make_thing"]
    assert len(exits) == 1
    result = exits[0]["result"]
    assert result["x"] == "SomeObject()", f"expected json-safe repr, got {result!r}"


# -- AC2: a fresh stdlib __pycache__ must not silently disable instrumentation

def test_preexisting_pycache_does_not_disable_instrumentation(tmp_path):
    pkg = tmp_path / "demo_pkg"
    pkg.mkdir()
    (pkg / "__init__.py").write_text("", encoding="utf-8")
    (pkg / "calc.py").write_text(textwrap.dedent("""
        def add(a, b):
            return a + b
    """), encoding="utf-8")

    # 1. Plain, un-instrumented import — writes a normal __pycache__/*.pyc.
    plain_env = {"PATH": "/usr/bin:/bin", "PYTHONPATH": str(tmp_path)}
    r1 = subprocess.run(
        [sys.executable, "-c", "import demo_pkg.calc"],
        capture_output=True, text=True, env=plain_env, cwd=str(tmp_path), timeout=30,
    )
    assert r1.returncode == 0, r1.stderr
    assert (pkg / "__pycache__").exists(), "setup didn't produce a __pycache__ to test against"

    # 2. Same import, now instrumented — must still emit events despite the
    #    fresh stdlib pycache written in step 1.
    out_path = tmp_path / "trace.jsonl"
    ft_env = {
        "PATH": "/usr/bin:/bin",
        "PYTHONPATH": f"{PY_STUB}:{PY_PKG}:{tmp_path}",
        "FLOWTRACE_ENABLE": "1",
        "FLOWTRACE_PACKAGE_PREFIX": "demo_pkg",
        "FLOWTRACE_OUTPUT": str(out_path),
    }
    r2 = subprocess.run(
        [sys.executable, "-c", "import demo_pkg.calc; demo_pkg.calc.add(1, 2)"],
        capture_output=True, text=True, env=ft_env, cwd=str(tmp_path), timeout=30,
    )
    assert r2.returncode == 0, r2.stderr
    events = [json.loads(l) for l in out_path.read_text(encoding="utf-8").splitlines() if l.strip()] \
        if out_path.exists() else []
    assert len(events) > 0, "0 events captured for demo_pkg.calc despite a pre-existing __pycache__"
    assert any(e["method"] == "add" for e in events)


# -- AC3: default redaction of secret/PII-bearing arg names ------------------

def test_default_redact_keys_applied_when_env_unset(tmp_path):
    res, events = _run(tmp_path,
        main_source="""
            from demo_pkg import calc
            calc.connect(password="hunter2", url="mongodb://u:p@host/db", note="hello")
        """,
        module_source="""
            def connect(password, url, note):
                return note
        """,
    )
    assert res.returncode == 0, res.stderr
    enters = [e for e in events if e["event"] == "enter" and e["method"] == "connect"]
    assert len(enters) == 1
    args = enters[0]["args"]
    assert args["password"] == "<redacted>"
    assert args["url"] == "<redacted>"
    assert args["note"] == "hello", "non-matching arg must be untouched"
    # No secret leaked anywhere in the raw JSONL output.
    raw = "\n".join(json.dumps(e) for e in events)
    assert "hunter2" not in raw
    assert "u:p@host" not in raw


def test_redact_keys_env_extends_default_list(tmp_path):
    res, events = _run(tmp_path,
        main_source="""
            from demo_pkg import calc
            calc.connect(password="hunter2", custom_secret="s3kr3t")
        """,
        module_source="""
            def connect(password, custom_secret):
                return None
        """,
        extra_env={"FLOWTRACE_REDACT_KEYS": "custom_secret"},
    )
    assert res.returncode == 0, res.stderr
    enters = [e for e in events if e["event"] == "enter" and e["method"] == "connect"]
    args = enters[0]["args"]
    # FLOWTRACE_REDACT_KEYS adds to the default list, it does not replace it.
    assert args["password"] == "<redacted>"
    assert args["custom_secret"] == "<redacted>"


def test_redact_keys_recurse_into_nested_dict(tmp_path):
    """A redact-key nested inside a dict value (any depth) must also be
    caught, not just top-level arg names."""
    res, events = _run(tmp_path,
        main_source="""
            from demo_pkg import calc
            calc.connect(config={"password": "hunter2", "host": "db1"})
        """,
        module_source="""
            def connect(config):
                return None
        """,
    )
    assert res.returncode == 0, res.stderr
    enters = [e for e in events if e["event"] == "enter" and e["method"] == "connect"]
    assert len(enters) == 1
    config = enters[0]["args"]["config"]
    assert config["password"] == "<redacted>"
    assert config["host"] == "db1", "non-matching nested key must be untouched"
    raw = "\n".join(json.dumps(e) for e in events)
    assert "hunter2" not in raw


def test_redact_keys_recurse_two_levels_deep(tmp_path):
    res, events = _run(tmp_path,
        main_source="""
            from demo_pkg import calc
            calc.connect(config={"db": {"credentials": {"password": "hunter2"}, "name": "db1"}})
        """,
        module_source="""
            def connect(config):
                return None
        """,
    )
    assert res.returncode == 0, res.stderr
    enters = [e for e in events if e["event"] == "enter" and e["method"] == "connect"]
    creds = enters[0]["args"]["config"]["db"]["credentials"]
    assert creds["password"] == "<redacted>"
    assert enters[0]["args"]["config"]["db"]["name"] == "db1"
    raw = "\n".join(json.dumps(e) for e in events)
    assert "hunter2" not in raw


def test_email_redacted_by_default(tmp_path):
    """AC3 spec text calls out a default list of
    password,secret,token,authorization,api_key,url,dsn,connection_string —
    the real audit also found 129 raw email addresses leaked; "email" was
    added to the default list and must redact without any env var set."""
    res, events = _run(tmp_path,
        main_source="""
            from demo_pkg import calc
            calc.notify(email="alice@example.com", note="hello")
        """,
        module_source="""
            def notify(email, note):
                return note
        """,
    )
    assert res.returncode == 0, res.stderr
    enters = [e for e in events if e["event"] == "enter" and e["method"] == "notify"]
    assert enters[0]["args"]["email"] == "<redacted>"
    assert enters[0]["args"]["note"] == "hello"
    raw = "\n".join(json.dumps(e) for e in events)
    assert "alice@example.com" not in raw


def test_email_redacted_when_nested(tmp_path):
    res, events = _run(tmp_path,
        main_source="""
            from demo_pkg import calc
            calc.notify(profile={"email": "bob@example.com", "id": 42})
        """,
        module_source="""
            def notify(profile):
                return None
        """,
    )
    assert res.returncode == 0, res.stderr
    enters = [e for e in events if e["event"] == "enter" and e["method"] == "notify"]
    profile = enters[0]["args"]["profile"]
    assert profile["email"] == "<redacted>"
    assert profile["id"] == 42
    raw = "\n".join(json.dumps(e) for e in events)
    assert "bob@example.com" not in raw
