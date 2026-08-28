package fixture

type Calc struct {
	total int
}

func (c *Calc) Add(n int) int {
	c.total += n
	return c.total
}
