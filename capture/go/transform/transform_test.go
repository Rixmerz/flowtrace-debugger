package transform

import (
	"bytes"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

const testModule = "flowtracetest"
const testPkg = "flowtracetest/fixture"

// caseNames that carry an input.go/want.go pair and are expected to compile
// as a standalone package once wired against the stub _ftrt runtime below.
// no_body_skip is deliberately excluded: its only declaration has no body,
// so even the untouched original needs an external (assembly) definition
// to link - that is inherent to the fixture, not something the transform
// introduced.
var goldenCompileCases = []string{
	"pointer_receiver", "package_func", "named_results", "unnamed_results",
	"blank_result", "no_results", "variadic", "generic_func",
	"generic_method", "unnamed_receiver", "name_collision",
	"single_line_body", "line_preservation",
}

func TestGoldenFiles(t *testing.T) {
	entries, err := os.ReadDir("testdata")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		dir := filepath.Join("testdata", name)
		wantPath := filepath.Join(dir, "want.go")
		if _, err := os.Stat(wantPath); err != nil {
			continue // handled by the skip-behavior tests below
		}
		t.Run(name, func(t *testing.T) {
			inPath := filepath.Join(dir, "input.go")
			src, err := os.ReadFile(inPath)
			if err != nil {
				t.Fatal(err)
			}
			want, err := os.ReadFile(wantPath)
			if err != nil {
				t.Fatal(err)
			}
			res, err := File(inPath, src, testModule, testPkg)
			if err != nil {
				t.Fatalf("File() error: %v", err)
			}
			if res.Skipped {
				t.Fatalf("unexpected skip: %s", res.Reason)
			}
			if !bytes.Equal(res.Source, want) {
				t.Errorf("output mismatch\n--- got ---\n%s\n--- want ---\n%s", res.Source, want)
			}
			assertLinesPreserved(t, src, res.Source)
		})
	}
}

// assertLinesPreserved is the explicit test D2 calls for: byte-splicing must
// never change the file's line count, and every top-level declaration must
// still start on the same line it started on before the transform. This is
// what makes stack traces in the traced program keep pointing at the right
// line.
func assertLinesPreserved(t *testing.T, orig, transformed []byte) {
	t.Helper()

	origLines := bytes.Count(orig, []byte("\n"))
	gotLines := bytes.Count(transformed, []byte("\n"))
	if origLines != gotLines {
		t.Errorf("line count changed: original has %d newlines, transformed has %d", origLines, gotLines)
	}

	// Compare by function identity, not by decl index: the transform adds
	// one new top-level declaration when the file had no import block
	// (the injected `import _ftrt "..."`), so raw decl counts legitimately
	// differ. What must not move is where every *function* starts.
	origDecls := funcDeclLines(t, "orig.go", orig)
	newDecls := funcDeclLines(t, "transformed.go", transformed)
	if len(origDecls) != len(newDecls) {
		t.Fatalf("function count changed: original %d, transformed %d", len(origDecls), len(newDecls))
	}
	for key, origLine := range origDecls {
		newLine, ok := newDecls[key]
		if !ok {
			t.Errorf("function %q missing after transform", key)
			continue
		}
		if origLine != newLine {
			t.Errorf("function %q moved from line %d to line %d", key, origLine, newLine)
		}
	}
}

// funcDeclLines maps every function/method to the source line its `func`
// keyword starts on. Methods are keyed by "Receiver.Method" so a method and
// a same-named package function can't collide.
func funcDeclLines(t *testing.T, filename string, src []byte) map[string]int {
	t.Helper()
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, filename, src, 0)
	if err != nil {
		t.Fatalf("parsing %s: %v", filename, err)
	}
	lines := make(map[string]int)
	for _, decl := range f.Decls {
		fd, ok := decl.(*ast.FuncDecl)
		if !ok {
			continue
		}
		key := fd.Name.Name
		if fd.Recv != nil && len(fd.Recv.List) > 0 {
			key = typeName(fd.Recv.List[0].Type) + "." + key
		}
		lines[key] = fset.Position(fd.Pos()).Line
	}
	return lines
}

func TestSkipCgoFile(t *testing.T) {
	src, err := os.ReadFile("testdata/cgo_skip/input.go")
	if err != nil {
		t.Fatal(err)
	}
	res, err := File("testdata/cgo_skip/input.go", src, testModule, testPkg)
	if err != nil {
		t.Fatalf("File() error: %v", err)
	}
	if !res.Skipped {
		t.Fatal("expected cgo file to be skipped")
	}
	if !strings.Contains(res.Reason, "cgo") {
		t.Errorf("reason %q does not mention cgo", res.Reason)
	}
	if !bytes.Equal(res.Source, src) {
		t.Error("cgo file source was modified; the preamble comment must stay attached to the import untouched")
	}
}

