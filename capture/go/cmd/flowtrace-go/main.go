// Command flowtrace-go is the driver the Node CLI shells out to for
// `flowtrace run --lang go`. See docs/changes/2026-08-27-go-capture-layer.md,
// AC1.
//
// It orchestrates the whole capture pipeline without ever writing into the
// user's module tree (D1): enumerate the module's own packages with
// `go list -json ./...`, byte-splice every matching file through
// transform.File into a scratch work dir, synthesize the injected runtime
// package there too, write a `-overlay` manifest mapping original paths to
// the rewritten ones, and exec the user's own `go run`/`go build`/`go test`
// with that overlay spliced in. Nothing on disk in the user's tree is ever
// touched.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/Rixmerz/flowtrace-debugger/capture/go/transform"
)

// validSubcommands is deliberately narrow: -overlay is a build flag, and
// these are the only `go` subcommands that build the user's own code from
// source. A prebuilt binary (`flowtrace run --lang go -- ./myapp`) has
// nothing left to instrument by the time it reaches here — that is caught
// one layer up, in flowtrace-cli's runGo, before this process is even
// spawned; validSubcommands is the second line of defense if it is invoked
// directly.
var validSubcommands = map[string]bool{"run": true, "build": true, "test": true}

func main() {
	os.Exit(run(os.Args[1:]))
}

