package fixture

import (_ftrt "flowtracetest/internal/flowtracert"; "errors")

func Divide(a, b int) (quotient int, err error) {_ft_s := _ftrt.Enter("flowtracetest/fixture", "", "Divide", "public", "a", a, "b", b); defer func() { if _ft_p := recover(); _ft_p != nil { _ftrt.ExitPanic(_ft_s, _ft_p); panic(_ft_p) }; _ftrt.Exit(_ft_s, "quotient", quotient, "err", err) }();
	if b == 0 {
		err = errors.New("divide by zero")
		return
	}
	quotient = a / b
	return
}
