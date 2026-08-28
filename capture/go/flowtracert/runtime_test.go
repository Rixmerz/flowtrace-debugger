package flowtracert

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Enter/Exit/ExitPanic route through the package-level singleton emitter,
// which — like Python's Emitter.instance() — fixes its output file on first
// use for the whole process. TestMain points that singleton at one shared
// file for this test binary; each test snapshots the file's size before
// acting and reads back only the events it just appended.
var singletonTracePath string

func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "flowtracert-runtime-test-*")
	if err != nil {
		panic(err)
	}
	singletonTracePath = filepath.Join(dir, "trace.jsonl")
	os.Setenv("FLOWTRACE_OUTPUT", singletonTracePath)
	// Fix the singleton emitter's file now, while the env var is guaranteed
	// to still be ours — other test files in this package (emitter_test.go)
	// construct their own emitterT and freely set/unset FLOWTRACE_OUTPUT
	// around themselves, and test execution order across files is not
	// something to depend on.
	if err := getEmitter().ensureOpen(); err != nil {
		panic(err)
	}
	code := m.Run()
	os.RemoveAll(dir)
	os.Exit(code)
}

func snapshotOffset(t *testing.T) int64 {
	t.Helper()
	info, err := os.Stat(singletonTracePath)
	if err != nil {
		return 0
	}
	return info.Size()
}

func readEventsSince(t *testing.T, offset int64) []map[string]any {
	t.Helper()
	f, err := os.Open(singletonTracePath)
	if err != nil {
		t.Fatalf("opening %s: %v", singletonTracePath, err)
	}
	defer f.Close()
	if _, err := f.Seek(offset, io.SeekStart); err != nil {
		t.Fatalf("seeking: %v", err)
	}
	data, err := io.ReadAll(f)
	if err != nil {
		t.Fatalf("reading: %v", err)
	}
	var events []map[string]any
	for _, line := range bytes.Split(bytes.TrimRight(data, "\n"), []byte("\n")) {
		if len(line) == 0 {
			continue
		}
		var ev map[string]any
		if err := json.Unmarshal(line, &ev); err != nil {
			t.Fatalf("bad JSON line: %v — %q", err, line)
		}
		events = append(events, ev)
	}
	return events
}

// ---------------------------------------------------------------------------
// AC3: field mapping
// ---------------------------------------------------------------------------

func TestEnterExitFieldMapping(t *testing.T) {
	runtime_setProfLabel(nil)
	offset := snapshotOffset(t)

	s := Enter("myapp/service", "Calc", "Add", "public", "a", 1, "b", 2)
	Exit(s, 3, error(nil))

	events := readEventsSince(t, offset)
	if len(events) != 2 {
		t.Fatalf("expected 2 events, got %d: %v", len(events), events)
	}
	enter, exit := events[0], events[1]

	if enter["lang"] != "go" {
		t.Errorf("enter.lang = %v, want go", enter["lang"])
	}
	if enter["module"] != "myapp/service" {
		t.Errorf("enter.module = %v", enter["module"])
	}
	if enter["class"] != "Calc" {
		t.Errorf("enter.class = %v, want Calc", enter["class"])
	}
	if enter["method"] != "Add" {
		t.Errorf("enter.method = %v, want Add", enter["method"])
	}
	if enter["visibility"] != "public" {
		t.Errorf("enter.visibility = %v, want public", enter["visibility"])
	}
	thread, _ := enter["thread"].(string)
	if !strings.HasPrefix(thread, "goroutine-") {
		t.Errorf("enter.thread = %v, want goroutine-<id>", enter["thread"])
	}
	if enter["parent_id"] != nil {
		t.Errorf("root enter.parent_id = %v, want nil", enter["parent_id"])
	}
	args, _ := enter["args"].(map[string]any)
	if args["a"] != float64(1) || args["b"] != float64(2) {
		t.Errorf("enter.args = %v", args)
	}

	if exit["event"] != "exit" {
		t.Errorf("exit.event = %v", exit["event"])
	}
	if _, hasErr := exit["error"]; hasErr {
		t.Errorf("exit.error should be absent for a nil error result, got %v", exit["error"])
	}
	if d, ok := exit["duration_ns"].(float64); !ok || d < 0 {
		t.Errorf("exit.duration_ns = %v", exit["duration_ns"])
	}
}

