"""sitecustomize.py — placed on PYTHONPATH stub dir by the FlowTrace CLI.

Python imports this file automatically at interpreter startup (before user code).
If FLOWTRACE_ENABLE=1, installs the import hook and instruments the main script.
"""

import os
import sys


def _script_matches_prefix(script_path, prefixes):
    """Whether the main script belongs to the traced package.

    The script's basename is matched first (``python calculator.py`` with
    prefix ``calculator``). A project entry point rarely carries the package
    name, though: ``python src/myapp/main.py`` with prefix ``myapp`` used to
    leave main.py un-instrumented while everything it imported was traced —
    the single most misleading trace, because the top of the tree is missing.
    So a directory on the script's path equal to the prefix's first component
    matches too.
    """
    if not prefixes:
        return True
    module_name = os.path.splitext(os.path.basename(script_path))[0]
    parts = os.path.normpath(os.path.dirname(script_path)).split(os.sep)
    for p in prefixes:
        if module_name == p or module_name.startswith(p + "."):
            return True
        if p.split(".", 1)[0] in parts:
            return True
    return False


def _finish(status):
    """Leave the interpreter the way `python script.py` would have.

    The script has already run inside exec(); returning would let the
    interpreter run it a second time, so the process has to end here — but
    it must end the way the program expects:

      * non-daemon threads are joined (threading._shutdown), as the
        interpreter does before finalizing;
      * atexit handlers run — logging.shutdown, coverage.py's data write, the
        emitter's flush, whatever the program registered;
      * stdout/stderr are flushed, because they are the traced program's own
        output and are block-buffered whenever they are not a tty;
      * the exit status is the program's, not a constant 0.
    """
    import atexit
    try:
        import threading
        threading._shutdown()
    except Exception:
        pass
    try:
        atexit._run_exitfuncs()
    except Exception:
        pass
    try:
        sys.stdout.flush()
    except Exception:
        pass
    try:
        sys.stderr.flush()
    except Exception:
        pass
    os._exit(status)


def _exit_status(exc):
    """The status `python script.py` would exit with for SystemExit `exc`."""
    code = exc.code
    if code is None:
        return 0
    if isinstance(code, int):
        return code & 0xFF if code >= 0 else code
    try:
        print(code, file=sys.stderr)
    except Exception:
        pass
    return 1


if os.environ.get("FLOWTRACE_ENABLE") == "1":
    try:
        import flowtrace_runtime
        flowtrace_runtime.install()

        # The MetaPathFinder only intercepts `import` statements — it does NOT
        # intercept the main script executed as `__main__`. We handle that here
        # by executing the transformed script ourselves.
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

            _script_path = os.path.abspath(_argv0)
            _module_name = os.path.splitext(os.path.basename(_script_path))[0]

            # Check prefix filter.
            _prefix = os.environ.get("FLOWTRACE_PACKAGE_PREFIX", "")
            _prefixes = [p.strip() for p in _prefix.split(",") if p.strip()]

            if _script_matches_prefix(_script_path, _prefixes):
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

                # Run the program, then end the interpreter the way it would
                # have ended on its own — see _finish.
                _status = 0
                try:
                    exec(_code, _globs)  # noqa: S102
                except SystemExit as _se:
                    _status = _exit_status(_se)
                except KeyboardInterrupt:
                    import traceback
                    traceback.print_exc()
                    _status = 130
                except BaseException:
                    import traceback
                    traceback.print_exc()
                    _status = 1
                _finish(_status)

    except SystemExit:
        raise
    except Exception as _e:
        print(f"[flowtrace] WARNING: could not install hook: {_e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
