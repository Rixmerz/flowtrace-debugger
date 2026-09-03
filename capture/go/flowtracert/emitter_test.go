package flowtracert

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
)

func makeEnterEvent() map[string]any {
	return map[string]any{
		"ts":         nowSeconds(),
		"trace_id":   newTraceID(),
		"span_id":    newSpanID(),
		"parent_id":  nil,
		"event":      "enter",
		"thread":     "goroutine-1",
		"lang":       "go",
		"module":     "myapp/service",
		"class":      "UserService",
		"method":     "GetUser",
		"visibility": "public",
		"args":       map[string]any{"userID": int64(42)},
		"depth":      0,
	}
}

func makeExitEvent(enter map[string]any) map[string]any {
	ex := make(map[string]any, len(enter)+2)
	for k, v := range enter {
		ex[k] = v
	}
	ex["event"] = "exit"
	ex["ts"] = nowSeconds()
	ex["result"] = map[string]any{"r0": map[string]any{"id": int64(42)}}
	ex["duration_ns"] = int64(1000)
	return ex
}

func captureStderr(t *testing.T, fn func()) string {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	orig := os.Stderr
	os.Stderr = w
	defer func() { os.Stderr = orig }()

	var buf bytes.Buffer
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		buf.ReadFrom(r)
	}()

	fn()
	w.Close()
	wg.Wait()
	return buf.String()
}

func TestEmitEnterAndExitRoundtrip(t *testing.T) {
	dir := t.TempDir()
	out := filepath.Join(dir, "trace.jsonl")
	e := &emitterT{}

	orig := os.Getenv("FLOWTRACE_OUTPUT")
	os.Setenv("FLOWTRACE_OUTPUT", out)
	defer os.Setenv("FLOWTRACE_OUTPUT", orig)

	enter := makeEnterEvent()
	exit := makeExitEvent(enter)
	e.emit(enter)
	e.emit(exit)

	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatalf("reading output: %v", err)
	}
	lines := bytes.Split(bytes.TrimRight(data, "\n"), []byte("\n"))
	if len(lines) != 2 {
		t.Fatalf("expected 2 lines, got %d: %s", len(lines), data)
	}
	var parsedEnter, parsedExit map[string]any
	if err := json.Unmarshal(lines[0], &parsedEnter); err != nil {
		t.Fatalf("line 0 not valid JSON: %v", err)
	}
	if err := json.Unmarshal(lines[1], &parsedExit); err != nil {
		t.Fatalf("line 1 not valid JSON: %v", err)
	}
	if parsedEnter["event"] != "enter" {
		t.Fatalf("line 0 event = %v, want enter", parsedEnter["event"])
	}
	if parsedExit["event"] != "exit" {
		t.Fatalf("line 1 event = %v, want exit", parsedExit["event"])
	}
	if parsedExit["duration_ns"].(float64) < 0 {
		t.Fatalf("duration_ns = %v, want >= 0", parsedExit["duration_ns"])
	}
}

func TestBadTraceIDRejected(t *testing.T) {
	dir := t.TempDir()
	out := filepath.Join(dir, "trace.jsonl")
	e := &emitterT{}
	os.Setenv("FLOWTRACE_OUTPUT", out)
	defer os.Unsetenv("FLOWTRACE_OUTPUT")

	bad := makeEnterEvent()
	bad["trace_id"] = "not-valid"

	stderr := captureStderr(t, func() { e.emit(bad) })
	if !bytes.Contains([]byte(stderr), []byte("WARNING")) {
		t.Fatalf("expected WARNING on stderr, got: %q", stderr)
	}
	if _, err := os.Stat(out); err == nil {
		t.Fatal("output file should not have been created for a dropped event")
	}
}

