package fixture

func SumAll(nums ...int) int {
	total := 0
	for _, n := range nums {
		total += n
	}
	return total
}
