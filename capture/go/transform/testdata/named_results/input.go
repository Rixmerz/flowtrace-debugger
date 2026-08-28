package fixture

import "errors"

func Divide(a, b int) (quotient int, err error) {
	if b == 0 {
		err = errors.New("divide by zero")
		return
	}
	quotient = a / b
	return
}
