package fixture

import (_ftrt "flowtracetest/internal/flowtracert"; "net/http")

// The net/http handler shape: seeded from the inbound traceparent so this
// process continues the caller's trace instead of minting a new one.
func Handle(w http.ResponseWriter, r *http.Request) {defer _ftrt.SeedFromTraceparent(r.Header.Get("traceparent"))(); _ft_s := _ftrt.Enter("flowtracetest/fixture", "", "Handle", "public", "http.method", r.Method, "http.path", r.URL.Path); defer func() { if _ft_p := recover(); _ft_p != nil { _ftrt.ExitPanic(_ft_s, _ft_p); panic(_ft_p) }; _ftrt.Exit(_ft_s) }();
	w.WriteHeader(http.StatusOK)
}

// Same shape but the request is unnamed — nothing to read the header off, so
// it is instrumented like any other function and not seeded.
func Unnamed(w http.ResponseWriter, _ *http.Request) {_ft_s := _ftrt.Enter("flowtracetest/fixture", "", "Unnamed", "public", "w", w); defer func() { if _ft_p := recover(); _ft_p != nil { _ftrt.ExitPanic(_ft_s, _ft_p); panic(_ft_p) }; _ftrt.Exit(_ft_s) }();
	w.WriteHeader(http.StatusOK)
}

// A near-miss that must NOT be seeded: right types, but it returns a value,
// so it is not a handler.
func NotAHandler(w http.ResponseWriter, r *http.Request) (_ft_r0 error) {_ft_s := _ftrt.Enter("flowtracetest/fixture", "", "NotAHandler", "public", "w", w, "r", r); defer func() { if _ft_p := recover(); _ft_p != nil { _ftrt.ExitPanic(_ft_s, _ft_p); panic(_ft_p) }; _ftrt.Exit(_ft_s, "r0", _ft_r0) }();
	return nil
}
