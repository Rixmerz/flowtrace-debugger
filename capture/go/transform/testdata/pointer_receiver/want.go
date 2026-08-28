package fixture; import _ftrt "flowtracetest/internal/flowtracert"

type Calc struct {
	total int
}

func (c *Calc) Add(n int) (_ft_r0 int) {_ft_s := _ftrt.Enter("flowtracetest/fixture", "Calc", "Add", "public", "n", n); defer func() { if _ft_p := recover(); _ft_p != nil { _ftrt.ExitPanic(_ft_s, _ft_p); panic(_ft_p) }; _ftrt.Exit(_ft_s, _ft_r0) }();
	c.total += n
	return c.total
}
