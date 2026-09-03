// SPDX-License-Identifier: MIT

package flowtracert

import (
	"sync/atomic"
	"time"
)

var fallbackCounter uint64

// fallbackRandomBytes is used only when crypto/rand.Read errors (see
// randomHex). Not cryptographically secure — it exists purely so a broken
// entropy source degrades to distinguishable, non-colliding IDs instead of a
// panic or a silent all-zero ID.
func fallbackRandomBytes(n int) []byte {
	seed := uint64(time.Now().UnixNano()) ^ atomic.AddUint64(&fallbackCounter, 1)
	buf := make([]byte, n)
	for i := range buf {
		// splitmix64-style mix — cheap, deterministic-given-seed, good
		// enough to avoid collisions in this fallback-only path.
		seed += 0x9E3779B97F4A7C15
		z := seed
		z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9
		z = (z ^ (z >> 27)) * 0x94D049BB133111EB
		z = z ^ (z >> 31)
		buf[i] = byte(z)
	}
	return buf
}
