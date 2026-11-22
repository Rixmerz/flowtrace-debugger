"""The Python half of a hop. Run under the Python capture layer (prefix `caller`):
`Gateway.call_storage` becomes a span, and the traceparent of that very span is
handed to the Rust process through FLOWTRACE_TRACEPARENT."""
import os
import subprocess
import sys

import flowtrace_runtime


class Gateway:
    def call_storage(self, binary: str, rust_out: str, propagate: bool) -> str:
        env = dict(os.environ, FLOWTRACE_OUTPUT=rust_out)
        # The Python layer's own switches must not leak into the Rust child.
        env.pop("FLOWTRACE_ENABLE", None)
        env.pop("FLOWTRACE_TRACEPARENT", None)
        if propagate:
            env["FLOWTRACE_TRACEPARENT"] = flowtrace_runtime.current_traceparent()
        return subprocess.run([binary], env=env, check=True, capture_output=True, text=True).stdout.strip()


if __name__ == "__main__":
    print(Gateway().call_storage(sys.argv[1], sys.argv[2], sys.argv[3] == "propagate"))
