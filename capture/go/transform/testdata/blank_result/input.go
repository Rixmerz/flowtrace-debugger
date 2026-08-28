package fixture

func Lookup(m map[string]int, k string) (v int, _ error) {
	v = m[k]
	return
}
