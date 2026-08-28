package fixture

func Do[T any](v T) (T, error) {
	return v, nil
}
