package fixture; import _ftrt "flowtracetest/internal/flowtracert"

func SumAll(nums ...int) (_ft_r0 int) {_ft_s := _ftrt.Enter("flowtracetest/fixture", "", "SumAll", "public", "nums", nums); defer func() { if _ft_p := recover(); _ft_p != nil { _ftrt.ExitPanic(_ft_s, _ft_p); panic(_ft_p) }; _ftrt.Exit(_ft_s, "r0", _ft_r0) }();
	total := 0
	for _, n := range nums {
		total += n
	}
	return total
}