// run does the work and returns the process exit code: the traced program's
// own exit code on success, or 1/2 for a flowtrace-go failure (never a
// silently empty trace — see AC1's "reportalo claro" requirement).
func run(argv []string) int {
	fs := flag.NewFlagSet("flowtrace-go", flag.ContinueOnError)
	runtimeSrc := fs.String("runtime-src", "",
		"path to capture/go/flowtracert — the runtime package source copied into the target module")
	dir := fs.String("dir", ".",
		"the target module's directory — where `go list`/`go run`/`go build`/`go test` actually run. "+
			"Not always the same as this process's own cwd: flowtrace-go is invoked via `go run`, "+
			"which resolves the *main module* from ITS OWN cwd, so a caller that needs `go run` to build "+
			"flowtrace-go's own module (capture/go) has to run it from there and pass the target module's "+
			"directory through this flag instead of relying on inherited cwd.")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "usage: flowtrace-go -runtime-src <path> -dir <target module dir> <run|build|test> [go args...]")
		fs.PrintDefaults()
	}
	if err := fs.Parse(argv); err != nil {
		if err == flag.ErrHelp {
			return 0
		}
		return 2
	}

	goArgs := fs.Args()
	if *runtimeSrc == "" {
		fmt.Fprintln(os.Stderr, "[flowtrace-go] -runtime-src is required")
		return 2
	}
	if len(goArgs) == 0 {
		fmt.Fprintln(os.Stderr, "[flowtrace-go] no command given — expected `run`, `build` or `test` followed by the usual go args")
		return 2
	}
	if !validSubcommands[goArgs[0]] {
		fmt.Fprintf(os.Stderr,
			"[flowtrace-go] unsupported command %q — flowtrace instruments `go run`, `go build` or `go test` only.\n"+
				"Apunta a uno de esos, no a un binario ya compilado. Ejemplo: flowtrace run --lang go -- go run ./cmd/api\n",
			goArgs[0])
		return 2
	}
	subcommand, rest := goArgs[0], goArgs[1:]

	userOverlay, rest, err := extractUserOverlay(rest)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[flowtrace-go] %v\n", err)
		return 2
	}

	cwd, err := filepath.Abs(*dir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[flowtrace-go] resolving -dir %s: %v\n", *dir, err)
		return 1
	}

	// A relative -overlay path is the user's, meant relative to the target
	// module directory (cwd) the same way it would be if they ran `go`
	// themselves there — NOT relative to this process's own OS working
	// directory, which the wiring in flowtrace-cli's runGo deliberately
	// keeps different (see -dir's own doc comment above): flowtrace-go runs
	// from capture/go's own directory via `go run`, while cwd is wherever
	// the user actually invoked `flowtrace run` from.
	if userOverlay != "" && !filepath.IsAbs(userOverlay) {
		userOverlay = filepath.Join(cwd, userOverlay)
	}

	if err := checkGoToolchainVersion(cwd); err != nil {
		fmt.Fprintf(os.Stderr, "[flowtrace-go] %v\n", err)
		return 1
	}

	pkgs, err := listPackages(cwd)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[flowtrace-go] %v\n", err)
		return 1
	}

	if bad := packagesWithErrors(pkgs); len(bad) > 0 {
		fmt.Fprintln(os.Stderr, "[flowtrace-go] the module has packages that fail to load — fix these first, a tracer must never guess past a broken build:")
		for _, b := range bad {
			fmt.Fprintf(os.Stderr, "  %s: %s\n", b.ImportPath, b.Error.Err)
		}
		return 1
	}

	moduleDir, modulePath := pkgs[0].Module.Dir, pkgs[0].Module.Path
	if moduleDir == "" || modulePath == "" {
		fmt.Fprintln(os.Stderr, "[flowtrace-go] could not determine the module root/path from `go list` — is there a go.mod above this directory?")
		return 1
	}

	if err := checkModuleGoDirective(pkgs[0].Module.GoVersion); err != nil {
		fmt.Fprintf(os.Stderr, "[flowtrace-go] %v\n", err)
		return 1
	}

	if err := checkNoCollision(moduleDir); err != nil {
		fmt.Fprintf(os.Stderr, "[flowtrace-go] %v\n", err)
		return 1
	}

	workDir, err := os.MkdirTemp("", "flowtrace-go-")
	if err != nil {
		fmt.Fprintf(os.Stderr, "[flowtrace-go] creating work dir: %v\n", err)
		return 1
	}
	defer os.RemoveAll(workDir)

	overlay := map[string]string{}

	instrumented, err := instrumentPackages(pkgs, moduleDir, modulePath, workDir, overlay)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[flowtrace-go] %v\n", err)
		return 1
	}
	if instrumented == 0 {
		fmt.Fprintln(os.Stderr, "[flowtrace-go] WARNING: no functions were instrumented (no non-test, non-cgo .go file under the module had a function body) — the trace will be empty.")
	}

	if err := synthesizeRuntime(*runtimeSrc, moduleDir, workDir, overlay); err != nil {
		fmt.Fprintf(os.Stderr, "[flowtrace-go] %v\n", err)
		return 1
	}

	if userOverlay != "" {
		if err := mergeUserOverlay(userOverlay, overlay); err != nil {
			fmt.Fprintf(os.Stderr, "[flowtrace-go] %v\n", err)
			return 1
		}
	}

	overlayPath, err := writeOverlay(workDir, overlay)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[flowtrace-go] writing overlay manifest: %v\n", err)
		return 1
	}

	return execInstrumented(cwd, overlayPath, subcommand, rest)
}

// ---------------------------------------------------------------------------
// go list -json ./...
// ---------------------------------------------------------------------------

type goModule struct {
	Path      string
	Dir       string
	Main      bool
	GoVersion string
}

type goListError struct {
	Err string
}

type goPackage struct {
	Dir          string
	ImportPath   string
	Name         string
	GoFiles      []string
	CgoFiles     []string
	TestGoFiles  []string
	XTestGoFiles []string
	Module       *goModule
	Error        *goListError
}

// listPackages enumerates every package in the module rooted at dir via
// `go list -json ./...`. A non-zero exit (module doesn't currently build) or
// an empty result is reported as an error rather than treated as "nothing to
// instrument" — an empty trace that looks like a bug in the traced program
// is the failure mode this whole driver exists to avoid.
func listPackages(dir string) ([]goPackage, error) {
	cmd := exec.Command("go", "list", "-json", "./...")
	cmd.Dir = dir
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf(
			"`go list -json ./...` failed in %s — the module doesn't currently build, so flowtrace can't see what to instrument:\n%s",
			dir, strings.TrimSpace(stderr.String()))
	}

	var pkgs []goPackage
	dec := json.NewDecoder(&stdout)
	for dec.More() {
		var p goPackage
		if err := dec.Decode(&p); err != nil {
			return nil, fmt.Errorf("decoding `go list -json` output: %w", err)
		}
		pkgs = append(pkgs, p)
	}
	if len(pkgs) == 0 {
		return nil, fmt.Errorf("`go list -json ./...` returned no packages in %s — is this a Go module (go.mod present)?", dir)
	}
	return pkgs, nil
}

