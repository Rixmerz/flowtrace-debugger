package fixture; import _ftrt "flowtracetest/internal/flowtracert"

func Sum(a, b int) (_ft_r0 int) {_ft_s := _ftrt.Enter("flowtracetest/fixture", "", "Sum", "public", "a", a, "b", b); defer func() { if _ft_p := recover(); _ft_p != nil { _ftrt.ExitPanic(_ft_s, _ft_p); panic(_ft_p) }; _ftrt.Exit(_ft_s, _ft_r0) }();
	return a + b
}
