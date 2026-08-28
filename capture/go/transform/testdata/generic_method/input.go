package fixture

type Repo[T any] struct {
	items []T
}

func (r *Repo[T]) Get(i int) (T, error) {
	return r.items[i], nil
}
