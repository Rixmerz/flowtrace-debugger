package fixture; import _ftrt "flowtracetest/internal/flowtracert"

type Repo[T any] struct {
	items []T
}

func (r *Repo[T]) Get(i int) (_ft_r0 T, _ft_r1 error) {_ft_s := _ftrt.Enter("flowtracetest/fixture", "Repo", "Get", "public", "i", i); defer func() { if _ft_p := recover(); _ft_p != nil { _ftrt.ExitPanic(_ft_s, _ft_p); panic(_ft_p) }; _ftrt.Exit(_ft_s, "r0", _ft_r0, "r1", _ft_r1) }();
	return r.items[i], nil
}