func TestExitPackageLevelFunctionHasEmptyClass(t *testing.T) {
	runtime_setProfLabel(nil)
	offset := snapshotOffset(t)

	s := Enter("myapp/util", "", "Sum", "public", "n", 5)
	Exit(s, 5)

	events := readEventsSince(t, offset)
	enter := events[0]
	if enter["class"] != "" {
		t.Errorf("package-level function enter.class = %v, want empty", enter["class"])
	}
}

func TestExitCapturesNonNilReturnedError(t *testing.T) {
	runtime_setProfLabel(nil)
	offset := snapshotOffset(t)

	s := Enter("myapp/service", "Repo", "Find", "public", "id", 7)
	Exit(s, nil, errors.New("not found"))

	events := readEventsSince(t, offset)
	exit := events[1]
	errObj, ok := exit["error"].(map[string]any)
	if !ok {
		t.Fatalf("exit.error missing or wrong shape: %v", exit["error"])
	}
	if errObj["msg"] != "not found" {
		t.Errorf("error.msg = %v, want %q", errObj["msg"], "not found")
	}
	if errObj["type"] == "" {
		t.Errorf("error.type is empty")
	}
	if _, ok := errObj["stack"].([]any); !ok {
		t.Errorf("error.stack missing or wrong shape: %v", errObj["stack"])
	}
}

func TestExitPanicCapturesErrorField(t *testing.T) {
	runtime_setProfLabel(nil)
	offset := snapshotOffset(t)

	s := Enter("myapp/service", "Repo", "Find", "public", "id", 7)
	func() {
		defer func() {
			if p := recover(); p != nil {
				ExitPanic(s, p)
			}
		}()
		panic("boom")
	}()

	events := readEventsSince(t, offset)
	exit := events[1]
	if exit["event"] != "exit" {
		t.Fatalf("ExitPanic must still emit an 'exit' event, got %v", exit["event"])
	}
	errObj, ok := exit["error"].(map[string]any)
	if !ok {
		t.Fatalf("exit.error missing or wrong shape: %v", exit["error"])
	}
	if errObj["msg"] != "boom" {
		t.Errorf("error.msg = %v, want boom", errObj["msg"])
	}
	stack, ok := errObj["stack"].([]any)
	if !ok || len(stack) == 0 {
		t.Errorf("error.stack should be non-empty for a panic, got %v", errObj["stack"])
	}
	result, _ := exit["result"].(map[string]any)
	if len(result) != 0 {
		t.Errorf("exit.result on a panic should be empty, got %v", result)
	}
}

func TestGoroutineContextParentSpanID(t *testing.T) {
	runtime_setProfLabel(nil)
	offset := snapshotOffset(t)

	outer := Enter("myapp/service", "", "Outer", "public")
	inner := Enter("myapp/service", "", "Inner", "public")
	Exit(inner)
	Exit(outer)

	events := readEventsSince(t, offset)
	// events: [outer.enter, inner.enter, inner.exit, outer.exit]
	outerEnter, innerEnter := events[0], events[1]
	if innerEnter["parent_id"] != outerEnter["span_id"] {
		t.Errorf("inner.parent_id = %v, want outer span_id %v", innerEnter["parent_id"], outerEnter["span_id"])
	}
	if innerEnter["trace_id"] != outerEnter["trace_id"] {
		t.Errorf("inner.trace_id = %v, want outer trace_id %v", innerEnter["trace_id"], outerEnter["trace_id"])
	}
}
