package fixture

import (_ftrt "flowtracetest/internal/flowtracert"; "fmt")

// Greeter greets people.
type Greeter struct {
	prefix string
}

// NewGreeter builds a Greeter with the given prefix.
func NewGreeter(prefix string) (_ft_r0 *Greeter) {_ft_s := _ftrt.Enter("flowtracetest/fixture", "", "NewGreeter", "public", "prefix", prefix); defer func() { if _ft_p := recover(); _ft_p != nil { _ftrt.ExitPanic(_ft_s, _ft_p); panic(_ft_p) }; _ftrt.Exit(_ft_s, "r0", _ft_r0) }();
	return &Greeter{prefix: prefix}
}

// Greet returns a greeting for name.
func (g *Greeter) Greet(name string) (_ft_r0 string) {_ft_s := _ftrt.Enter("flowtracetest/fixture", "Greeter", "Greet", "public", "name", name); defer func() { if _ft_p := recover(); _ft_p != nil { _ftrt.ExitPanic(_ft_s, _ft_p); panic(_ft_p) }; _ftrt.Exit(_ft_s, "r0", _ft_r0) }();
	msg := fmt.Sprintf("%s, %s!", g.prefix, name)
	return msg
}

func multiLine(
	a int,
	b int,
) (
	sum int,
	err error,
) {_ft_s := _ftrt.Enter("flowtracetest/fixture", "", "multiLine", "private", "a", a, "b", b); defer func() { if _ft_p := recover(); _ft_p != nil { _ftrt.ExitPanic(_ft_s, _ft_p); panic(_ft_p) }; _ftrt.Exit(_ft_s, "sum", sum, "err", err) }();
	sum = a + b
	return
}