func TestBadSpanIDRejected(t *testing.T) {
	dir := t.TempDir()
	out := filepath.Join(dir, "trace.jsonl")
	e := &emitterT{}
	os.Setenv("FLOWTRACE_OUTPUT", out)
	defer os.Unsetenv("FLOWTRACE_OUTPUT")

	bad := makeEnterEvent()
	bad["span_id"] = "ZZZZ"

	stderr := captureStderr(t, func() { e.emit(bad) })
	if !bytes.Contains([]byte(stderr), []byte("WARNING")) {
		t.Fatalf("expected WARNING on stderr, got: %q", stderr)
	}
}

func TestMissingRequiredFieldRejected(t *testing.T) {
	dir := t.TempDir()
	out := filepath.Join(dir, "trace.jsonl")
	e := &emitterT{}
	os.Setenv("FLOWTRACE_OUTPUT", out)
	defer os.Unsetenv("FLOWTRACE_OUTPUT")

	bad := makeEnterEvent()
	delete(bad, "method")

	stderr := captureStderr(t, func() { e.emit(bad) })
	if !bytes.Contains([]byte(stderr), []byte("WARNING")) {
		t.Fatalf("expected WARNING on stderr, got: %q", stderr)
	}
}

func TestUnknownEventTypeRejected(t *testing.T) {
	dir := t.TempDir()
	out := filepath.Join(dir, "trace.jsonl")
	e := &emitterT{}
	os.Setenv("FLOWTRACE_OUTPUT", out)
	defer os.Unsetenv("FLOWTRACE_OUTPUT")

	bad := makeEnterEvent()
	bad["event"] = "sideways"

	stderr := captureStderr(t, func() { e.emit(bad) })
	if !bytes.Contains([]byte(stderr), []byte("WARNING")) {
		t.Fatalf("expected WARNING on stderr, got: %q", stderr)
	}
}

func TestInvalidParentIDRejected(t *testing.T) {
	dir := t.TempDir()
	out := filepath.Join(dir, "trace.jsonl")
	e := &emitterT{}
	os.Setenv("FLOWTRACE_OUTPUT", out)
	defer os.Unsetenv("FLOWTRACE_OUTPUT")

	bad := makeEnterEvent()
	bad["parent_id"] = "short"

	stderr := captureStderr(t, func() { e.emit(bad) })
	if !bytes.Contains([]byte(stderr), []byte("WARNING")) {
		t.Fatalf("expected WARNING on stderr, got: %q", stderr)
	}
}

func TestNilParentIDAccepted(t *testing.T) {
	dir := t.TempDir()
	out := filepath.Join(dir, "trace.jsonl")
	e := &emitterT{}
	os.Setenv("FLOWTRACE_OUTPUT", out)
	defer os.Unsetenv("FLOWTRACE_OUTPUT")

	root := makeEnterEvent()
	root["parent_id"] = nil

	stderr := captureStderr(t, func() { e.emit(root) })
	if bytes.Contains([]byte(stderr), []byte("WARNING")) {
		t.Fatalf("root span with nil parent_id should be accepted, got: %q", stderr)
	}
}

func TestConcurrentEmitNoInterleaving(t *testing.T) {
	dir := t.TempDir()
	out := filepath.Join(dir, "trace.jsonl")
	e := &emitterT{}
	os.Setenv("FLOWTRACE_OUTPUT", out)
	defer os.Unsetenv("FLOWTRACE_OUTPUT")

	const goroutines = 50
	const perGoroutine = 50
	var wg sync.WaitGroup
	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < perGoroutine; j++ {
				e.emit(makeEnterEvent())
			}
		}()
	}
	wg.Wait()

	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatalf("reading output: %v", err)
	}
	lines := bytes.Split(bytes.TrimRight(data, "\n"), []byte("\n"))
	want := goroutines * perGoroutine
	if len(lines) != want {
		t.Fatalf("expected %d lines, got %d", want, len(lines))
	}
	for i, line := range lines {
		var obj map[string]any
		if err := json.Unmarshal(line, &obj); err != nil {
			t.Fatalf("line %d not valid JSON: %v — %q", i, err, line)
		}
	}
}

