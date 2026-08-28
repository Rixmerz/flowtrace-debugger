package flowtracert

import (
	"bytes"
	"runtime/pprof"
	"testing"
)

// TestProfilerCompatWithNestedSpans is the regression test for D3's hard
// safety requirement: runtime/pprof casts g.labels to *labelMap
// (struct{ list []label }), so Span must lead with an identically-shaped
// `list []label` field or the profiler segfaults reading garbage as a slice
// header — and only once a span has a non-nil parent, so a test that never
// nests spans while profiling would not catch a regression here.
//
// runtime/pprof.(*profileBuilder).addCPUData does exactly this cast+range
// while StopCPUProfile drains queued samples, so simply calling
// StartCPUProfile/StopCPUProfile around nested, labeled spans already
// exercises the crash path — no external pprof-format decoder needed to
// prove it: a wrongly-shaped Span crashes the process before this test
// function can return anything at all.
func TestProfilerCompatWithNestedSpans(t *testing.T) {
	defer runtime_setProfLabel(nil)
	runtime_setProfLabel(nil)

	root := enterSpan("pkg", "", "Root", "public", nil)
	child := enterSpan("pkg", "", "Child", "public", nil) // non-nil parent — the crash-only case
	defer func() {
		exitSpan(child)
		exitSpan(root)
	}()

	var buf bytes.Buffer
	if err := pprof.StartCPUProfile(&buf); err != nil {
		t.Fatalf("StartCPUProfile: %v", err)
	}
	busyWorkForProfiling()
	pprof.StopCPUProfile() // blocks until the profile writer has drained every sample

	if buf.Len() == 0 {
		t.Fatal("profile is empty — no samples were collected to exercise the label read path")
	}
}

func busyWorkForProfiling() {
	sum := 0
	for i := 0; i < 100_000_000; i++ {
		sum += i
	}
	_ = sum
}
