package fixture; import _ftrt "flowtracetest/internal/flowtracert"

func Lookup(m map[string]int, k string) (v int, _ft_r1 error) {_ft_s := _ftrt.Enter("flowtracetest/fixture", "", "Lookup", "public", "m", m, "k", k); defer func() { if _ft_p := recover(); _ft_p != nil { _ftrt.ExitPanic(_ft_s, _ft_p); panic(_ft_p) }; _ftrt.Exit(_ft_s, v, _ft_r1) }();
	v = m[k]
	return
}
