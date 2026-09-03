package fixture

import (_ftrt "flowtracetest/internal/flowtracert"; 
	"errors"
	"fmt"
)

func Parse(s string) (_ft_r0 int, _ft_r1 error) {_ft_s := _ftrt.Enter("flowtracetest/fixture", "", "Parse", "public", "s", s); defer func() { if _ft_p := recover(); _ft_p != nil { _ftrt.ExitPanic(_ft_s, _ft_p); panic(_ft_p) }; _ftrt.Exit(_ft_s, "r0", _ft_r0, "r1", _ft_r1) }();
	if s == "" {
		return 0, errors.New("empty input")
	}
	fmt.Sprint(s)
	return len(s), nil
}