// packagesWithErrors returns every package `go list` itself flagged as
// broken (Error != nil) — this can happen even with a zero exit code.
func packagesWithErrors(pkgs []goPackage) []goPackage {
	var bad []goPackage
	for _, p := range pkgs {
		if p.Error != nil {
			bad = append(bad, p)
		}
	}
	return bad
}

// ---------------------------------------------------------------------------
// toolchain version guard
// ---------------------------------------------------------------------------

// minGoMajor/minGoMinor is the floor D3's goroutine context propagation
// requires: runtime/pprof casts a goroutine's label slot to *labelMap,
// defined as `struct{ list []label }` only from Go 1.24 — before that it is
// `map[string]string`, an entirely different memory layout, and storing our
// *Span there crashes the profiler the first time anything in the traced
// program profiles (see docs/changes/2026-08-27-go-capture-layer.md, D3).
// Below this floor there is no safe degraded mode for the label slot itself
// (it's a map header, not a struct we can lead with a compatible field), so
// this must fail loud, before any file is touched, rather than build
// something that only crashes once a user profiles a real workload.
const (
	minGoMajor = 1
	minGoMinor = 24
)

var goVersionPattern = regexp.MustCompile(`\bgo(\d+)\.(\d+)`)

// checkGoToolchainVersion fails fast if the `go` binary that will actually
// build/run the overlay — not necessarily the one that built flowtrace-go
// itself — is older than the D3 floor. It shells out to `go version` with
// the exact same cwd and environment execInstrumented uses, because
// GOTOOLCHAIN (an explicit pin, or the default auto-switch driven by the
// target module's own go.mod) can select a different toolchain than
// whatever built this binary, and that is the one whose runtime/pprof
// layout actually matters.
func checkGoToolchainVersion(cwd string) error {
	cmd := exec.Command("go", "version")
	cmd.Dir = cwd
	cmd.Env = os.Environ()
	out, err := cmd.Output()
	if err != nil {
		return fmt.Errorf("running `go version` to check the toolchain: %w", err)
	}
	major, minor, ok := parseGoVersion(string(out))
	if !ok {
		return fmt.Errorf("could not parse `go version` output: %q", strings.TrimSpace(string(out)))
	}
	if major < minGoMajor || (major == minGoMajor && minor < minGoMinor) {
		return fmt.Errorf(
			"go %d.%d is too old — flowtrace's Go capture layer needs Go >= %d.%d "+
				"(runtime/pprof's goroutine label-slot layout, which D3's context propagation relies on, "+
				"only has the required shape from Go %d.%d; see docs/changes/2026-08-27-go-capture-layer.md). "+
				"Install a newer Go, or set GOTOOLCHAIN=go%d.%d.0 (or newer) and retry",
			major, minor, minGoMajor, minGoMinor, minGoMajor, minGoMinor, minGoMajor, minGoMinor)
	}
	return nil
}

// parseGoVersion extracts the major/minor version out of `go version`'s
// stdout, e.g. "go version go1.24.0 darwin/arm64\n" -> (1, 24, true).
func parseGoVersion(s string) (major, minor int, ok bool) {
	m := goVersionPattern.FindStringSubmatch(s)
	if m == nil {
		return 0, 0, false
	}
	major, errMajor := strconv.Atoi(m[1])
	minor, errMinor := strconv.Atoi(m[2])
	if errMajor != nil || errMinor != nil {
		return 0, 0, false
	}
	return major, minor, true
}

