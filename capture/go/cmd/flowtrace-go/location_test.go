package main

import (
	"bufio"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolveSourceRoot(t *testing.T) {
	moduleDir := t.TempDir()
	sub := filepath.Join(moduleDir, "sub")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	notDir := filepath.Join(moduleDir, "go.mod")
	mustWriteFile(t, notDir, "module x\n")

	t.Run("unset falls back to the module root", func(t *testing.T) {
		got, err := resolveSourceRoot("", sub, moduleDir)
		if err != nil || got != moduleDir {
			t.Fatalf("got (%q, %v), want %q", got, err, moduleDir)
		}
	})
	t.Run("absolute override wins", func(t *testing.T) {
		parent := filepath.Dir(moduleDir)
		got, err := resolveSourceRoot(parent, sub, moduleDir)
		if err != nil || got != parent {
			t.Fatalf("got (%q, %v), want %q", got, err, parent)
		}
	})
	t.Run("relative override is relative to the target directory", func(t *testing.T) {
		got, err := resolveSourceRoot("..", sub, moduleDir)
		if err != nil || got != moduleDir {
			t.Fatalf("got (%q, %v), want %q", got, err, moduleDir)
		}
	})
	t.Run("a root that is missing or not a directory is an error", func(t *testing.T) {
		if _, err := resolveSourceRoot(filepath.Join(moduleDir, "nope"), sub, moduleDir); err == nil {
			t.Error("missing root accepted")
		}
		if _, err := resolveSourceRoot(notDir, sub, moduleDir); err == nil {
			t.Error("file accepted as a root")
		}
	})
}

// The staged copy must name the ORIGINAL file relative to the source root,
// never its own path under the work dir.
func TestInstrumentPackagesInjectsFileRelativeToSourceRoot(t *testing.T) {
	repo := t.TempDir()
	moduleDir := filepath.Join(repo, "services", "api")
	pkgDir := filepath.Join(moduleDir, "internal", "store")
	if err := os.MkdirAll(pkgDir, 0o755); err != nil {
		t.Fatal(err)
	}
	mustWriteFile(t, filepath.Join(pkgDir, "store.go"), "package store\n\n// Get is documented.\nfunc Get(k string) string {\n\treturn k\n}\n")
	pkgs := []goPackage{{
		Dir:        pkgDir,
		ImportPath: "example.com/api/internal/store",
		GoFiles:    []string{"store.go"},
		Module:     &goModule{Path: "example.com/api", Dir: moduleDir, Main: true},
	}}

	cases := []struct {
		name, root, want string
	}{
		{"module root", moduleDir, `EnterAt("internal/store/store.go", 4, `},
		{"FLOWTRACE_ROOT above the module", repo, `EnterAt("services/api/internal/store/store.go", 4, `},
		{"file outside the root is absolute", t.TempDir(), `EnterAt("` + filepath.ToSlash(filepath.Join(pkgDir, "store.go")) + `", 4, `},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			workDir := t.TempDir()
			overlay := map[string]string{}
			if _, err := instrumentPackages(pkgs, moduleDir, "example.com/api", tc.root, workDir, overlay); err != nil {
				t.Fatal(err)
			}
			staged, err := os.ReadFile(overlay[filepath.Join(pkgDir, "store.go")])
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(staged), tc.want) {
				t.Errorf("want %s in:\n%s", tc.want, staged)
			}
			if strings.Contains(string(staged), filepath.ToSlash(workDir)) {
				t.Errorf("the overlay path leaked into the source:\n%s", staged)
			}
		})
	}
}

// End to end through the real driver and the real runtime: a module with a
// sub-package, built and run, must report file/line on enter events only.
func TestDriverEmitsFileAndLineOnEnterOnly(t *testing.T) {
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("go toolchain not on PATH")
	}
	runtimeSrc, err := filepath.Abs(filepath.Join("..", "..", "flowtracert"))
	if err != nil {
		t.Fatal(err)
	}

	repo := t.TempDir()
	moduleDir := filepath.Join(repo, "app")
	if err := os.MkdirAll(filepath.Join(moduleDir, "internal", "calc"), 0o755); err != nil {
		t.Fatal(err)
	}
	mustWriteFile(t, filepath.Join(moduleDir, "go.mod"), "module example.com/app\n\ngo 1.24\n")
	mustWriteFile(t, filepath.Join(moduleDir, "main.go"), `package main

import "example.com/app/internal/calc"

func main() {
	c := &calc.Calc{}
	c.Add(2)
	calc.Double(3)
}
`)
	mustWriteFile(t, filepath.Join(moduleDir, "internal", "calc", "calc.go"), `package calc

type Calc struct{ total int }

// Add is preceded by a doc comment
// and a compiler directive.
//
//go:noinline
func (c *Calc) Add(n int) int {
	c.total += n
	return c.total
}

func Double(n int) int {
	return n * 2
}
`)

	type want struct {
		file string
		line float64
	}
	run1 := func(t *testing.T, root string) map[string]want {
		t.Helper()
		out := filepath.Join(t.TempDir(), "trace.jsonl")
		t.Setenv("FLOWTRACE_OUTPUT", out)
		t.Setenv("FLOWTRACE_PACKAGE_PREFIX", "")
		t.Setenv("FLOWTRACE_ROOT", root)
		if code := run([]string{"-runtime-src", runtimeSrc, "-dir", moduleDir, "run", "."}); code != 0 {
			t.Fatalf("driver exited %d", code)
		}
		f, err := os.Open(out)
		if err != nil {
			t.Fatal(err)
		}
		defer f.Close()
		got := map[string]want{}
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			var ev map[string]any
			if err := json.Unmarshal(sc.Bytes(), &ev); err != nil {
				t.Fatalf("bad line %q: %v", sc.Text(), err)
			}
			_, hasFile := ev["file"]
			_, hasLine := ev["line"]
			switch ev["event"] {
			case "exit":
				if hasFile || hasLine {
					t.Errorf("exit event carries file/line: %s", sc.Text())
				}
			case "enter":
				if !hasFile || !hasLine {
					t.Errorf("enter event lacks file/line: %s", sc.Text())
					continue
				}
				got[ev["method"].(string)] = want{ev["file"].(string), ev["line"].(float64)}
			}
		}
		return got
	}

	t.Run("module root by default", func(t *testing.T) {
		got := run1(t, "")
		exp := map[string]want{
			"main":   {"main.go", 5},
			"Add":    {"internal/calc/calc.go", 9},
			"Double": {"internal/calc/calc.go", 14},
		}
		for m, w := range exp {
			if got[m] != w {
				t.Errorf("%s: got %+v, want %+v", m, got[m], w)
			}
		}
	})
	t.Run("FLOWTRACE_ROOT overrides it", func(t *testing.T) {
		got := run1(t, repo)
		if w := (want{"app/internal/calc/calc.go", 9}); got["Add"] != w {
			t.Errorf("Add: got %+v, want %+v", got["Add"], w)
		}
		if w := (want{"app/main.go", 5}); got["main"] != w {
			t.Errorf("main: got %+v, want %+v", got["main"], w)
		}
	})
}
