// Package flowtracert is FlowTrace's Go v2 capture runtime.
//
// This package is copied byte-for-byte into the target module during an
// instrumented build (see docs/changes/2026-08-27-go-capture-layer.md, D1):
// the transformer overlays it in as "<user-module>/internal/flowtracert". It
// must therefore stay self-contained — stdlib only, no imports of its
// sibling packages under capture/go/ — and must compile under whatever `go`
// directive the target module declares, not this repo's own.
package flowtracert

import "crypto/rand"

const hexAlphabet = "0123456789abcdef"

// newTraceID returns a fresh W3C-compliant trace_id: 32 lowercase hex
// characters (128 random bits). See https://www.w3.org/TR/trace-context/.
func newTraceID() string {
	return randomHex(16)
}

// newSpanID returns a fresh W3C-compliant span_id: 16 lowercase hex
// characters (64 random bits).
func newSpanID() string {
	return randomHex(8)
}

// randomHex returns n random bytes, hex-encoded as 2n lowercase characters.
func randomHex(n int) string {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		// crypto/rand.Read only fails if the OS entropy source is
		// unavailable, which does not happen on any platform Go supports in
		// practice. The runtime must still never panic (see emitter.go), so
		// a failed read falls back to a weak, process-local generator
		// instead of an all-zero (collision-prone) ID.
		buf = fallbackRandomBytes(n)
	}
	out := make([]byte, n*2)
	for i, b := range buf {
		out[i*2] = hexAlphabet[b>>4]
		out[i*2+1] = hexAlphabet[b&0x0f]
	}
	return string(out)
}
