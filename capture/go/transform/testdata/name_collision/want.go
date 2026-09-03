package fixture; import _ftrt "flowtracetest/internal/flowtracert"

func Weird(_ft_s int) (_ft_r0_2 int, _ft_r1 error) {_ft_s_2 := _ftrt.Enter("flowtracetest/fixture", "", "Weird", "public", "_ft_s", _ft_s); defer func() { if _ft_p := recover(); _ft_p != nil { _ftrt.ExitPanic(_ft_s_2, _ft_p); panic(_ft_p) }; _ftrt.Exit(_ft_s_2, "r0", _ft_r0_2, "r1", _ft_r1) }();
	_ft_r0 := _ft_s * 2
	return _ft_r0, nil
}
