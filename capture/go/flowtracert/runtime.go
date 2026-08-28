// Public API injected into every instrumented function/method (AC1). The
// transformer generates one call to Enter, followed by a deferred closure
// that calls either ExitPanic (on a recovered panic, re-raised immediately
// after) or Exit (on normal return) — see the design doc's injected-code
// shape. This file also owns argument/result serialization (AC4).
package flowtracert

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"runtime"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"time"
)

// maxSerializeDepth bounds reflect-based traversal of struct/map/slice/array
// values so a deeply nested (or self-referential-through-pointers) argument
// cannot blow the stack. Chosen empirically, not configurable — the other
// capture layers do not expose this as an env var either.
const maxSerializeDepth = 6

// Enter is called at the start of every instrumented function or method.
//
// module is the package's import path relative to the module root; class is
// the receiver type name for a method ("" for a package-level function);
// method is the function/method name; visibility is "public" or "private"
// per Go's exported-identifier rule (Go has no third case). argPairs
// alternates parameter name, value, name, value, ... in declaration order.
func Enter(module, class, method, visibility string, argPairs ...any) *Span {
	keys := redactKeys()
	maxLen := maxArgLength()

	args := make(map[string]any, len(argPairs)/2)
	for i := 0; i+1 < len(argPairs); i += 2 {
		name, _ := argPairs[i].(string)
		args[name] = serializeNamed(name, argPairs[i+1], keys, maxLen)
	}

	s := enterSpan(module, class, method, visibility, args)
	// Captured once here, not per event: goroutineID() scales with call
	// depth (see its doc comment), and Exit/ExitPanic run in the same
	// goroutine as this Enter — a deferred closure never hops goroutines —
	// so re-reading it on exit would only pay that cost again for the same
	// answer. Stored on the Span itself, deliberately not in `s.list`
	// (the pprof label slot payload a child goroutine inherits via
	// newproc1): if it lived there, a child would report its parent's
	// goroutine id instead of its own.
	s.goroutineID = goroutineID()

	s.entered = emit(map[string]any{
		"ts":         nowSeconds(),
		"trace_id":   s.traceID,
		"span_id":    s.spanID,
		"parent_id":  nullableString(s.parentID),
		"event":      "enter",
		"thread":     s.goroutineID,
		"lang":       "go",
		"module":     module,
		"class":      class,
		"method":     method,
		"visibility": visibility,
		"args":       args,
		"depth":      s.depth,
	})
	return s
}

// Exit is called when an instrumented function's body returns normally.
// results holds the function's named results' values, in declaration order
// — a returned non-nil error is ordinary Go control flow rather than an
// exception, so the first one found among results populates the event's
// `error` field the same way a panic does (AC3): a returned error is
// exactly what a Go developer is debugging, and it is what makes
// trace_find_error useful for Go traces.
func Exit(s *Span, results ...any) {
	if s == nil {
		return
	}
	defer exitSpan(s)
	if !s.entered {
		// This span's "enter" never made it into the trace (emitter.go's
		// cap refused it) — emitting the exit anyway would leave an "exit"
		// with no matching "enter" in the JSONL. Skip both, symmetrically.
		return
	}

	duration := time.Since(s.startedAt).Nanoseconds()
	keys := redactKeys()
	maxLen := maxArgLength()

	result := make(map[string]any, len(results))
	var errObj map[string]any
	for i, r := range results {
		key := "r" + strconv.Itoa(i)
		result[key] = serializeNamed(key, r, keys, maxLen)
		if errObj == nil {
			if e := asNonNilError(r); e != nil {
				errObj = buildErrorObject(e, []string{})
			}
		}
	}

	event := map[string]any{
		"ts":          nowSeconds(),
		"trace_id":    s.traceID,
		"span_id":     s.spanID,
		"parent_id":   nullableString(s.parentID),
		"event":       "exit",
		"thread":      s.goroutineID,
		"lang":        "go",
		"module":      s.module,
		"class":       s.class,
		"method":      s.method,
		"visibility":  s.visibility,
		"args":        s.args,
		"result":      result,
		"duration_ns": duration,
		"depth":       s.depth,
	}
	if errObj != nil {
		event["error"] = errObj
	}
	emitForced(event)
}

