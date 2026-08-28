package flowtracert

import (
	"sync"
	"testing"
	"unsafe"
)

func TestEnterSpanRootHasNoParent(t *testing.T) {
	defer runtime_setProfLabel(nil)
	runtime_setProfLabel(nil)

	s := enterSpan("pkg", "", "Foo", "public", nil)
	defer exitSpan(s)

	if s.parentID != "" {
		t.Fatalf("root span parentID = %q, want empty", s.parentID)
	}
	if s.depth != 0 {
		t.Fatalf("root span depth = %d, want 0", s.depth)
	}
	if s.traceID == "" || s.spanID == "" {
		t.Fatalf("root span missing ids: %+v", s)
	}
}

func TestEnterSpanNestedSameGoroutineInherits(t *testing.T) {
	defer runtime_setProfLabel(nil)
	runtime_setProfLabel(nil)

	parent := enterSpan("pkg", "", "Outer", "public", nil)
	child := enterSpan("pkg", "", "Inner", "public", nil)

	if child.traceID != parent.traceID {
		t.Fatalf("child traceID = %s, want parent's %s", child.traceID, parent.traceID)
	}
	if child.parentID != parent.spanID {
		t.Fatalf("child parentID = %s, want parent spanID %s", child.parentID, parent.spanID)
	}
	if child.depth != parent.depth+1 {
		t.Fatalf("child depth = %d, want %d", child.depth, parent.depth+1)
	}

	exitSpan(child)
	exitSpan(parent)
}

func TestExitSpanRestoresParentContext(t *testing.T) {
	defer runtime_setProfLabel(nil)
	runtime_setProfLabel(nil)

	parent := enterSpan("pkg", "", "Outer", "public", nil)
	child := enterSpan("pkg", "", "Inner", "public", nil)
	exitSpan(child)

	// After the child exits, a sibling span must see the parent's context
	// again — not the child's.
	sibling := enterSpan("pkg", "", "Sibling", "public", nil)
	if sibling.parentID != parent.spanID {
		t.Fatalf("sibling parentID = %s, want parent spanID %s", sibling.parentID, parent.spanID)
	}
	if sibling.depth != parent.depth+1 {
		t.Fatalf("sibling depth = %d, want %d", sibling.depth, parent.depth+1)
	}
	exitSpan(sibling)
	exitSpan(parent)
}

func TestForeignLabelDetectedNotCrashed(t *testing.T) {
	defer runtime_setProfLabel(nil)

	// Simulate a foreign, non-FlowTrace label already on this goroutine
	// (e.g. from pprof.Do or another linkname consumer) — pprof-shaped, so
	// safe to read, but carrying none of FlowTrace's own keys.
	foreign := &Span{list: []label{{"someKey", "someValue"}}}
	runtime_setProfLabel(unsafe.Pointer(foreign))

	s := enterSpan("pkg", "", "Foo", "public", nil)
	defer exitSpan(s)

	if s.parentID != "" {
		t.Fatalf("expected root span when a foreign label is present, got parentID=%s", s.parentID)
	}
	if !warnedForeignLabel.Load() {
		t.Fatal("expected the foreign-label warning to have fired")
	}
}

func TestForeignLabelsPreservedWhenChaining(t *testing.T) {
	defer runtime_setProfLabel(nil)

	foreign := &Span{list: []label{{"customer", "acme"}}}
	runtime_setProfLabel(unsafe.Pointer(foreign))

	s := enterSpan("pkg", "", "Foo", "public", nil)
	defer exitSpan(s)

	got := (*Span)(runtime_getProfLabel())
	value, ok := findLabel(got.list, "customer")
	if !ok || value != "acme" {
		t.Fatalf("foreign label 'customer' was dropped instead of chained: %v", got.list)
	}
}

// TestGoroutineInheritanceNestedConcurrent is D3's central correctness
// claim: a plain `go` statement propagates the spawning span's context to
// the child goroutine via the pprof label slot with zero change to user
// code, and a child's own push must never leak back into its parent or
// siblings. Run with -race to catch any accidental shared mutable state.
func TestGoroutineInheritanceNestedConcurrent(t *testing.T) {
	defer runtime_setProfLabel(nil)
	runtime_setProfLabel(nil)

	root := enterSpan("pkg", "", "Root", "public", nil)
	defer exitSpan(root)

	const n = 20
	var wg sync.WaitGroup
	errs := make(chan string, n*4)

	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()

			child := enterSpan("pkg", "", "Child", "public", nil)
			if child.traceID != root.traceID {
				errs <- "child traceID mismatch"
			}
			if child.parentID != root.spanID {
				errs <- "child parentID mismatch"
			}
			if child.depth != root.depth+1 {
				errs <- "child depth mismatch"
			}

			var wg2 sync.WaitGroup
			for j := 0; j < 3; j++ {
				wg2.Add(1)
				go func() {
					defer wg2.Done()
					grandchild := enterSpan("pkg", "", "Grandchild", "public", nil)
					if grandchild.traceID != root.traceID {
						errs <- "grandchild traceID mismatch"
					}
					if grandchild.parentID != child.spanID {
						errs <- "grandchild parentID mismatch"
					}
					if grandchild.depth != child.depth+1 {
						errs <- "grandchild depth mismatch"
					}
					exitSpan(grandchild)
				}()
			}
			wg2.Wait()

			exitSpan(child)
		}()
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		t.Error(e)
	}

	// The root goroutine's own context must be untouched by any concurrent
	// child's push — this is what would fail if spans mutated shared state
	// instead of writing only to their own goroutine's label slot.
	after := enterSpan("pkg", "", "AfterChildren", "public", nil)
	if after.parentID != root.spanID {
		t.Fatalf("root's context leaked: AfterChildren parentID = %s, want root spanID %s", after.parentID, root.spanID)
	}
	if after.depth != root.depth+1 {
		t.Fatalf("root's context leaked: AfterChildren depth = %d, want %d", after.depth, root.depth+1)
	}
	exitSpan(after)
}
