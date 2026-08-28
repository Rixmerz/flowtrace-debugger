package fixture; import _ftrt "flowtracetest/internal/flowtracert"

func Touch(n *int) {_ft_s := _ftrt.Enter("flowtracetest/fixture", "", "Touch", "public", "n", n); defer func() { if _ft_p := recover(); _ft_p != nil { _ftrt.ExitPanic(_ft_s, _ft_p); panic(_ft_p) }; _ftrt.Exit(_ft_s) }();
	*n++
}
