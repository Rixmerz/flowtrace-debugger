package flowtracert

import (
	"sync"
	"testing"
)

func TestParseTraceparent(t *testing.T) {
	const tid = "4bf92f3577b34da6a3ce929d0e0e4736"
	const sid = "00f067aa0ba902b7"

	t.Run("accepts a valid version 00 header", func(t *testing.T) {
		got, ok := parseTraceparent("00-" + tid + "-" + sid + "-01")
		if !ok {
			t.Fatal("valid header rejected")
		}
		if got.traceID != tid || got.spanID != sid {
			t.Fatalf("got %+v", got)
		}
	})

	t.Run("accepts trailing fields only on a later version", func(t *testing.T) {
		if _, ok := parseTraceparent("00-" + tid + "-" + sid + "-01-extra"); ok {
			t.Error("version 00 must be exactly four fields")
		}
		if _, ok := parseTraceparent("01-" + tid + "-" + sid + "-01-extra"); !ok {
			t.Error("a later version must tolerate trailing fields")
		}
	})

	// Each of these has produced a wrong trace_id in some tracer somewhere.
	for _, bad := range []string{
		"",
		"00-" + tid + "-" + sid,                 // too few fields
		"ff-" + tid + "-" + sid + "-01",         // forbidden version
		"00-" + zeroTraceID + "-" + sid + "-01", // all-zero trace id
		"00-" + tid + "-" + zeroSpanID + "-01",  // all-zero span id
		"00-4BF92F3577B34DA6A3CE929D0E0E4736-" + sid + "-01", // uppercase
		"00-" + tid[:31] + "-" + sid + "-01",                 // short trace id
		"00-" + tid + "-" + sid + "-0z",                      // non-hex flags
		"00-" + tid + "-" + sid + "-1",                       // short flags
	} {
		if _, ok := parseTraceparent(bad); ok {
			t.Errorf("accepted malformed header %q", bad)
		}
	}
}

func TestFormatTraceparent(t *testing.T) {
	const tid = "4bf92f3577b34da6a3ce929d0e0e4736"
	const sid = "00f067aa0ba902b7"

	if got := formatTraceparent(tid, sid); got != "00-"+tid+"-"+sid+"-01" {
		t.Errorf("got %q", got)
	}
	// A header we emit must survive our own parser, or the far side drops it.
	if _, ok := parseTraceparent(formatTraceparent(tid, sid)); !ok {
		t.Error("round-trip failed")
	}
	if formatTraceparent(zeroTraceID, sid) != "" || formatTraceparent(tid, "nothex") != "" {
		t.Error("invalid ids must render as empty, not as a bad header")
	}
}

// The property the whole file exists for: a process launched under a caller's
// traceparent puts its root span in the caller's trace, not a fresh one.
func TestEnvSeedJoinsTheCallersTrace(t *testing.T) {
	const tid = "4bf92f3577b34da6a3ce929d0e0e4736"
	const sid = "00f067aa0ba902b7"

	t.Setenv(EnvTraceparent, "00-"+tid+"-"+sid+"-01")
	seedOnce, seed, seedOK = sync.Once{}, remoteContext{}, false
	t.Cleanup(func() { seedOnce, seed, seedOK = sync.Once{}, remoteContext{}, false })

	root := enterSpan("m", "", "handler", "public", nil)
	defer exitSpan(root)

	if root.traceID != tid {
		t.Errorf("root span minted its own trace %q, want the caller's %q", root.traceID, tid)
	}
	if root.parentID != sid {
		t.Errorf("parent_id = %q, want the caller's span %q", root.parentID, sid)
	}
	if root.depth != 0 {
		t.Errorf("depth = %d, want 0 — the remote parent is not a local frame", root.depth)
	}

	// A nested call must still hang off the local root, not off the remote.
	child := enterSpan("m", "", "inner", "private", nil)
	if child.parentID != root.spanID || child.depth != 1 {
		t.Errorf("child parent=%q depth=%d, want parent=%q depth=1", child.parentID, child.depth, root.spanID)
	}
	exitSpan(child)
}

func TestNoSeedMintsAFreshTrace(t *testing.T) {
	t.Setenv(EnvTraceparent, "")
	seedOnce, seed, seedOK = sync.Once{}, remoteContext{}, false
	t.Cleanup(func() { seedOnce, seed, seedOK = sync.Once{}, remoteContext{}, false })

	root := enterSpan("m", "", "handler", "public", nil)
	defer exitSpan(root)

	if !isLowerHex(root.traceID, 32) {
		t.Errorf("trace id %q is not a valid W3C trace id", root.traceID)
	}
	if root.parentID != "" {
		t.Errorf("parent_id = %q, want empty for a real root", root.parentID)
	}
}

// SeedFromTraceparent is the on-the-wire counterpart of the env seed: a server
// adopting the header off an inbound request.
func TestSeedFromTraceparent(t *testing.T) {
	const tid = "4bf92f3577b34da6a3ce929d0e0e4736"
	const sid = "00f067aa0ba902b7"

	restore := SeedFromTraceparent("00-" + tid + "-" + sid + "-01")
	handler := enterSpan("m", "", "handler", "public", nil)
	if handler.traceID != tid || handler.parentID != sid || handler.depth != 0 {
		t.Errorf("handler span = trace %q parent %q depth %d; want %q / %q / 0",
			handler.traceID, handler.parentID, handler.depth, tid, sid)
	}
	// CurrentTraceparent must hand the far side THIS span, so the next hop
	// parents onto the handler rather than back onto the original caller.
	if got := CurrentTraceparent(); got != "00-"+tid+"-"+handler.spanID+"-01" {
		t.Errorf("CurrentTraceparent() = %q", got)
	}
	exitSpan(handler)
	restore()

	if got := CurrentTraceparent(); got != "" {
		t.Errorf("context leaked after restore: %q", got)
	}
	// A bad header must be a no-op, not a panic and not a poisoned context.
	SeedFromTraceparent("garbage")()
	if got := CurrentTraceparent(); got != "" {
		t.Errorf("malformed header seeded a context: %q", got)
	}
}
