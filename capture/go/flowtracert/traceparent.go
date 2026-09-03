// SPDX-License-Identifier: MIT

package flowtracert

import (
	"os"
	"sync"
	"unsafe"
)

// W3C Trace Context support, so a Go process can join a trace another
// process started.
//
// Spec: https://www.w3.org/TR/trace-context/#traceparent-header
//
//	traceparent = version "-" trace-id "-" parent-id "-" trace-flags
//	version     = 2 HEXDIGLC   ; "ff" is forbidden
//	trace-id    = 32 HEXDIGLC  ; all-zero is invalid
//	parent-id   = 16 HEXDIGLC  ; all-zero is invalid
//	trace-flags = 2 HEXDIGLC
//
// HEXDIGLC is *lowercase* hex. Uppercase is rejected rather than normalized,
// exactly as in capture/node's traceparent.js: being lenient here would let
// us emit a trace_id that fails our own schema (`^[0-9a-f]{32}$`).
//
// Only the inbound half is automatic. Node patches globalThis.fetch and
// http.request to attach the header outbound; Go has no equivalent seam —
// net/http is resolved at compile time, and patching it would mean rewriting
// stdlib call sites in the overlay pass. Go therefore exposes
// CurrentTraceparent for the caller to attach by hand. See the propagation
// matrix in docs/architecture.md.

// EnvTraceparent is the carrier this runtime reads on startup. It matches the
// Node and Python capture layers and Java's TraceparentSeed.ENV_VAR, so a
// parent process seeds any child the same way regardless of its language.
const EnvTraceparent = "FLOWTRACE_TRACEPARENT"

const (
	zeroTraceID = "00000000000000000000000000000000"
	zeroSpanID  = "0000000000000000"
)

// remoteContext is a caller's span, parsed out of a traceparent header.
type remoteContext struct {
	traceID string
	spanID  string
}

// isLowerHex reports whether s is exactly n lowercase hex characters.
func isLowerHex(s string, n int) bool {
	if len(s) != n {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}

// splitTraceparent splits on '-' without importing strings, keeping this file
// within the stdlib-minimal budget the package doc requires. Returns at most
// 5 fields; a 5th non-empty field means "more than version 00 allows".
func splitTraceparent(h string) []string {
	out := make([]string, 0, 5)
	start := 0
	for i := 0; i <= len(h); i++ {
		if i == len(h) || h[i] == '-' {
			out = append(out, h[start:i])
			start = i + 1
			if len(out) == 5 {
				break
			}
		}
	}
	return out
}

// parseTraceparent parses a traceparent header value.
//
// Returns ok=false for anything malformed rather than erroring: a bad header
// from a peer we do not control must degrade to "start a new trace", never
// break the traced program.
func parseTraceparent(h string) (remoteContext, bool) {
	parts := splitTraceparent(h)
	if len(parts) < 4 {
		return remoteContext{}, false
	}
	version, traceID, spanID, flags := parts[0], parts[1], parts[2], parts[3]

	if !isLowerHex(version, 2) || version == "ff" {
		return remoteContext{}, false
	}
	// Version 00 is exactly four fields. Later versions may append more and
	// the spec requires us to accept those, so trailing data is tolerated
	// only when the version says so.
	if version == "00" && len(parts) != 4 {
		return remoteContext{}, false
	}
	if !isLowerHex(traceID, 32) || traceID == zeroTraceID {
		return remoteContext{}, false
	}
	if !isLowerHex(spanID, 16) || spanID == zeroSpanID {
		return remoteContext{}, false
	}
	if !isLowerHex(flags, 2) {
		return remoteContext{}, false
	}
	return remoteContext{traceID: traceID, spanID: spanID}, true
}

// formatTraceparent renders a header value for an outgoing call.
//
// Always version 00 with the sampled flag set: a span only reaches this code
// because it was captured, so from the peer's perspective the trace is
// sampled. Returns "" when the ids are not valid W3C ids.
func formatTraceparent(traceID, spanID string) string {
	if !isLowerHex(traceID, 32) || traceID == zeroTraceID {
		return ""
	}
	if !isLowerHex(spanID, 16) || spanID == zeroSpanID {
		return ""
	}
	return "00-" + traceID + "-" + spanID + "-01"
}

var (
	seedOnce sync.Once
	seed     remoteContext
	seedOK   bool
)

// envSeed returns the remote span this process was launched under, if any.
//
// Resolved once: the process environment cannot change mid-run, and this is
// consulted for every root span. Same reasoning as TraceparentSeed.java.
func envSeed() (remoteContext, bool) {
	seedOnce.Do(func() {
		raw, present := os.LookupEnv(EnvTraceparent)
		if !present || raw == "" {
			return
		}
		seed, seedOK = parseTraceparent(raw)
	})
	return seed, seedOK
}

// CurrentTraceparent returns the traceparent header for the span active on
// this goroutine, or "" when no span is active.
//
// Attach it to outgoing requests so the far side continues this trace rather
// than starting its own:
//
//	req, _ := http.NewRequest("GET", url, nil)
//	if tp := flowtracert.CurrentTraceparent(); tp != "" {
//		req.Header.Set("traceparent", tp)
//	}
//
// Unlike Node, Go does not attach this automatically — see the file comment.
func CurrentTraceparent() string {
	prev := runtime_getProfLabel()
	if prev == nil {
		return ""
	}
	list := (*Span)(prev).list
	traceID, hasTrace := findLabel(list, labelTraceID)
	spanID, hasSpan := findLabel(list, labelSpanID)
	if !hasTrace || !hasSpan {
		return ""
	}
	return formatTraceparent(traceID, spanID)
}

// SeedFromTraceparent adopts `header` as this goroutine's parent context, for
// a server that receives a traceparent on the wire rather than in the
// environment. Call it before the handler's traced work:
//
//	func handler(w http.ResponseWriter, r *http.Request) {
//		done := flowtracert.SeedFromTraceparent(r.Header.Get("traceparent"))
//		defer done()
//		... traced calls ...
//	}
//
// Returns a function that restores the goroutine's previous context. An
// invalid or empty header is a no-op returning a no-op restore, so the call
// site needs no error handling.
//
// The synthetic parent sits at depth -1 so the first *local* span lands at
// depth 0 — matching an ordinary root and satisfying the schema's
// `depth >= 0`. No event is ever emitted for the seed itself; the remote
// process already emitted it. This mirrors runWithRemoteContext in
// capture/node/src/runtime/context.js exactly.
func SeedFromTraceparent(header string) func() {
	remote, ok := parseTraceparent(header)
	if !ok {
		return func() {}
	}
	prev := runtime_getProfLabel()
	var existing []label
	if prev != nil {
		existing = (*Span)(prev).list
	}
	list := make([]label, 0, len(existing)+3)
	for _, l := range existing {
		if l.key == labelTraceID || l.key == labelSpanID || l.key == labelDepth {
			continue
		}
		list = append(list, l)
	}
	list = append(list,
		label{labelTraceID, remote.traceID},
		label{labelSpanID, remote.spanID},
		label{labelDepth, "-1"},
	)
	runtime_setProfLabel(unsafe.Pointer(&Span{list: list}))
	return func() { runtime_setProfLabel(prev) }
}
