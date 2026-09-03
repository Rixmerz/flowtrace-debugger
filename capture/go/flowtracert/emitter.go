// SPDX-License-Identifier: MIT

// JSONL v2 emitter — singleton, thread-safe, zero non-stdlib dependencies.
// Mirrors capture/python/flowtrace_runtime/emitter.py: same output-path
// resolution, same required-fields-per-event-type and W3C ID validation,
// same drop-and-warn-to-stderr-never-panic contract. One thing it does not
// mirror: a per-process event cap (maxEventsDefault below) — Go-specific,
// because FlowTrace instruments every function under a prefix and Go
// programs run hotter than typical Python or Node ones.
//
// Output path resolution (first match wins):
//  1. FLOWTRACE_OUTPUT env var
//  2. .flowtrace/<timestamp>.<ms>-<pid>.jsonl (created relative to cwd at
//     first emit; see defaultOutputPath for why the name carries both)
//
// Volume: FLOWTRACE_MAX_EVENTS caps how many "enter" events one process
// writes (default maxEventsDefault; 0 or negative disables the cap). It is
// read once, on the first event, and the cap is announced on stderr the
// moment it is hit — see maxEventsDefault and (*emitterT).write.
package flowtracert

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"sync"
	"time"
)

// W3C ID validation patterns (compiled once).
var (
	traceIDPattern  = regexp.MustCompile(`^[0-9a-f]{32}$`)
	spanIDPattern   = regexp.MustCompile(`^[0-9a-f]{16}$`)
	parentIDPattern = regexp.MustCompile(`^[0-9a-f]{16}$`)
)

// Required fields per event type.
var enterRequired = []string{
	"ts", "trace_id", "span_id", "parent_id", "event",
	"thread", "lang", "module", "class", "method",
	"visibility", "args", "depth",
}

var exitRequired = []string{
	"ts", "trace_id", "span_id", "parent_id", "event",
	"thread", "lang", "module", "class", "method",
	"visibility", "args", "result", "duration_ns", "depth",
}

// maxEventsDefault caps events per process so a hot Go program cannot fill a
// disk before anyone notices ("Risks accepted: Volume" in
// docs/changes/2026-08-27-go-capture-layer.md — FlowTrace instruments every
// function under a prefix, and Go programs run hotter than typical Python or
// Node ones). FLOWTRACE_MAX_EVENTS overrides it; 0 or a negative value
// disables the cap for a deliberate full-trace capture.
//
// The cap only ever stops new spans from opening (see emit/emitForced
// below): a span whose "enter" made it into the trace before the cap was
// hit always gets its "exit" recorded too, uncapped. Without that, hitting
// the cap mid-run would leave whatever was on the call stack at that moment
// looking like it crashed there — "enter" with no "exit" is the documented
// signal for a call that never returned (plugin/agents/flowtrace-analyst.md,
// plugin/commands/trace.md, plugin/skills/flowtrace-analysis/SKILL.md), and
// the analyst only reads the JSONL, never the stderr warning.
const maxEventsDefault = 100_000

// maxEventsFromEnv resolves FLOWTRACE_MAX_EVENTS. Called exactly once per
// emitter (see emitterT.limitSet) — never per event: the earlier shape
// re-read the environment and re-parsed it under e.mu for every single
// event, which put a Getenv + Atoi on the hot path of every traced call
// for a value that cannot change once the process has started.
func maxEventsFromEnv() int {
	raw := os.Getenv("FLOWTRACE_MAX_EVENTS")
	if raw == "" {
		return maxEventsDefault
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return maxEventsDefault
	}
	return n
}

// emitterT is the JSONL writer. The package-level singleton (getEmitter) is
// what Enter/Exit/ExitPanic use; tests construct their own &emitterT{} to
// get an isolated instance, mirroring how emitter.py's tests bypass its
// singleton via Emitter.__new__.
type emitterT struct {
	mu           sync.Mutex
	file         *os.File
	count        int
	limit        int  // resolved from FLOWTRACE_MAX_EVENTS on first write; <= 0 means uncapped
	limitSet     bool // whether limit has been resolved — once per emitter, under mu
	cappedWarned bool
}

// maxEvents returns this emitter's event cap, resolving it from the
// environment the first time it is asked. Must be called under e.mu —
// which write already holds — so the once-only resolution needs no
// synchronization of its own.
func (e *emitterT) maxEvents() int {
	if !e.limitSet {
		e.limit = maxEventsFromEnv()
		e.limitSet = true
	}
	return e.limit
}

// setMaxEventsForTest pins the cap without touching the environment, and
// returns a func that un-pins it (the next write resolves from the
// environment again). Tests only; production code resolves once and never
// changes it.
func (e *emitterT) setMaxEventsForTest(limit int) (restore func()) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.limit, e.limitSet = limit, true
	return func() {
		e.mu.Lock()
		defer e.mu.Unlock()
		e.limitSet = false
	}
}

var (
	emitterOnce     sync.Once
	emitterInstance *emitterT
)

func getEmitter() *emitterT {
	emitterOnce.Do(func() {
		emitterInstance = &emitterT{}
	})
	return emitterInstance
}

// emit is the capped path — used for "enter" events, which open a new span.
// Returns whether the event was actually written; the caller (runtime.go's
// Enter) records that on the Span so its matching exit knows whether it has
// one to close.
func emit(event map[string]any) bool {
	return getEmitter().emit(event)
}

