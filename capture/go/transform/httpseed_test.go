package transform

import (
	"go/ast"
	"go/parser"
	"go/token"
	"strings"
	"testing"
)

// parseFunc parses a one-function file and returns the file plus that func.
func parseFunc(t *testing.T, src string) (*ast.File, *ast.FuncDecl) {
	t.Helper()
	f, err := parser.ParseFile(token.NewFileSet(), "x.go", src, 0)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	for _, d := range f.Decls {
		if fd, ok := d.(*ast.FuncDecl); ok {
			return f, fd
		}
	}
	t.Fatal("no func in source")
	return nil, nil
}

// The seed injects `r.Header.Get(...)`, so a false positive is a COMPILE
// ERROR in the user's build — the one failure a tracer must never cause.
// Detection therefore resolves the real net/http import instead of matching
// the literal text "http.ResponseWriter".
func TestHTTPRequestParamDetection(t *testing.T) {
	cases := []struct {
		name string
		src  string
		want string
	}{
		{"plain handler", `package p
import "net/http"
func H(w http.ResponseWriter, r *http.Request) {}`, "r"},

		{"aliased net/http import", `package p
import nh "net/http"
func H(w nh.ResponseWriter, r *nh.Request) {}`, "r"},

		{"grouped params share one field", `package p
import "net/http"
func H(w http.ResponseWriter, r *http.Request) {}`, "r"},

		// A local package that merely happens to be named http. Injecting
		// r.Header.Get here would not compile.
		{"foreign package named http", `package p
import "example.com/http"
func H(w http.ResponseWriter, r *http.Request) {}`, ""},

		{"net/http not imported at all", `package p
func H(w ResponseWriter, r *Request) {}`, ""},

		{"blank import gives no qualifier", `package p
import _ "net/http"
func H(w http.ResponseWriter, r *http.Request) {}`, ""},

		{"dot import gives no qualifier", `package p
import . "net/http"
func H(w ResponseWriter, r *Request) {}`, ""},

		{"request param is _", `package p
import "net/http"
func H(w http.ResponseWriter, _ *http.Request) {}`, ""},

		{"has a result, so not a handler", `package p
import "net/http"
func H(w http.ResponseWriter, r *http.Request) error { return nil }`, ""},

		{"method, not a bare handler func", `package p
import "net/http"
type S struct{}
func (s S) H(w http.ResponseWriter, r *http.Request) {}`, ""},

		{"request not a pointer", `package p
import "net/http"
func H(w http.ResponseWriter, r http.Request) {}`, ""},

		{"wrong arity", `package p
import "net/http"
func H(w http.ResponseWriter, r *http.Request, extra int) {}`, ""},

		{"reversed order", `package p
import "net/http"
func H(r *http.Request, w http.ResponseWriter) {}`, ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			file, fd := parseFunc(t, tc.src)
			// The method case parses the type decl first; find the method.
			if tc.name == "method, not a bare handler func" {
				for _, d := range file.Decls {
					if f, ok := d.(*ast.FuncDecl); ok && f.Recv != nil {
						fd = f
					}
				}
			}
			got := httpRequestParam(fd, netHTTPLocalName(file))
			if got != tc.want {
				t.Errorf("httpRequestParam = %q, want %q", got, tc.want)
			}
		})
	}
}

// The seed must be emitted BEFORE Enter — Enter reads the context the seed
// installs, so the order is load-bearing, not cosmetic.
func TestSeedIsInjectedBeforeEnter(t *testing.T) {
	src := `package p
import "net/http"
func H(w http.ResponseWriter, r *http.Request) {}`
	res, err := File("h.go", []byte(src), "m", "m/p")
	if err != nil {
		t.Fatal(err)
	}
	out := string(res.Source)
	seed := strings.Index(out, "SeedFromTraceparent")
	enter := strings.Index(out, ".Enter(")
	if seed < 0 {
		t.Fatal("handler was not seeded")
	}
	if seed > enter {
		t.Errorf("seed at %d comes after Enter at %d — the span would miss the adopted context", seed, enter)
	}
	if !strings.Contains(out, `r.Header.Get("traceparent")`) {
		t.Errorf("seed does not read the traceparent header:\n%s", out)
	}
}

// Line numbers are the reason this package byte-splices instead of printing
// the AST. Seeding must not cost a line.
func TestSeedPreservesLineCount(t *testing.T) {
	src := `package p

import "net/http"

func H(w http.ResponseWriter, r *http.Request) {
	_ = r
}
`
	res, err := File("h.go", []byte(src), "m", "m/p")
	if err != nil {
		t.Fatal(err)
	}
	before := strings.Count(src, "\n")
	after := strings.Count(string(res.Source), "\n")
	if before != after {
		t.Errorf("line count changed %d -> %d; stack traces would lie", before, after)
	}
}

// A traced handler must never write the request's headers into the trace.
// The file is meant to be read by an AI tool and pasted into a conversation,
// which makes it the last place an Authorization or Cookie value should be.
func TestHandlerArgsDoNotSerializeTheRequest(t *testing.T) {
	src := `package p
import "net/http"
func H(w http.ResponseWriter, r *http.Request) {}`
	res, err := File("h.go", []byte(src), "m", "m/p")
	if err != nil {
		t.Fatal(err)
	}
	out := string(res.Source)

	// The whole point: neither parameter is passed to Enter as a value.
	if strings.Contains(out, `"r", r`) {
		t.Error("the *http.Request is serialized into args — every header lands in the trace file")
	}
	if strings.Contains(out, `"w", w`) {
		t.Error("the ResponseWriter is serialized into args")
	}

	// What replaces them identifies the request without carrying credentials.
	for _, want := range []string{`"http.method", r.Method`, `"http.path", r.URL.Path`} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %s — a handler span would be unidentifiable:\n%s", want, out)
		}
	}
	// RequestURI and URL.String() carry the query string, where tokens live.
	for _, forbidden := range []string{"RequestURI", "URL.String()", "r.Header)", `"r", `} {
		if strings.Contains(out, forbidden) {
			t.Errorf("handler args reference %q, which can carry secrets", forbidden)
		}
	}
}

// Only the handler shape is affected — ordinary functions keep their args.
func TestNonHandlerArgsAreUnchanged(t *testing.T) {
	src := `package p
import "net/http"
func NotAHandler(w http.ResponseWriter, r *http.Request) error { return nil }
func Ordinary(a int, b string) {}`
	res, err := File("h.go", []byte(src), "m", "m/p")
	if err != nil {
		t.Fatal(err)
	}
	out := string(res.Source)
	if !strings.Contains(out, `"a", a, "b", b`) {
		t.Error("an ordinary function lost its args")
	}
	if !strings.Contains(out, `"w", w, "r", r`) {
		t.Error("a non-handler with the same parameter types must keep normal arg capture")
	}
}
