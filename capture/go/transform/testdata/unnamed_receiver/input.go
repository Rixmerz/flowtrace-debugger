package fixture

type Calc2 struct {
	n int
}

func (*Calc2) Ping() string {
	return "pong"
}