// ExitPanic is called from the recovering defer when the instrumented
// function's body panicked. p is the recovered value; the caller re-panics
// with it immediately afterwards (see the design doc's injected-code
// shape), so the traced program's behavior — including its exit code and
// any outer recover — is unchanged.
func ExitPanic(s *Span, p any) {
	if s == nil {
		return
	}
	defer exitSpan(s)
	if !s.entered {
		// Same reasoning as Exit: no "enter" was recorded for this span
		// (emitter.go's cap refused it), so there is no exit to close either
		// — an unpaired "exit" would be just as misleading as an unpaired
		// "enter".
		return
	}

	duration := time.Since(s.startedAt).Nanoseconds()

	event := map[string]any{
		"ts":          nowSeconds(),
		"trace_id":    s.traceID,
		"span_id":     s.spanID,
		"parent_id":   nullableString(s.parentID),
		"event":       "exit",
		"thread":      s.goroutineID,
		"lang":        "go",
		"module":      s.module,
		"class":       s.class,
		"method":      s.method,
		"visibility":  s.visibility,
		"args":        s.args,
		"result":      map[string]any{},
		"error":       buildPanicErrorObject(p),
		"duration_ns": duration,
		"depth":       s.depth,
	}
	emitForced(event)
}

// ---------------------------------------------------------------------------
// thread field (AC3)
// ---------------------------------------------------------------------------

// goroutineID returns "goroutine-<id>" for the `thread` field.
//
// Unlike span parentage (context.go, D3), Go gives no O(1) stdlib-only way
// to read a goroutine's numeric id — the pprof label slot solves
// *inheritance* across a bare `go` statement, not identity, and nothing
// else in the standard library exposes it. The only source is the header
// line runtime.Stack prints ("goroutine 123 [running]:"), and that call's
// cost scales with the current call depth regardless of buffer size
// (measured: ~1.4us shallow, ~13.6us at depth 50 — matching the design
// doc's numbers for the same primitive, D3). This is a deliberate,
// documented cost paid once per call, independent of the O(1)
// context-propagation path used for parent/child/trace_id — Enter is this
// function's only caller, caching the result on the Span so Exit/ExitPanic
// reuse it instead of paying the same depth-scaling cost again for the same
// answer (a deferred closure never changes goroutine, so it is still valid).
func goroutineID() string {
	var buf [64]byte
	n := runtime.Stack(buf[:], false)
	b := buf[:n]
	const prefix = "goroutine "
	if !bytes.HasPrefix(b, []byte(prefix)) {
		return "goroutine-unknown"
	}
	b = b[len(prefix):]
	sp := bytes.IndexByte(b, ' ')
	if sp < 0 {
		return "goroutine-unknown"
	}
	id := string(b[:sp])
	if _, err := strconv.ParseUint(id, 10, 64); err != nil {
		return "goroutine-unknown"
	}
	return "goroutine-" + id
}

func nowSeconds() float64 {
	return float64(time.Now().UnixNano()) / 1e9
}

