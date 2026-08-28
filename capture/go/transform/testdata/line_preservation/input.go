package fixture

import "fmt"

// Greeter greets people.
type Greeter struct {
	prefix string
}

// NewGreeter builds a Greeter with the given prefix.
func NewGreeter(prefix string) *Greeter {
	return &Greeter{prefix: prefix}
}

// Greet returns a greeting for name.
func (g *Greeter) Greet(name string) string {
	msg := fmt.Sprintf("%s, %s!", g.prefix, name)
	return msg
}

func multiLine(
	a int,
	b int,
) (
	sum int,
	err error,
) {
	sum = a + b
	return
}
