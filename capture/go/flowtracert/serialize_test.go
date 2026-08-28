package flowtracert

import (
	"reflect"
	"sync"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// AC4: reflect-based serialization never invokes user code, and cannot hang
// the traced program even when a user type's MarshalJSON takes a lock the
// caller already holds.
// ---------------------------------------------------------------------------

// lockingPayload's MarshalJSON takes mu — exactly the shape of value
// encoding/json would deadlock on if the caller already holds mu.
// serializeValue must never reach it: it walks struct fields via reflect
// alone and never calls a method on the user's value.
type lockingPayload struct {
	mu    *sync.Mutex
	Value int
}

func (p lockingPayload) MarshalJSON() ([]byte, error) {
	p.mu.Lock() // would deadlock: the test already holds this lock
	defer p.mu.Unlock()
	return []byte(`{"value":0}`), nil
}

const deadlockTestTimeout = 5 * time.Second

func TestSerializeValueNeverDeadlocksOnHeldLock(t *testing.T) {
	var mu sync.Mutex
	mu.Lock()
	defer mu.Unlock()
	payload := lockingPayload{mu: &mu, Value: 42}

	done := make(chan any, 1)
	go func() {
		done <- serializeValue(reflect.ValueOf(payload), maxSerializeDepth, nil)
	}()

	select {
	case result := <-done:
		m, ok := result.(map[string]any)
		if !ok {
			t.Fatalf("expected a map for a struct value, got %T: %v", result, result)
		}
		if m["Value"] != int64(42) {
			t.Errorf("Value = %v, want 42", m["Value"])
		}
		// mu is an unexported field: must be skipped, not dereferenced.
		if _, present := m["mu"]; present {
			t.Errorf("unexported field 'mu' leaked into serialized output: %v", m)
		}
	case <-time.After(deadlockTestTimeout):
		t.Fatal("serializeValue deadlocked on a lock held by the caller — AC4 violated")
	}
}

// TestEnterNeverDeadlocksThroughPublicAPI is the AC4 acceptance test as
// specified: a fixture argument type whose MarshalJSON takes a mutex the
// caller already holds must trace through the real Enter() without hanging.
func TestEnterNeverDeadlocksThroughPublicAPI(t *testing.T) {
	runtime_setProfLabel(nil)
	var mu sync.Mutex
	mu.Lock()
	defer mu.Unlock()
	payload := lockingPayload{mu: &mu, Value: 7}

	done := make(chan *Span, 1)
	go func() {
		done <- Enter("myapp/service", "", "TakesLockedArg", "public", "payload", payload)
	}()

	select {
	case s := <-done:
		if s == nil {
			t.Fatal("Enter returned nil Span")
		}
		Exit(s, nil)
	case <-time.After(deadlockTestTimeout):
		t.Fatal("Enter deadlocked serializing an argument whose MarshalJSON takes a held lock — AC4 violated")
	}
}

// ---------------------------------------------------------------------------
// AC4: error/panic reporting must not deadlock either. json.Marshal-style
// argument capture (above) never calls user code at all, but describing an
// error is unavoidable user code (e.Error()) — a plain recover() guard
// catches a panic from it but not a deadlock, since recover cannot unblock a
// goroutine stuck on a mutex.
// ---------------------------------------------------------------------------

// lockingError's Error() takes mu — exactly the shape of value that would
// deadlock safeErrorMessage if it called Error() directly on the caller's
// own goroutine instead of racing it against a deadline.
type lockingError struct {
	mu *sync.Mutex
}

func (e *lockingError) Error() string {
	e.mu.Lock() // would deadlock: the test already holds this lock
	defer e.mu.Unlock()
	return "locked error"
}

func TestSafeErrorMessageNeverDeadlocksOnHeldLock(t *testing.T) {
	resetErrorMessageCircuitBreakerForTest()
	var mu sync.Mutex
	mu.Lock()
	defer mu.Unlock()
	e := &lockingError{mu: &mu}

	done := make(chan string, 1)
	go func() {
		done <- safeErrorMessage(e)
	}()

	select {
	case msg := <-done:
		if msg == "" || msg == "locked error" {
			t.Errorf("expected a fallback message, not the real (unreachable) Error() result, got %q", msg)
		}
	case <-time.After(deadlockTestTimeout):
		t.Fatal("safeErrorMessage deadlocked calling Error() on a value whose Error() takes a held lock — AC4 violated")
	}
}

// TestExitPanicNeverDeadlocksOnErrorMethod is the AC4 acceptance test for a
// panic value: the exact shape review reported — a panic value whose
// Error() takes a mutex a frame above already holds — traced through the
// real Enter()/ExitPanic() without hanging.
func TestExitPanicNeverDeadlocksOnErrorMethod(t *testing.T) {
	resetErrorMessageCircuitBreakerForTest()
	runtime_setProfLabel(nil)
	var mu sync.Mutex
	mu.Lock()
	defer mu.Unlock()

	offset := snapshotOffset(t)
	done := make(chan struct{})
	go func() {
		defer close(done)
		s := Enter("myapp/service", "", "PanicsWithLockedError", "public")
		func() {
			defer func() {
				if p := recover(); p != nil {
					ExitPanic(s, p)
				}
			}()
			panic(&lockingError{mu: &mu})
		}()
	}()

	select {
	case <-done:
		events := readEventsSince(t, offset)
		exit := events[len(events)-1]
		errObj, ok := exit["error"].(map[string]any)
		if !ok {
			t.Fatalf("exit.error missing or wrong shape: %v", exit["error"])
		}
		msg, _ := errObj["msg"].(string)
		if msg == "" || msg == "locked error" {
			t.Errorf("expected a fallback message, not the real (unreachable) Error() result, got %q", msg)
		}
	case <-time.After(deadlockTestTimeout):
		t.Fatal("ExitPanic's error reporting deadlocked calling Error() on a panic value whose Error() takes a held lock — AC4 violated")
	}
}