func nullableString(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// ---------------------------------------------------------------------------
// error / panic capture (AC3)
// ---------------------------------------------------------------------------

// asNonNilError returns r as an error if it is a non-nil error. Guards
// against the classic Go footgun where a typed nil pointer boxed in an
// error interface compares != nil to the untyped nil literal — treating
// such a value as "no error" would silently drop a genuine bug signal, but
// calling .Error() on it is exactly what buildErrorObject already recovers
// from.
func asNonNilError(r any) error {
	if r == nil {
		return nil
	}
	e, ok := r.(error)
	if !ok {
		return nil
	}
	return e
}

func buildErrorObject(e error, stack []string) map[string]any {
	if stack == nil {
		stack = []string{}
	}
	return map[string]any{
		"type":  reflect.TypeOf(e).String(),
		"msg":   safeErrorMessage(e),
		"stack": stack,
	}
}

// errorMessageTimeout bounds how long safeErrorMessage waits for e.Error()
// before giving up on it. Chosen to be far longer than any real Error()
// implementation should ever take, and far shorter than a human would wait
// on a hung trace.
const errorMessageTimeout = 2 * time.Second

// errorMessageCircuitTripped tracks, per error type, whether an e.Error()
// call on that type has already missed errorMessageTimeout. It is keyed by
// type rather than global: a lock held across one Error() call is very
// likely held the same way by every subsequent call on the *same* type (same
// mutex, same code path), so retrying and waiting out the full timeout again
// for each one only stacks up wall-clock time and leaks one abandoned
// goroutine per call — the goroutine below is never told to stop, because Go
// has no way to cancel a blocked function it does not control. But nothing
// says a type that misbehaves this way says anything about an unrelated
// error type elsewhere in the same run, so tripping the breaker for one type
// must not silently degrade AC3/trace_find_error for every other error the
// rest of the process sees. Once tripped for a type, safeErrorMessage
// answers with the fallback marker directly for that type, spawning nothing
// further, for the rest of the process — other types are unaffected.
var errorMessageCircuitTripped sync.Map // map[string /* reflect type name */]bool

// safeErrorMessage calls e.Error(). Unlike argument/result serialization
// (AC4), this does invoke user code — there is no way to describe a Go
// error without it, and every other FlowTrace capture layer does the same
// (Python's str(exc), Java's getMessage(), Node's err.message).
//
// A plain recover-guarded call is not enough here: recover only catches a
// panic, and Error() can just as easily block forever taking a mutex a
// frame further up the traced call already holds — recover cannot unblock a
// deadlock, only a panic. So Error() runs on its own goroutine with a hard
// deadline: if it returns (or panics) in time, that result is used; if it
// doesn't, the goroutine is abandoned — not because the traced program is
// deadlocked (it keeps running; only this one Error() call, and whatever it
// holds a lock against, is stuck) — and a fallback message is emitted
// instead of hanging the traced program's own call stack. See
// errorMessageCircuitTripped above for why a second call does not repeat
// the wait.
func safeErrorMessage(e error) string {
	typeName := reflect.TypeOf(e).String()
	if tripped, ok := errorMessageCircuitTripped.Load(typeName); ok && tripped.(bool) {
		return fmt.Sprintf("<Error() skipped — a previous call on type %s did not return within %s, so no further ones on that type are attempted this process>", typeName, errorMessageTimeout)
	}

	done := make(chan string, 1)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				done <- fmt.Sprintf("<panic calling Error(): %v>", r)
			}
		}()
		done <- e.Error()
	}()

	select {
	case msg := <-done:
		return msg
	case <-time.After(errorMessageTimeout):
		errorMessageCircuitTripped.Store(typeName, true)
		return fmt.Sprintf("<Error() on type %s did not return within %s — likely blocked on a lock the caller already holds>", typeName, errorMessageTimeout)
	}
}

// resetErrorMessageCircuitBreakerForTest clears every tripped type, for
// tests that need to exercise safeErrorMessage's timeout path themselves
// without depending on whether some earlier test in the same suite already
// tripped the breaker for the same error type.
func resetErrorMessageCircuitBreakerForTest() {
	errorMessageCircuitTripped.Range(func(key, _ any) bool {
		errorMessageCircuitTripped.Delete(key)
		return true
	})
}

