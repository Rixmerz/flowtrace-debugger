// Minimal Go sample for FlowTrace v2 golden fixture.
// Call tree: main() -> (*Calculator).Run() -> (*Calculator).Add(a,b) -> (*Calculator).validate(x).
// Also exercises AC1's three other required shapes: a returned non-nil
// error (Divide), a panic recovered upstream (SafeDivide), and a spawned
// goroutine whose span is parented under the spawning function (spawnAdd).
// No FlowTrace imports / build tags: zero source modification is the v2 contract.
package main

import (
	"errors"
	"fmt"
	"sync"
)

type Calculator struct{}

func (c *Calculator) Run() int {
	return c.Add(2, 3)
}

func (c *Calculator) Add(a, b int) int {
	c.validate(a)
	c.validate(b)
	return a + b
}

func (c *Calculator) validate(x int) {
	if x < 0 {
		panic(fmt.Sprintf("negative: %d", x))
	}
}

// Divide returns a non-nil error for division by zero — a returned error is
// ordinary Go control flow, not an exception, so it comes back through the
// normal result path and Exit's `error` field captures it (AC3).
func (c *Calculator) Divide(a, b int) (int, error) {
	if b == 0 {
		return 0, errors.New("division by zero")
	}
	return a / b, nil
}

// SafeDivide recovers a panic raised by validate. ExitPanic still fires for
// validate itself (D4 re-panics after capturing), but the panic never
// reaches main — SafeDivide's own recover stops it here, exercising AC1's
// "panic recovered upstream" case.
func (c *Calculator) SafeDivide(a, b int) (result int) {
	defer func() {
		if r := recover(); r != nil {
			result = -1
		}
	}()
	c.validate(b)
	return a / b
}

// spawnAdd runs Add in its own goroutine — AC1's "spawned goroutine" case:
// its span must carry spawnAdd's span_id as parent_id, in the same
// trace_id, even though it executes on a different goroutine. The
// WaitGroup keeps the trace deterministic: Add's enter and exit are
// guaranteed to happen, in order, before spawnAdd itself returns.
func (c *Calculator) spawnAdd(a, b int) int {
	var wg sync.WaitGroup
	result := 0
	wg.Add(1)
	go func() {
		defer wg.Done()
		result = c.Add(a, b)
	}()
	wg.Wait()
	return result
}

func main() {
	c := &Calculator{}
	fmt.Println(c.Run())

	if _, err := c.Divide(1, 0); err != nil {
		fmt.Println("divide error:", err)
	}

	fmt.Println(c.SafeDivide(10, -1))
	fmt.Println(c.spawnAdd(4, 5))
}
