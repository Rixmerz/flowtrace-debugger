package flowtracert

import (
	"os"
	"strconv"
	"testing"
)

// TestCapNeverOrphansAnEnterOrExit is the regression test for the bug where
// FLOWTRACE_MAX_EVENTS could leave a span's "exit" unpaired with its
// "enter" (or vice versa) once the cap was hit mid-run.
//
// Before the fix, exit/panic-exit went through the same capped emit path
// as enter, so a span already open when the cap tripped could have its
// "enter" written but its "exit" silently dropped — an orphaned "enter",
// which plugin/agents/flowtrace-analyst.md, plugin/commands/trace.md and
// plugin/skills/flowtrace-analysis/SKILL.md all teach the reader means
// "the process died inside that call". A cap hit is not a crash, so that
// was a false diagnosis, and it happened without the analyst — who reads
// only the JSONL, not stderr — ever finding out.
//
// The fix (emitter.go's emit/emitForced split, Span.entered) makes enter
// the only capped event; exit and panic-exit for a span whose enter was
// actually written always go through uncapped. This test pins both halves
// of that invariant: a span whose enter fits under the cap still gets its
// exit (parent, below), and a span whose enter was refused by the cap
// never gets an orphan exit either (child, below).
func TestCapNeverOrphansAnEnterOrExit(t *testing.T) {
	runtime_setProfLabel(nil)
	offset := snapshotOffset(t)

	origCap, hadCap := os.LookupEnv("FLOWTRACE_MAX_EVENTS")
	defer func() {
		if hadCap {
			os.Setenv("FLOWTRACE_MAX_EVENTS", origCap)
		} else {
			os.Unsetenv("FLOWTRACE_MAX_EVENTS")
		}
	}()

	e := getEmitter()
	e.mu.Lock()
	already := e.count
	e.mu.Unlock()
	// Exactly one more "enter" fits before the cap trips — deliberately
	// landing the cap right between the parent's enter and its own exit,
	// the boundary the original bug got wrong.
	os.Setenv("FLOWTRACE_MAX_EVENTS", strconv.Itoa(already+1))

	parent := Enter("myapp/cap", "", "Parent", "public")
	if !parent.entered {
		t.Fatalf("parent enter should have fit under the cap (already=%d)", already)
	}
	child := Enter("myapp/cap", "", "Child", "public")
	if child.entered {
		t.Fatalf("child enter should have been refused by the cap")
	}

	Exit(child)  // must not write an orphan exit for a span never entered
	Exit(parent) // must still write its exit — bypasses the cap (emitForced)

	events := readEventsSince(t, offset)
	if len(events) != 2 {
		t.Fatalf("expected exactly 2 events (parent enter + parent exit), got %d: %v", len(events), events)
	}
	if events[0]["event"] != "enter" || events[0]["method"] != "Parent" {
		t.Fatalf("event 0 = %v, want parent enter", events[0])
	}
	if events[1]["event"] != "exit" || events[1]["method"] != "Parent" {
		t.Fatalf("event 1 = %v, want parent exit", events[1])
	}
	if events[0]["span_id"] != events[1]["span_id"] {
		t.Fatalf("enter/exit span_id mismatch: %v vs %v", events[0]["span_id"], events[1]["span_id"])
	}
}

// TestCapNeverOrphansAPanicExit is the ExitPanic half of the same
// invariant: a span refused by the cap must not leave an orphan panic-exit
// either.
func TestCapNeverOrphansAPanicExit(t *testing.T) {
	runtime_setProfLabel(nil)
	offset := snapshotOffset(t)

	origCap, hadCap := os.LookupEnv("FLOWTRACE_MAX_EVENTS")
	defer func() {
		if hadCap {
			os.Setenv("FLOWTRACE_MAX_EVENTS", origCap)
		} else {
			os.Unsetenv("FLOWTRACE_MAX_EVENTS")
		}
	}()

	e := getEmitter()
	e.mu.Lock()
	already := e.count
	e.mu.Unlock()
	// The cap is already exhausted — the very next enter must be refused.
	os.Setenv("FLOWTRACE_MAX_EVENTS", strconv.Itoa(already))

	s := Enter("myapp/cap", "", "NeverEntered", "public")
	if s.entered {
		t.Fatalf("enter should have been refused by the already-exhausted cap")
	}
	ExitPanic(s, "boom")

	events := readEventsSince(t, offset)
	if len(events) != 0 {
		t.Fatalf("expected no events (enter was capped, panic-exit must not orphan), got %d: %v", len(events), events)
	}
}
