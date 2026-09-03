// Truncation golden fixture — Go.
// process() receives a 1000-char string argument and generate() returns a
// 1000-char string result. When run with FLOWTRACE_MAX_ARG_LENGTH=64 both
// must appear truncated in the JSONL — the arg on process's enter/exit, the
// result on generate's exit — while the short values around them stay
// verbatim. No FlowTrace imports: instrumentation is entirely `-overlay`.
package main

import (
	"fmt"
	"strings"
)

func generate(n int) string {
	return strings.Repeat("x", n)
}

func process(data string) string {
	return fmt.Sprintf("processed:%d", len(data))
}

func main() {
	longArg := generate(1000)
	result := process(longArg)
	fmt.Printf("result=%s\n", result)
}
