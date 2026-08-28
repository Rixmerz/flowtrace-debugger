package flowtracert

import (
	"regexp"
	"testing"
)

var (
	testTraceIDRe = regexp.MustCompile(`^[0-9a-f]{32}$`)
	testSpanIDRe  = regexp.MustCompile(`^[0-9a-f]{16}$`)
)

func TestNewTraceIDFormat(t *testing.T) {
	for i := 0; i < 200; i++ {
		id := newTraceID()
		if !testTraceIDRe.MatchString(id) {
			t.Fatalf("newTraceID() = %q, want 32 lowercase hex chars", id)
		}
	}
}

func TestNewSpanIDFormat(t *testing.T) {
	for i := 0; i < 200; i++ {
		id := newSpanID()
		if !testSpanIDRe.MatchString(id) {
			t.Fatalf("newSpanID() = %q, want 16 lowercase hex chars", id)
		}
	}
}

func TestIDsAreUnique(t *testing.T) {
	seenTrace := make(map[string]bool)
	seenSpan := make(map[string]bool)
	for i := 0; i < 2000; i++ {
		tid := newTraceID()
		if seenTrace[tid] {
			t.Fatalf("duplicate trace_id: %s", tid)
		}
		seenTrace[tid] = true

		sid := newSpanID()
		if seenSpan[sid] {
			t.Fatalf("duplicate span_id: %s", sid)
		}
		seenSpan[sid] = true
	}
}