var moduleGoVersionPattern = regexp.MustCompile(`^(\d+)\.(\d+)`)

// checkModuleGoDirective enforces the same D3 floor as
// checkGoToolchainVersion, but against a different number: the target
// module's own `go` directive in its go.mod (`go list -json`'s
// Module.GoVersion), not the toolchain binary that will run the build.
// The toolchain can be newer than the floor while the directive is not —
// `go` compiles a module under the *language version* its own go.mod
// declares regardless of how new the installed toolchain is, and the
// injected internal/flowtracert package (D1) compiles as part of that same
// module, under that same `-lang`. A target module on `go 1.16`, say, builds
// our Go-1.24-shaped runtime (which uses `any`, generics, etc.) under
// 1.16 language semantics — measured, this fails with 11 lines of
// "predeclared any requires go1.18 or later" pointing at the injected
// package's temp work dir, with nothing telling the user this came from
// flowtrace. Catching it here gives the same clear, actionable message
// checkGoToolchainVersion already gives for the toolchain-binary case.
func checkModuleGoDirective(goVersion string) error {
	if goVersion == "" {
		// Older `go list -json` output, or a go.mod with no `go` directive
		// at all — nothing to validate against; let the build itself surface
		// any real problem.
		return nil
	}
	m := moduleGoVersionPattern.FindStringSubmatch(goVersion)
	if m == nil {
		return nil
	}
	major, errMajor := strconv.Atoi(m[1])
	minor, errMinor := strconv.Atoi(m[2])
	if errMajor != nil || errMinor != nil {
		return nil
	}
	if major < minGoMajor || (major == minGoMajor && minor < minGoMinor) {
		return fmt.Errorf(
			"the target module's go.mod declares `go %s`, which is too old — flowtrace's Go capture layer needs the module's own `go` directive to be >= %d.%d, "+
				"because the injected runtime package (internal/flowtracert) compiles as part of this module, under this same language version "+
				"(runtime/pprof's goroutine label-slot layout, which D3's context propagation relies on, only has the required shape from Go %d.%d; "+
				"see docs/changes/2026-08-27-go-capture-layer.md). Raise the `go` directive in go.mod to %d.%d or newer and retry",
			goVersion, minGoMajor, minGoMinor, minGoMajor, minGoMinor, minGoMajor, minGoMinor)
	}
	return nil
}

// ---------------------------------------------------------------------------
// collision detection
// ---------------------------------------------------------------------------

// checkNoCollision fails loudly if the user's module already has a real
// internal/flowtracert package — the overlay would silently replace it
// wholesale, so this has to be caught before any work happens rather than
// discovered as a confusing build error.
func checkNoCollision(moduleDir string) error {
	target := filepath.Join(moduleDir, "internal", "flowtracert")
	info, err := os.Stat(target)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("checking %s: %w", target, err)
	}
	what := "a file"
	if info.IsDir() {
		what = "a directory"
	}
	return fmt.Errorf(
		"module already has %s at %s — flowtrace injects its own runtime there; rename or remove it and retry",
		what, target)
}

// ---------------------------------------------------------------------------
// instrumentation
// ---------------------------------------------------------------------------