func TestSkipTestFile(t *testing.T) {
	src, err := os.ReadFile("testdata/test_skip/input_test.go")
	if err != nil {
		t.Fatal(err)
	}
	res, err := File("testdata/test_skip/input_test.go", src, testModule, testPkg)
	if err != nil {
		t.Fatalf("File() error: %v", err)
	}
	if !res.Skipped {
		t.Fatal("expected _test.go file to be skipped")
	}
	if !strings.Contains(res.Reason, "test") {
		t.Errorf("reason %q does not mention test file", res.Reason)
	}
	if !bytes.Equal(res.Source, src) {
		t.Error("_test.go source was modified")
	}
}

func TestSkipUnparseableFile(t *testing.T) {
	src, err := os.ReadFile("testdata/unparseable_skip/input.go")
	if err != nil {
		t.Fatal(err)
	}
	res, err := File("testdata/unparseable_skip/input.go", src, testModule, testPkg)
	if err != nil {
		t.Fatalf("File() should not itself error on unparseable input, got: %v", err)
	}
	if !res.Skipped {
		t.Fatal("expected unparseable file to be skipped")
	}
	if !strings.Contains(res.Reason, "parse error") {
		t.Errorf("reason %q does not mention parse error", res.Reason)
	}
	if !bytes.Equal(res.Source, src) {
		t.Error("unparseable file source was modified; the original must be left alone")
	}
}

func TestBodilessDeclLeftUntouched(t *testing.T) {
	src, err := os.ReadFile("testdata/no_body_skip/input.go")
	if err != nil {
		t.Fatal(err)
	}
	res, err := File("testdata/no_body_skip/input.go", src, testModule, testPkg)
	if err != nil {
		t.Fatalf("File() error: %v", err)
	}
	if res.Skipped {
		t.Fatalf("a file with only a bodiless decl is not a whole-file skip, got reason %q", res.Reason)
	}
	if !bytes.Equal(res.Source, src) {
		t.Error("bodiless declaration was mutated; assembly-implemented functions must be left alone")
	}
}

func TestNameCollisionsAvoided(t *testing.T) {
	src, err := os.ReadFile("testdata/name_collision/input.go")
	if err != nil {
		t.Fatal(err)
	}
	res, err := File("testdata/name_collision/input.go", src, testModule, testPkg)
	if err != nil {
		t.Fatalf("File() error: %v", err)
	}
	out := string(res.Source)

	// The user's own _ft_s parameter must survive untouched...
	if !strings.Contains(out, "func Weird(_ft_s int)") {
		t.Errorf("user parameter _ft_s was renamed:\n%s", out)
	}
	// ...and the injected span variable must have moved out of its way.
	if strings.Contains(out, "_ft_s :=") {
		t.Errorf("generated span var still collides with the user's _ft_s parameter:\n%s", out)
	}
	// The user's own _ft_r0 local must survive untouched...
	if !strings.Contains(out, "_ft_r0 := _ft_s * 2") {
		t.Errorf("user local _ft_r0 was renamed:\n%s", out)
	}
	// ...and the generated result name for the same base must have moved.
	if strings.Contains(out, "_ft_r0 int, ") {
		t.Errorf("generated result name still collides with the user's _ft_r0 local:\n%s", out)
	}
}

// TestGoldenCompiles wires every non-skip golden output into a throwaway
// module, alongside a stub of the three-function runtime contract, and runs
// `go build` for real. A golden file that looks right but does not compile
// is worse than no test at all.
func TestGoldenCompiles(t *testing.T) {
	goBin, err := exec.LookPath("go")
	if err != nil {
		t.Skip("go toolchain not on PATH")
	}

	tmp := t.TempDir()
	mustWrite(t, filepath.Join(tmp, "go.mod"), "module "+testModule+"\n\ngo 1.21\n")
	mustWrite(t, filepath.Join(tmp, "internal", "flowtracert", "flowtracert.go"), stubRuntimeSrc)

	for _, name := range goldenCompileCases {
		wantPath := filepath.Join("testdata", name, "want.go")
		src, err := os.ReadFile(wantPath)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		mustWrite(t, filepath.Join(tmp, "cases", name, name+".go"), string(src))
	}

	cmd := exec.Command(goBin, "build", "./...")
	cmd.Dir = tmp
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("go build failed:\n%s", out)
	}
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// stubRuntimeSrc implements the three-function contract
// (Enter/Exit/ExitPanic) that capture/go/flowtracert provides in the real
// build, just enough to let instrumented golden output compile in
// isolation.
const stubRuntimeSrc = `package flowtracert

type Span struct{}

func Enter(module, class, method, visibility string, argPairs ...any) *Span {
	return &Span{}
}

func Exit(s *Span, results ...any) {}

func ExitPanic(s *Span, p any) {}
`