// emitForced is the uncapped path — used only for the "exit"/panic-exit of a
// span whose "enter" was already written (Span.entered). A span the reader
// already saw opened must always see it closed; without this, hitting the
// cap mid-run drops the exits of already-open spans and the JSONL becomes
// indistinguishable from those calls having crashed (enter with no exit is
// the documented crash signal — see plugin/agents/flowtrace-analyst.md,
// plugin/commands/trace.md, plugin/skills/flowtrace-analysis/SKILL.md). This
// is bounded by the number of spans open at the moment the cap was hit
// (call-stack depth across live goroutines), not unbounded — a hot loop
// past the cap does not grow it further, since none of those calls' enters
// were ever recorded.
func emitForced(event map[string]any) bool {
	return getEmitter().emitForced(event)
}

// emit validates and appends one v2 event as a JSON line, subject to the
// event cap. Drops malformed events with a warning to stderr — never
// panics. Each write goes straight to the OS (no buffered writer in front
// of the file), so a program that crashes right after still leaves its
// trace on disk.
func (e *emitterT) emit(event map[string]any) bool {
	return e.write(event, false)
}

// emitForced is emit without the event-count gate — see package-level
// emitForced's doc comment for why an already-opened span's exit needs
// this.
func (e *emitterT) emitForced(event map[string]any) bool {
	return e.write(event, true)
}

// write is the shared implementation behind emit/emitForced. bypassCap
// skips the event-count gate; it never skips validation.
func (e *emitterT) write(event map[string]any, bypassCap bool) bool {
	if msg := validateEvent(event); msg != "" {
		fmt.Fprintf(os.Stderr, "[flowtrace] WARNING: dropping malformed event — %s\n", msg)
		return false
	}
	line, err := json.Marshal(event)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[flowtrace] WARNING: dropping malformed event — %s\n", err)
		return false
	}
	line = append(line, '\n')

	e.mu.Lock()
	defer e.mu.Unlock()

	if !bypassCap {
		if limit := e.maxEvents(); limit > 0 && e.count >= limit {
			if !e.cappedWarned {
				// One line, once: the count is what a reader needs to know
				// how much of the run the file covers, and there is no
				// process-exit hook a copied-in stdlib-only package could
				// use to say anything later.
				e.cappedWarned = true
				fmt.Fprintf(os.Stderr,
					"[flowtrace] WARNING: FLOWTRACE_MAX_EVENTS cap reached after %d events — no further calls are entered into the trace for the rest of this process; calls already open still get their exit recorded, so 'enter' without 'exit' keeps meaning 'this call did not return'. Raise FLOWTRACE_MAX_EVENTS, or set it to 0 to disable the cap, for the full trace.\n",
					e.count)
			}
			return false
		}
	}

	if err := e.ensureOpen(); err != nil {
		fmt.Fprintf(os.Stderr, "[flowtrace] WARNING: dropping event — %s\n", err)
		return false
	}
	if _, err := e.file.Write(line); err != nil {
		fmt.Fprintf(os.Stderr, "[flowtrace] WARNING: failed writing event — %s\n", err)
		return false
	}
	e.count++
	return true
}

// ensureOpen opens the output file lazily. Must be called under e.mu.
func (e *emitterT) ensureOpen() error {
	if e.file != nil {
		return nil
	}
	path := os.Getenv("FLOWTRACE_OUTPUT")
	if path == "" {
		path = defaultOutputPath()
	}
	if dir := filepath.Dir(path); dir != "." && dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	e.file = f
	return nil
}

// defaultOutputPath names the trace file when FLOWTRACE_OUTPUT is unset:
// .flowtrace/<local-time timestamp to the millisecond>-<pid>.jsonl.
// Second resolution alone was not enough — a `go test ./...` or any
// program that forks children starts several instrumented processes within
// the same second, and with O_APPEND they all wrote into one file,
// interleaving unrelated traces. Milliseconds narrow the window and the pid
// closes it: two live processes never share one. Nothing downstream parses
// the name; the CLI always sets FLOWTRACE_OUTPUT, and the only contract
// consumers rely on is the .flowtrace/ directory and the .jsonl suffix.
func defaultOutputPath() string {
	ts := time.Now().Format("20060102T150405.000")
	return filepath.Join(".flowtrace", ts+"-"+strconv.Itoa(os.Getpid())+".jsonl")
}

// validateEvent returns an error message, or "" if the event is valid.
func validateEvent(event map[string]any) string {
	evType, _ := event["event"].(string)
	var required []string
	switch evType {
	case "enter":
		required = enterRequired
	case "exit":
		required = exitRequired
	default:
		return fmt.Sprintf("unknown event type: %v", event["event"])
	}

	var missing []string
	for _, k := range required {
		if _, ok := event[k]; !ok {
			missing = append(missing, k)
		}
	}
	if len(missing) > 0 {
		sort.Strings(missing)
		return fmt.Sprintf("missing required fields: %v", missing)
	}

	traceID, _ := event["trace_id"].(string)
	if !traceIDPattern.MatchString(traceID) {
		return fmt.Sprintf("invalid trace_id: %v", event["trace_id"])
	}
	spanID, _ := event["span_id"].(string)
	if !spanIDPattern.MatchString(spanID) {
		return fmt.Sprintf("invalid span_id: %v", event["span_id"])
	}
	if pid, ok := event["parent_id"]; ok && pid != nil {
		pidStr, isStr := pid.(string)
		if !isStr || !parentIDPattern.MatchString(pidStr) {
			return fmt.Sprintf("invalid parent_id: %v", pid)
		}
	}
	return ""
}