// instrumentPackages transforms every candidate file in every package and
// stages the changed ones under workDir/overlay, mirroring the module's own
// directory layout so paths stay legible. Returns the count of files that
// were actually instrumented (changed), which the caller uses to warn on a
// module with nothing to trace.
func instrumentPackages(pkgs []goPackage, moduleDir, modulePath, workDir string, overlay map[string]string) (int, error) {
	instrumented := 0
	for _, pkg := range pkgs {
		if pkg.Module == nil || !pkg.Module.Main {
			// Out of the user's own module (shouldn't happen under `./...`,
			// but never instrument a dependency — every FlowTrace layer
			// scopes to the user's own code).
			continue
		}
		var files []string
		files = append(files, pkg.GoFiles...)
		files = append(files, pkg.CgoFiles...)

		for _, name := range files {
			abs := filepath.Join(pkg.Dir, name)
			src, err := os.ReadFile(abs)
			if err != nil {
				return 0, fmt.Errorf("reading %s: %w", abs, err)
			}

			res, err := transform.File(abs, src, modulePath, pkg.ImportPath)
			if err != nil {
				return 0, fmt.Errorf("instrumenting %s: %w", abs, err)
			}
			if res.Skipped {
				fmt.Fprintf(os.Stderr, "[flowtrace-go] WARNING: skipping %s: %s\n", abs, res.Reason)
				continue
			}
			if bytes.Equal(res.Source, src) {
				continue // nothing to instrument in this file
			}

			rel, err := filepath.Rel(moduleDir, abs)
			if err != nil {
				return 0, fmt.Errorf("computing relative path for %s: %w", abs, err)
			}
			dest := filepath.Join(workDir, "overlay", rel)
			if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
				return 0, fmt.Errorf("creating %s: %w", filepath.Dir(dest), err)
			}
			if err := os.WriteFile(dest, res.Source, 0o644); err != nil {
				return 0, fmt.Errorf("writing %s: %w", dest, err)
			}
			overlay[abs] = dest
			instrumented++
		}
	}
	return instrumented, nil
}

// synthesizeRuntime copies every non-test .go file out of runtimeSrc
// (capture/go/flowtracert) into workDir/overlay/internal/flowtracert, byte
// for byte, and maps it in the overlay as
// "<moduleDir>/internal/flowtracert/<file>" — a package of the user's own
// module the overlay synthesizes out of thin air (D1). It needs no `go.mod`
// edit, `require`, or `go.sum` entry, because as far as the compiler is
// concerned it already lives inside the module being built.
func synthesizeRuntime(runtimeSrc, moduleDir, workDir string, overlay map[string]string) error {
	entries, err := os.ReadDir(runtimeSrc)
	if err != nil {
		return fmt.Errorf("reading -runtime-src %s: %w", runtimeSrc, err)
	}

	destDir := filepath.Join(workDir, "overlay", "internal", "flowtracert")
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return fmt.Errorf("creating %s: %w", destDir, err)
	}

	copied := 0
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(runtimeSrc, name))
		if err != nil {
			return fmt.Errorf("reading runtime source %s: %w", name, err)
		}
		dest := filepath.Join(destDir, name)
		if err := os.WriteFile(dest, data, 0o644); err != nil {
			return fmt.Errorf("writing %s: %w", dest, err)
		}
		overlay[filepath.Join(moduleDir, "internal", "flowtracert", name)] = dest
		copied++
	}
	if copied == 0 {
		return fmt.Errorf("-runtime-src %s contained no non-test .go files", runtimeSrc)
	}
	return nil
}

// ---------------------------------------------------------------------------
// user-supplied -overlay detection + merge
// ---------------------------------------------------------------------------

// extractUserOverlay scans the user's own go args for a pre-existing
// -overlay flag and, if found, removes it from the returned args. The go
// tool's own flag parsing is left-to-right, so previously — when
// execInstrumented always put flowtrace's `-overlay` first and appended the
// user's own args (including their own `-overlay`) after — a user-supplied
// -overlay silently won and every bit of instrumentation was discarded: exit
// 0, no jsonl, no warning. Extracting it here lets the caller merge it with
// flowtrace's own overlay instead.
func extractUserOverlay(args []string) (path string, remaining []string, err error) {
	for i, arg := range args {
		var value string
		switch {
		case arg == "-overlay" || arg == "--overlay":
			if i+1 >= len(args) {
				return "", nil, fmt.Errorf("%s given with no value", arg)
			}
			value = args[i+1]
			remaining = append(append([]string{}, args[:i]...), args[i+2:]...)
		case strings.HasPrefix(arg, "-overlay="):
			value = strings.TrimPrefix(arg, "-overlay=")
			remaining = append(append([]string{}, args[:i]...), args[i+1:]...)
		case strings.HasPrefix(arg, "--overlay="):
			value = strings.TrimPrefix(arg, "--overlay=")
			remaining = append(append([]string{}, args[:i]...), args[i+1:]...)
		default:
			continue
		}
		return value, remaining, nil
	}
	return "", args, nil
}