func buildPanicErrorObject(p any) map[string]any {
	stack := panicStackLines()
	if e, ok := p.(error); ok && e != nil {
		return buildErrorObject(e, stack)
	}
	if str, ok := p.(string); ok {
		return map[string]any{"type": "string", "msg": str, "stack": stack}
	}
	if p == nil {
		return map[string]any{"type": "unknown", "msg": "panic(nil)", "stack": stack}
	}
	return map[string]any{
		"type":  reflect.TypeOf(p).String(),
		"msg":   safePanicString(p),
		"stack": stack,
	}
}

func safePanicString(p any) (msg string) {
	defer func() {
		if r := recover(); r != nil {
			msg = fmt.Sprintf("<panic formatting panic value: %v>", r)
		}
	}()
	return fmt.Sprint(p)
}

// panicStackLines captures the stack at the point of recovery. debug.Stack
// (runtime/debug, stdlib) is safe to call here — it walks the runtime's own
// frame data, never user code — and, called from inside the recovering
// defer, still shows the frames leading up to the panic: deferred functions
// run before the runtime finishes unwinding the panicking call's frame.
// Capped at 20 lines, matching the Python runtime's traceback cap.
func panicStackLines() []string {
	raw := strings.TrimRight(string(debug.Stack()), "\n")
	lines := strings.Split(raw, "\n")
	if len(lines) > 20 {
		lines = lines[:20]
	}
	return lines
}

// ---------------------------------------------------------------------------
// env-var contracts shared with the other capture layers (AC4)
// ---------------------------------------------------------------------------

func maxArgLength() int {
	raw := os.Getenv("FLOWTRACE_MAX_ARG_LENGTH")
	if raw == "" {
		return 512
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return 512
	}
	if n < 0 {
		return 0
	}
	return n
}

var defaultRedactKeys = []string{
	"password", "secret", "token", "authorization",
	"api_key", "url", "dsn", "connection_string", "email",
}

// redactKeys returns the default redact-key substrings plus whatever
// FLOWTRACE_REDACT_KEYS adds — additive, never a replacement, same contract
// as the other capture layers.
func redactKeys() []string {
	keys := make([]string, 0, len(defaultRedactKeys)+4)
	seen := make(map[string]bool, len(defaultRedactKeys)+4)
	for _, k := range defaultRedactKeys {
		keys = append(keys, k)
		seen[k] = true
	}
	raw := os.Getenv("FLOWTRACE_REDACT_KEYS")
	if raw != "" {
		for _, part := range strings.Split(raw, ",") {
			k := strings.ToLower(strings.TrimSpace(part))
			if k != "" && !seen[k] {
				keys = append(keys, k)
				seen[k] = true
			}
		}
	}
	return keys
}

