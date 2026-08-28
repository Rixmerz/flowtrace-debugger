package fixture

import (
	"errors"
	"fmt"
)

func Parse(s string) (int, error) {
	if s == "" {
		return 0, errors.New("empty input")
	}
	fmt.Sprint(s)
	return len(s), nil
}