// mergeUserOverlay reads the user's own -overlay manifest and merges its
// Replace entries into flowtrace's. `go build`/`run`/`test` accept only one
// -overlay flag, so the two have to become one manifest rather than two
// flags — Go resolves both the original-path keys and the backing-file
// values in an overlay manifest relative to the invoking `go` command's cwd
// (verified locally), not to wherever the manifest file itself lives, so
// copying entries verbatim into a manifest written to a different directory
// (flowtrace's scratch work dir) is safe as long as the `go` invocation's
// cwd is unchanged — which it is (execInstrumented always runs with
// cmd.Dir = the target module dir, exactly as a bare `go` command would). A
// genuine collision — both remapping the very same original path — is a
// real conflict flowtrace cannot silently resolve, so it fails loudly
// instead of guessing which one wins.
func mergeUserOverlay(path string, overlay map[string]string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("reading your -overlay %s: %w", path, err)
	}
	var manifest overlayManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return fmt.Errorf("parsing your -overlay %s: %w", path, err)
	}
	for orig, replacement := range manifest.Replace {
		if existing, ok := overlay[orig]; ok && existing != replacement {
			return fmt.Errorf(
				"your -overlay and flowtrace's own overlay both remap %s — cannot merge them "+
					"(flowtrace maps it to %s, yours to %s)",
				orig, existing, replacement)
		}
		overlay[orig] = replacement
	}
	return nil
}

// ---------------------------------------------------------------------------
// overlay manifest + exec
// ---------------------------------------------------------------------------

type overlayManifest struct {
	Replace map[string]string
}

func writeOverlay(workDir string, replace map[string]string) (string, error) {
	data, err := json.MarshalIndent(overlayManifest{Replace: replace}, "", "  ")
	if err != nil {
		return "", err
	}
	path := filepath.Join(workDir, "overlay.json")
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return "", err
	}
	return path, nil
}

// execInstrumented splices `-overlay <path>` right after the go subcommand
// (run/build/test) and before the rest of the user's own args, then execs
// go with the traced program's stdio inherited directly. The returned code
// is the traced program's own exit code — flowtrace-go must not mask it.
//
// `go test` additionally gets `-vet=off`: by default it runs a subset of
// `go vet` before the test binary, and that vet subprocess chdirs into each
// package's *original* directory — which, for the synthesized
// internal/flowtracert package (D1: it exists only in the overlay, never on
// disk), doesn't exist, so the chdir fails and the whole `go test` aborts
// before a single test runs. Measured directly: `go test ./...` under this
// overlay fails with "chdir .../internal/flowtracert: no such file or
// directory" without -vet=off, and passes with it. A user who wants vet on
// their own code can still run a plain `go vet ./...` (unaffected — that is
// not under this overlay at all) or pass their own -vet flag, which — flag
// parsing being left-to-right — overrides this one.
func execInstrumented(cwd, overlayPath, subcommand string, rest []string) int {
	args := []string{subcommand, "-overlay", overlayPath}
	if subcommand == "test" {
		fmt.Fprintln(os.Stderr, "[flowtrace-go] disabling `go vet` for this test run (-vet=off) — "+
			"the synthesized internal/flowtracert package (D1) only exists in the overlay, and vet's "+
			"own chdir into each package's original directory fails on a directory that was never "+
			"created on disk. Run a plain `go vet ./...` separately to vet your own code.")
		args = append(args, "-vet=off")
	}
	args = append(args, rest...)

	cmd := exec.Command("go", args...)
	cmd.Dir = cwd
	cmd.Env = os.Environ()
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return exitErr.ExitCode()
		}
		fmt.Fprintf(os.Stderr, "[flowtrace-go] running `go %s`: %v\n", strings.Join(args, " "), err)
		return 1
	}
	return 0
}
