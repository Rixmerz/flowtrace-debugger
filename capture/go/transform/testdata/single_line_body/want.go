package fixture; import _ftrt "flowtracetest/internal/flowtracert"

func One() (_ft_r0 int) {_ft_s := _ftrt.Enter("flowtracetest/fixture", "", "One", "public"); defer func() { if _ft_p := recover(); _ft_p != nil { _ftrt.ExitPanic(_ft_s, _ft_p); panic(_ft_p) }; _ftrt.Exit(_ft_s, _ft_r0) }(); return 1 }
