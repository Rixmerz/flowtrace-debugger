"""sitecustomize.py — placed on PYTHONPATH stub dir by the FlowTrace CLI.

Python imports this file automatically at interpreter startup (before user code).
If FLOWTRACE_ENABLE=1, installs the import hook and instruments the main script.
"""

import os
import sys

if os.environ.get("FLOWTRACE_ENABLE") == "1":
    try:
        import flowtrace_runtime
        flowtrace_runtime.install()

        # The MetaPathFinder only intercepts `import` statements — it does NOT
        # intercept the main script executed as `__main__`. We handle that here
        # by wrapping execution via runpy.run_path with our transformed loader.
        #
        # We do this only when Python is invoked as `python script.py` (i.e.
        # sys.argv[0] is a .py file, not -c / -m / interactive).
        _argv0 = sys.argv[0] if sys.argv else ""
        if _argv0 and not _argv0.endswith(".py"):
            # Invoked as `python -m foo`, `pytest`, etc. — the main module won't be
            # auto-transformed via exec(), but import-triggered modules matching
            # FLOWTRACE_PACKAGE_PREFIX are still instrumented by the MetaPathFinder.
            print(
                f"[flowtrace] WARN: argv[0]={_argv0}; main module won't be auto-transformed. "
                "Imports matching FLOWTRACE_PACKAGE_PREFIX will still be instrumented.",
                file=sys.stderr,
            )
        if _argv0.endswith(".py") and os.path.isfile(_argv0):
            from flowtrace_runtime.loader import FlowtraceSourceLoader
            from flowtrace_runtime.runtime import HELPERS
            import runpy
            import types

            _script_path = os.path.abspath(_argv0)
            _module_name = os.path.splitext(os.path.basename(_script_path))[0]

            # Check prefix filter.
            _prefix = os.environ.get("FLOWTRACE_PACKAGE_PREFIX", "")
            _prefixes = [p.strip() for p in _prefix.split(",") if p.strip()]
            _matches = not _prefixes or any(
                _module_name == p or _module_name.startswith(p + ".")
                for p in _prefixes
            )

            if _matches:
                # Load source, transform, compile.
                _loader = FlowtraceSourceLoader(_module_name, _script_path)
                with open(_script_path, "rb") as _f:
                    _src = _f.read()
                _code = _loader.source_to_code(_src, _script_path)

                # Build a __main__ namespace with helpers injected.
                _globs = {
                    "__name__": "__main__",
                    "__file__": _script_path,
                    "__spec__": None,
                    "__loader__": _loader,
                    "__builtins__": __builtins__,
                }
                _globs.update(HELPERS)

                import os as _os
                import traceback as _tb

                def _leave(_status):
                    """Flush the traced program's own streams, then hard-exit.

                    os._exit skips interpreter shutdown — which is exactly where
                    Python flushes sys.stdout/sys.stderr. Python block-buffers
                    stdout whenever it is not a TTY, so without these flushes a
                    traced program silently produced NO output at all when its
                    stdout was a pipe: `calculator.py` printed 5 normally and
                    nothing under FlowTrace, while still emitting all 8 events.
                    The original comment here reasoned only about the emitter's
                    own writes and overlooked the user program entirely.
                    """
                    try:
                        sys.stdout.flush()
                    except Exception:
                        pass
                    try:
                        sys.stderr.flush()
                    except Exception:
                        pass
                    # Prevent the interpreter from running the original script
                    # again after sitecustomize returns.
                    sys.argv[0] = ""
                    _os._exit(_status)

                try:
                    exec(_code, _globs)  # noqa: S102
                except SystemExit as _se:
                    # Preserve the program's own exit status.
                    if _se.code is None:
                        _leave(0)
                    elif isinstance(_se.code, int):
                        _leave(_se.code)
                    else:
                        print(_se.code, file=sys.stderr)
                        _leave(1)
                except BaseException:
                    # The TRACED PROGRAM raised — this is not a FlowTrace
                    # installation failure. Letting it reach the outer handler
                    # printed a misleading "could not install hook" warning and,
                    # worse, let the interpreter then execute the script a second
                    # time, re-running all its side effects. Tracing a program
                    # that crashes is the primary use case for a debugger, so it
                    # has to behave exactly like an uninstrumented run.
                    _tb.print_exc()
                    _leave(1)
                _leave(0)

    except SystemExit:
        raise
    except Exception as _e:
        print(f"[flowtrace] WARNING: could not install hook: {_e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
