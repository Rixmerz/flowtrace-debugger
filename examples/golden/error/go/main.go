// Error-path golden fixture — Go.
//
// Mirrors examples/golden/error/python's shape — two traced frames deep so the
// fixture asserts more than "a failure is recorded" — for the two ways a Go
// call fails:
//
//   - a returned non-nil error: inner() returns one, outer() propagates it
//     unchanged, so BOTH exit events must carry `error` (and `result` still
//     holds the returned values);
//   - a panic recovered by a caller: explode() panics, shield() recovers and
//     turns it into its named `err` result, so explode's exit carries the
//     panic as `error` and shield's exit carries the *returned* error under
//     the declared result name — and main, one frame further up, sees no
//     failure at all.
//
// Both failures are handled inside main, so the process exits 0 and the
// trace contains exactly five enter/exit pairs. No FlowTrace imports.
package main

import "fmt"

func inner(n int) error {
	return fmt.Errorf("inner refused %d", n)
}

func outer(n int) error {
	return inner(n)
}

func explode(n int) int {
	panic(fmt.Sprintf("explode refused %d", n))
}

func shield(n int) (result int, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("recovered: %v", r)
		}
	}()
	result = explode(n)
	return result, nil
}

func main() {
	if err := outer(7); err != nil {
		fmt.Println("caught:", err)
	}
	if _, err := shield(7); err != nil {
		fmt.Println("recovered:", err)
	}
}
