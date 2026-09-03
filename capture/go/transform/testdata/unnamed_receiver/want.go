package fixture; import _ftrt "flowtracetest/internal/flowtracert"

type Calc2 struct {
	n int
}

func (*Calc2) Ping() (_ft_r0 string) {_ft_s := _ftrt.Enter("flowtracetest/fixture", "Calc2", "Ping", "public"); defer func() { if _ft_p := recover(); _ft_p != nil { _ftrt.ExitPanic(_ft_s, _ft_p); panic(_ft_p) }; _ftrt.Exit(_ft_s, "r0", _ft_r0) }();
	return "pong"
}
