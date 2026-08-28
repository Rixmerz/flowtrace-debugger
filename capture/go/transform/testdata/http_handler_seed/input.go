package fixture

import "net/http"

// The net/http handler shape: seeded from the inbound traceparent so this
// process continues the caller's trace instead of minting a new one.
func Handle(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
}

// Same shape but the request is unnamed — nothing to read the header off, so
// it is instrumented like any other function and not seeded.
func Unnamed(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
}

// A near-miss that must NOT be seeded: right types, but it returns a value,
// so it is not a handler.
func NotAHandler(w http.ResponseWriter, r *http.Request) error {
	return nil
}