func TestDefaultOutputPathIsUniquePerProcessAndMillisecond(t *testing.T) {
	got := defaultOutputPath()
	if filepath.Dir(got) != ".flowtrace" {
		t.Errorf("default output dir = %q, want .flowtrace", filepath.Dir(got))
	}
	// <yyyymmdd>T<hhmmss>.<mmm>-<pid>.jsonl
	pattern := regexp.MustCompile(`^\d{8}T\d{6}\.\d{3}-` + strconv.Itoa(os.Getpid()) + `\.jsonl$`)
	if !pattern.MatchString(filepath.Base(got)) {
		t.Errorf("default output name = %q, want <ts>.<ms>-<pid>.jsonl", filepath.Base(got))
	}
}

func TestMaxEventsResolvedOncePerEmitter(t *testing.T) {
	dir := t.TempDir()
	orig, had := os.LookupEnv("FLOWTRACE_OUTPUT")
	os.Setenv("FLOWTRACE_OUTPUT", filepath.Join(dir, "trace.jsonl"))
	origCap, hadCap := os.LookupEnv("FLOWTRACE_MAX_EVENTS")
	t.Cleanup(func() {
		if had {
			os.Setenv("FLOWTRACE_OUTPUT", orig)
		} else {
			os.Unsetenv("FLOWTRACE_OUTPUT")
		}
		if hadCap {
			os.Setenv("FLOWTRACE_MAX_EVENTS", origCap)
		} else {
			os.Unsetenv("FLOWTRACE_MAX_EVENTS")
		}
	})

	os.Setenv("FLOWTRACE_MAX_EVENTS", "2")
	e := &emitterT{}
	if !e.emit(makeEnterEvent()) {
		t.Fatal("first enter should be written")
	}
	// Changing the environment after the first write must have no effect:
	// the cap is read once, not on every event.
	os.Setenv("FLOWTRACE_MAX_EVENTS", "1000")
	if !e.emit(makeEnterEvent()) {
		t.Fatal("second enter should still fit under the cap of 2")
	}
	var stderr string
	var third bool
	stderr = captureStderr(t, func() { third = e.emit(makeEnterEvent()) })
	if third {
		t.Fatal("third enter should have been refused: the cap of 2 was resolved once and must stick")
	}
	if !strings.Contains(stderr, "FLOWTRACE_MAX_EVENTS") || !strings.Contains(stderr, "after 2 events") {
		t.Errorf("cap warning should name the env var and the count, got %q", stderr)
	}
	if strings.Count(strings.TrimSpace(stderr), "\n") != 0 {
		t.Errorf("cap warning must be a single stderr line, got %q", stderr)
	}
	// And only once.
	again := captureStderr(t, func() { e.emit(makeEnterEvent()) })
	if again != "" {
		t.Errorf("cap warning must not repeat, got %q", again)
	}
}

func TestMaxEventsInvalidOrUnsetFallsBackToDefault(t *testing.T) {
	origCap, hadCap := os.LookupEnv("FLOWTRACE_MAX_EVENTS")
	t.Cleanup(func() {
		if hadCap {
			os.Setenv("FLOWTRACE_MAX_EVENTS", origCap)
		} else {
			os.Unsetenv("FLOWTRACE_MAX_EVENTS")
		}
	})
	os.Unsetenv("FLOWTRACE_MAX_EVENTS")
	if got := maxEventsFromEnv(); got != maxEventsDefault {
		t.Errorf("unset: got %d, want %d", got, maxEventsDefault)
	}
	os.Setenv("FLOWTRACE_MAX_EVENTS", "lots")
	if got := maxEventsFromEnv(); got != maxEventsDefault {
		t.Errorf("invalid: got %d, want %d", got, maxEventsDefault)
	}
	os.Setenv("FLOWTRACE_MAX_EVENTS", "0")
	if got := maxEventsFromEnv(); got != 0 {
		t.Errorf("zero: got %d, want 0 (uncapped)", got)
	}
}