func isRedactedKey(name string, keys []string) bool {
	lowered := strings.ToLower(name)
	for _, k := range keys {
		if strings.Contains(lowered, k) {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// argument/result serialization (AC4)
// ---------------------------------------------------------------------------

// serializeNamed redacts by name, then serializes and truncates a single
// top-level argument or result value.
func serializeNamed(name string, v any, keys []string, maxLen int) any {
	if isRedactedKey(name, keys) {
		return "<redacted>"
	}
	safe := serializeValue(reflect.ValueOf(v), maxSerializeDepth, keys)
	return truncateIfNeeded(safe, maxLen)
}

// truncateIfNeeded replaces an already-serialized value with a truncation
// marker if its JSON form exceeds maxLen. maxLen <= 0 disables truncation.
// Safe to json.Marshal here: v is by construction plain
// nil/bool/int64/uint64/float64/string/map[string]any/[]any — never a user
// type, so no custom MarshalJSON can run.
func truncateIfNeeded(v any, maxLen int) any {
	if maxLen <= 0 {
		return v
	}
	b, err := json.Marshal(v)
	s := string(b)
	if err != nil {
		s = fmt.Sprintf("%v", v)
	}
	if len(s) > maxLen {
		return fmt.Sprintf("<truncated:%s...>", s[:maxLen])
	}
	return v
}

// serializeValue converts an arbitrary Go value into something JSON-safe
// using only reflect — bool/numeric/string kinds directly, struct/map/
// slice/array/pointer/interface recursively down to depth, everything else
// (chan, func, unsafe pointer, complex numbers, or anything past depth)
// falls back to its type name. It never calls a method on the user's
// value — no String(), no Error(), no MarshalJSON — so it cannot be made to
// take a lock the traced function already holds (AC4).
func serializeValue(v reflect.Value, depth int, keys []string) any {
	if !v.IsValid() {
		return nil
	}
	switch v.Kind() {
	case reflect.Bool:
		return v.Bool()
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return v.Int()
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
		return v.Uint()
	case reflect.Float32, reflect.Float64:
		return v.Float()
	case reflect.String:
		return v.String()
	case reflect.Interface:
		if v.IsNil() {
			return nil
		}
		return serializeValue(v.Elem(), depth, keys)
	case reflect.Ptr:
		if v.IsNil() {
			return nil
		}
		if depth <= 0 {
			return typeNameFallback(v)
		}
		return serializeValue(v.Elem(), depth-1, keys)
	case reflect.Struct:
		if depth <= 0 {
			return typeNameFallback(v)
		}
		return serializeStruct(v, depth, keys)
	case reflect.Map:
		if v.IsNil() {
			return nil
		}
		if depth <= 0 {
			return typeNameFallback(v)
		}
		return serializeMap(v, depth, keys)
	case reflect.Slice:
		if v.IsNil() {
			return nil
		}
		if depth <= 0 {
			return typeNameFallback(v)
		}
		return serializeSequence(v, depth, keys)
	case reflect.Array:
		if depth <= 0 {
			return typeNameFallback(v)
		}
		return serializeSequence(v, depth, keys)
	default:
		// Chan, Func, UnsafePointer, Complex64/128, ... — never invoke user
		// code; fall back to the type name.
		return typeNameFallback(v)
	}
}

func typeNameFallback(v reflect.Value) string {
	return fmt.Sprintf("<%s>", v.Type().String())
}

func serializeStruct(v reflect.Value, depth int, keys []string) map[string]any {
	t := v.Type()
	out := make(map[string]any, t.NumField())
	for i := 0; i < t.NumField(); i++ {
		f := t.Field(i)
		if f.PkgPath != "" {
			// Unexported field: reflect.Value.Interface() would panic, and
			// there is nothing a caller outside the package could have read
			// anyway.
			continue
		}
		if isRedactedKey(f.Name, keys) {
			out[f.Name] = "<redacted>"
			continue
		}
		out[f.Name] = serializeValue(v.Field(i), depth-1, keys)
	}
	return out
}

func serializeMap(v reflect.Value, depth int, keys []string) map[string]any {
	out := make(map[string]any, v.Len())
	iter := v.MapRange()
	for iter.Next() {
		k := safeKeyString(iter.Key())
		if isRedactedKey(k, keys) {
			out[k] = "<redacted>"
			continue
		}
		out[k] = serializeValue(iter.Value(), depth-1, keys)
	}
	return out
}

// safeKeyString converts a map key to a string using only reflect's own
// accessors — never a user-defined String()/Error(), for the same reason
// serializeValue never calls one.
func safeKeyString(k reflect.Value) string {
	switch k.Kind() {
	case reflect.String:
		return k.String()
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return strconv.FormatInt(k.Int(), 10)
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
		return strconv.FormatUint(k.Uint(), 10)
	case reflect.Bool:
		return strconv.FormatBool(k.Bool())
	case reflect.Float32, reflect.Float64:
		return strconv.FormatFloat(k.Float(), 'g', -1, 64)
	default:
		return fmt.Sprintf("<%s>", k.Type().String())
	}
}

func serializeSequence(v reflect.Value, depth int, keys []string) []any {
	n := v.Len()
	out := make([]any, n)
	for i := 0; i < n; i++ {
		out[i] = serializeValue(v.Index(i), depth-1, keys)
	}
	return out
}
