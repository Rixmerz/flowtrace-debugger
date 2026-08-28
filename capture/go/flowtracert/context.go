package flowtracert

import (
	"fmt"
	"os"
	"strconv"
	"sync/atomic"
	"time"
	"unsafe"
)

// label mirrors the private type inside runtime/pprof
// (`type label struct{ key, value string }`). Field order and types must
// match exactly — see Span below.
type label struct {
	key, value string
}

// Span is an active traced call. It doubles as the payload FlowTrace stores
// in the goroutine's pprof label slot (g.labels) — see D3 in
// docs/changes/2026-08-27-go-capture-layer.md. newproc1 copies g.labels from
// parent to child for every plain `go` statement; that is the only
// mechanism in Go that propagates span context across a bare `go` with zero
// change to the user's code, which a tracer must not alter.
//
// runtime/pprof casts g.labels to *labelMap, defined as
// `struct{ list []label }`. list MUST therefore be Span's first field, with
// this exact layout — a differently-shaped pointer there crashes the
// profiler reading garbage as a slice header, and only once a span has a
// non-nil parent, so it will not show up in ordinary tests. See
// context_pprof_test.go for the regression test.
type Span struct {
	list []label // FIRST — pprof labelMap layout compatibility. Do not move or retype.

	traceID     string
	spanID      string
	parentID    string // "" for a root span
	depth       int
	module      string
	class       string
	method      string
	visibility  string
	args        map[string]any // already redacted/truncated; reused verbatim in the exit event
	startedAt   time.Time
	prevLabel   unsafe.Pointer // this goroutine's label slot value before the span was pushed
	goroutineID string         // captured once in Enter, reused by Exit/ExitPanic — see runtime.go's goroutineID(). Deliberately NOT part of `list`: that slice is what a child goroutine inherits via newproc1, and this call's own goroutine id must never leak into a child's "thread" field.
	entered     bool           // true once this span's "enter" event was actually written (emitter.go's cap can refuse it). Exit/ExitPanic only emit — uncapped, via emitForced — when this is true, so an "enter" with no "exit" keeps meaning "this call never returned", never "the cap dropped it".
}

// Keys FlowTrace stores inside the pprof label list to carry its own
// context. Namespaced so a real pprof label set by the traced program
// (pprof.Do, pprof.SetGoroutineLabels) never collides with ours.
const (
	labelTraceID = "flowtrace.trace_id"
	labelSpanID  = "flowtrace.span_id"
	labelDepth   = "flowtrace.depth"
)

// runtime_setProfLabel / runtime_getProfLabel are the same linknamed pair
// runtime/pprof itself uses to read and write g.labels (see
// runtime/proflabel.go: "widely used packages access it using linkname ...
// do not remove or change the type signature"). This is the fastest
// mechanism available for per-goroutine context that also propagates across
// a bare `go` statement — measured at ~1ns/op vs 1.3-14.4us for parsing
// runtime.Stack, and the only one of the two that inherits for free.

//go:linkname runtime_setProfLabel runtime/pprof.runtime_setProfLabel
func runtime_setProfLabel(labels unsafe.Pointer)

//go:linkname runtime_getProfLabel runtime/pprof.runtime_getProfLabel
func runtime_getProfLabel() unsafe.Pointer

var warnedForeignLabel atomic.Bool

// warnForeignLabel logs, once per process, that this goroutine's pprof label
// slot already held something FlowTrace did not put there — most likely
// pprof.Do/SetGoroutineLabels, or a library that uses the same linkname
// (cloudwego/localsession, timandy/routine). The slot is a single shared
// global; FlowTrace cannot recover a parent span it never wrote, so it
// degrades to treating the call as a root span rather than guessing.
func warnForeignLabel() {
	if warnedForeignLabel.CompareAndSwap(false, true) {
		fmt.Fprintln(os.Stderr, "[flowtrace] WARNING: goroutine pprof label slot already in use by something other than FlowTrace (pprof.Do, SetGoroutineLabels, or a library using the same runtime linkname) — span parentage degrades to root for affected calls")
	}
}

// findLabel does a linear scan of a label list — always tiny (FlowTrace's
// own 3 keys plus whatever the host program added), so no map is needed.
func findLabel(list []label, key string) (string, bool) {
	for _, l := range list {
		if l.key == key {
			return l.value, true
		}
	}
	return "", false
}

// enterSpan reads the calling goroutine's current context out of the pprof
// label slot, derives this call's trace/span/parent/depth from it, and
// installs a new Span in the slot so a nested call or a spawned goroutine
// inherits it. Existing entries in the slot (real pprof labels, or a
// foreign library's) are preserved rather than overwritten — "chain, don't
// clobber" — so FlowTrace and e.g. pprof.Do can coexist on the same
// goroutine.
//
// Reading `.list` off whatever is already in the slot is safe when that
// value is nil, one of FlowTrace's own *Span values, or a genuine
// runtime/pprof *labelMap — labelMap has this exact `struct{ list []label }`
// layout too. A non-pprof, non-FlowTrace consumer of the slot that stores a
// differently-shaped pointer (e.g. cloudwego/localsession) is a pre-existing
// risk of the shared pprof label slot itself, independent of FlowTrace — see
// "Risks accepted" in docs/changes/2026-08-27-go-capture-layer.md.
func enterSpan(module, class, method, visibility string, args map[string]any) *Span {
	prev := runtime_getProfLabel()
	var existing []label
	if prev != nil {
		existing = (*Span)(prev).list
	}

	parentTraceID, hasTrace := findLabel(existing, labelTraceID)
	parentSpanID, hasSpan := findLabel(existing, labelSpanID)
	hasParent := hasTrace && hasSpan
	if !hasParent && len(existing) > 0 {
		warnForeignLabel()
	}

	var traceID, parentID string
	depth := 0
	if hasParent {
		traceID = parentTraceID
		parentID = parentSpanID
		if dv, hasDepth := findLabel(existing, labelDepth); hasDepth {
			if d, err := strconv.Atoi(dv); err == nil {
				depth = d + 1
			}
		}
	} else if remote, seeded := envSeed(); seeded {
		// No local parent, but this process was launched under a caller's
		// traceparent (FLOWTRACE_TRACEPARENT). Adopt it so both halves of the
		// hop land in one tree. depth stays 0: this is still the first local
		// span, and the remote parent is not ours to emit.
		traceID = remote.traceID
		parentID = remote.spanID
	} else {
		traceID = newTraceID()
	}
	spanID := newSpanID()

	list := make([]label, 0, len(existing)+3)
	for _, l := range existing {
		if l.key == labelTraceID || l.key == labelSpanID || l.key == labelDepth {
			continue
		}
		list = append(list, l)
	}
	list = append(list,
		label{labelTraceID, traceID},
		label{labelSpanID, spanID},
		label{labelDepth, strconv.Itoa(depth)},
	)

	s := &Span{
		list:       list,
		traceID:    traceID,
		spanID:     spanID,
		parentID:   parentID,
		depth:      depth,
		module:     module,
		class:      class,
		method:     method,
		visibility: visibility,
		args:       args,
		startedAt:  time.Now(),
		prevLabel:  prev,
	}
	runtime_setProfLabel(unsafe.Pointer(s))
	return s
}

// exitSpan restores the goroutine's label slot to whatever it held before
// this span was pushed — the same parent/grandparent/foreign value, exactly.
func exitSpan(s *Span) {
	runtime_setProfLabel(s.prevLabel)
}
