package transform

import (
	"go/parser"
	"go/token"
	"path/filepath"
	"strings"
	"testing"
)

const locationSrc = `package fixture

type Calc struct{ total int }

// Add has a doc comment,
// spanning two lines, and a directive.
//
//go:noinline
func (c *Calc) Add(n int) int {
	c.total += n
	return c.total
}

func Free() {}

/* block comment */ func Shared(
	a int,
) int {
	return a
}

func Generic[T any](v T) T {
	return v
}
`

func TestFileAtInjectsOriginalFileAndDeclarationLine(t *testing.T) {
	res, err := FileAt("/abs/work/fixture.go", "internal/fixture/fixture.go", []byte(locationSrc), "m", "m/internal/fixture")
	if err != nil || res.Skipped {
		t.Fatalf("FileAt: err=%v skipped=%v (%s)", err, res.Skipped, res.Reason)
	}
	out := string(res.Source)

	for _, want := range []string{
		// method with a receiver, behind a doc comment and a //go: directive:
		// the line is the func keyword's, not the comment's.
		`_ftrt.EnterAt("internal/fixture/fixture.go", 9, "m/internal/fixture", "Calc", "Add", "public", "n", n)`,
		// free function
		`_ftrt.EnterAt("internal/fixture/fixture.go", 14, "m/internal/fixture", "", "Free", "public")`,
		// signature spread over several lines: still the func keyword's line
		`_ftrt.EnterAt("internal/fixture/fixture.go", 16, "m/internal/fixture", "", "Shared", "public", "a", a)`,
		`_ftrt.EnterAt("internal/fixture/fixture.go", 22, "m/internal/fixture", "", "Generic", "public", "v", v)`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %s in:\n%s", want, out)
		}
	}
	if strings.Contains(out, "/abs/work") {
		t.Errorf("the path the file was read from leaked into the output:\n%s", out)
	}
	if strings.Contains(out, "_ftrt.Enter(") {
		t.Errorf("a function was left without a location:\n%s", out)
	}
	if _, err := parser.ParseFile(token.NewFileSet(), "out.go", res.Source, 0); err != nil {
		t.Fatalf("output does not parse: %v\n%s", err, out)
	}
	assertLinesPreserved(t, []byte(locationSrc), res.Source)
}

// No source file known: neither value is injected, and the call is the plain
// Enter the golden files pin.
func TestFileWithoutSourceFileInjectsNoLocation(t *testing.T) {
	res, err := File("fixture.go", []byte(locationSrc), "m", "m/p")
	if err != nil {
		t.Fatal(err)
	}
	if out := string(res.Source); strings.Contains(out, "EnterAt") || !strings.Contains(out, `_ftrt.Enter("m/p", "Calc", "Add"`) {
		t.Errorf("unexpected output:\n%s", out)
	}
}

func TestSourceFile(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	in := filepath.Join(root, "internal", "store", "store.go")

	if got := SourceFile(root, in); got != "internal/store/store.go" {
		t.Errorf("inside root: got %q", got)
	}
	if got := SourceFile(root, filepath.Join(root, "main.go")); got != "main.go" {
		t.Errorf("at root: got %q", got)
	}
	out := filepath.Join(outside, "x.go")
	if got := SourceFile(root, out); got != filepath.ToSlash(out) {
		t.Errorf("outside root: got %q, want the absolute path %q", got, filepath.ToSlash(out))
	}
	// A sibling whose name merely starts with the root's is outside it.
	sibling := root + "-other"
	if got := SourceFile(root, filepath.Join(sibling, "x.go")); strings.HasPrefix(got, "..") || !filepath.IsAbs(filepath.FromSlash(got)) {
		t.Errorf("sibling directory: got %q, want an absolute path", got)
	}
}
