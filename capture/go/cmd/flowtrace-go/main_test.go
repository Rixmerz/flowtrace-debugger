package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// FLOWTRACE_PACKAGE_PREFIX
// ---------------------------------------------------------------------------

func TestParsePackagePrefixes(t *testing.T) {
	cases := []struct {
		raw  string
		want []string
	}{
		{"", nil},
		{"   ", nil},
		{",,", nil},
		{"example.com/app", []string{"example.com/app"}},
		{"example.com/app/", []string{"example.com/app"}},
		{" example.com/app , example.com/lib/ ,,", []string{"example.com/app", "example.com/lib"}},
	}
	for _, c := range cases {
		got := parsePackagePrefixes(c.raw)
		if strings.Join(got, "|") != strings.Join(c.want, "|") {
			t.Errorf("parsePackagePrefixes(%q) = %v, want %v", c.raw, got, c.want)
		}
	}
}

func TestMatchesPackagePrefix(t *testing.T) {
	prefixes := []string{"example.com/app", "example.com/lib/db"}
	cases := []struct {
		importPath string
		want       bool
	}{
		{"example.com/app", true},             // exact
		{"example.com/app/internal/x", true},  // nested
		{"example.com/apparel", false},        // string prefix but not a path prefix
		{"example.com/lib", false},            // parent of a prefix is not selected
		{"example.com/lib/db/postgres", true}, // second prefix, nested
		{"example.com/lib/dbx", false},        // sibling of the second prefix
		{"other.org/app", false},              // unrelated
	}
	for _, c := range cases {
		if got := matchesPackagePrefix(c.importPath, prefixes); got != c.want {
			t.Errorf("matchesPackagePrefix(%q) = %v, want %v", c.importPath, got, c.want)
		}
	}
	if !matchesPackagePrefix("anything/at/all", nil) {
		t.Error("no prefixes must select every package (the pre-prefix default)")
	}
}

func TestSelectPackagesHonoursPrefixAndMainModuleOnly(t *testing.T) {
	main := &goModule{Path: "example.com/app", Main: true}
	dep := &goModule{Path: "example.com/dep", Main: false}
	pkgs := []goPackage{
		{ImportPath: "example.com/app", Module: main},
		{ImportPath: "example.com/app/cmd/api", Module: main},
		{ImportPath: "example.com/app/internal/store", Module: main},
		{ImportPath: "example.com/dep/thing", Module: dep},
		{ImportPath: "no/module", Module: nil},
	}

	all := selectPackages(pkgs, nil)
	if len(all) != 3 {
		t.Fatalf("no prefix: selected %d packages, want the 3 main-module ones: %v", len(all), all)
	}

	// The CLI's default is the module path itself — that must be a no-op.
	byModule := selectPackages(pkgs, []string{"example.com/app"})
	if len(byModule) != 3 {
		t.Fatalf("module-path prefix: selected %d packages, want 3", len(byModule))
	}

	narrow := selectPackages(pkgs, []string{"example.com/app/internal"})
	if len(narrow) != 1 || narrow[0].ImportPath != "example.com/app/internal/store" {
		t.Fatalf("narrow prefix: got %v, want only internal/store", narrow)
	}

	// A prefix that would match a dependency still never selects it.
	if got := selectPackages(pkgs, []string{"example.com/dep"}); len(got) != 0 {
		t.Fatalf("dependency must never be selected, got %v", got)
	}
}

func TestReportSelection(t *testing.T) {
	m := &goModule{Path: "example.com/app", Main: true}
	all := []goPackage{{ImportPath: "example.com/app", Module: m}, {ImportPath: "example.com/app/x", Module: m}}

	var buf bytes.Buffer
	reportSelection(&buf, all, all, "example.com/app", nil)
	if !strings.Contains(buf.String(), "all 2 package(s)") || !strings.Contains(buf.String(), "unset") {
		t.Errorf("unset prefix line = %q", buf.String())
	}
	if strings.Count(buf.String(), "\n") != 1 {
		t.Errorf("expected exactly one line, got %q", buf.String())
	}

	buf.Reset()
	reportSelection(&buf, all[:1], all, "example.com/app", []string{"example.com/app"})
	if !strings.Contains(buf.String(), "1 of 2 package(s)") {
		t.Errorf("set prefix line = %q", buf.String())
	}

	buf.Reset()
	reportSelection(&buf, nil, all, "example.com/app", []string{"example.com/nope"})
	if !strings.Contains(buf.String(), "0 of 2") || !strings.Contains(buf.String(), "WARNING") {
		t.Errorf("zero-match must warn, got %q", buf.String())
	}
}

// ---------------------------------------------------------------------------
// toolchain / go directive guards
// ---------------------------------------------------------------------------

func TestParseGoVersion(t *testing.T) {
	cases := []struct {
		in           string
		major, minor int
		ok           bool
	}{
		{"go version go1.24.0 darwin/arm64\n", 1, 24, true},
		{"go version go1.27.1 linux/amd64", 1, 27, true},
		{"go version devel go1.26-abcdef Mon Jan 1 00:00:00 2026 +0000 linux/amd64", 1, 26, true},
		{"go version go2.0 linux/amd64", 2, 0, true},
		{"not a version line", 0, 0, false},
		{"", 0, 0, false},
	}
	for _, c := range cases {
		major, minor, ok := parseGoVersion(c.in)
		if major != c.major || minor != c.minor || ok != c.ok {
			t.Errorf("parseGoVersion(%q) = (%d, %d, %v), want (%d, %d, %v)", c.in, major, minor, ok, c.major, c.minor, c.ok)
		}
	}
}

func TestCheckModuleGoDirective(t *testing.T) {
	for _, ok := range []string{"", "1.24", "1.24.7", "1.25", "1.27.1", "2.0", "garbage"} {
		if err := checkModuleGoDirective(ok); err != nil {
			t.Errorf("checkModuleGoDirective(%q) = %v, want nil", ok, err)
		}
	}
	for _, old := range []string{"1.16", "1.21", "1.23.0", "0.9"} {
		err := checkModuleGoDirective(old)
		if err == nil {
			t.Errorf("checkModuleGoDirective(%q) = nil, want the floor error", old)
			continue
		}
		if !strings.Contains(err.Error(), "go "+old) || !strings.Contains(err.Error(), "1.24") {
			t.Errorf("error for %q should name the directive and the floor, got: %v", old, err)
		}
	}
}

// ---------------------------------------------------------------------------
// collision detection
// ---------------------------------------------------------------------------

func TestCheckNoCollision(t *testing.T) {
	clean := t.TempDir()
	if err := checkNoCollision(clean); err != nil {
		t.Fatalf("empty module: %v", err)
	}

	withDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(withDir, "internal", "flowtracert"), 0o755); err != nil {
		t.Fatal(err)
	}
	err := checkNoCollision(withDir)
	if err == nil || !strings.Contains(err.Error(), "a directory") {
		t.Fatalf("existing directory: got %v, want a collision error naming a directory", err)
	}

	withFile := t.TempDir()
	if err := os.MkdirAll(filepath.Join(withFile, "internal"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(withFile, "internal", "flowtracert"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	err = checkNoCollision(withFile)
	if err == nil || !strings.Contains(err.Error(), "a file") {
		t.Fatalf("existing file: got %v, want a collision error naming a file", err)
	}
}

// ---------------------------------------------------------------------------
// user -overlay extraction + merge — the shipped bug was that a user's own
// -overlay, appended after flowtrace's, silently won and discarded every
// bit of instrumentation (exit 0, no jsonl, no warning).
// ---------------------------------------------------------------------------

func TestExtractUserOverlay(t *testing.T) {
	cases := []struct {
		name     string
		args     []string
		wantPath string
		wantRest []string
	}{
		{"none", []string{"-race", "./cmd/api"}, "", []string{"-race", "./cmd/api"}},
		{"space form", []string{"-race", "-overlay", "o.json", "./cmd/api"}, "o.json", []string{"-race", "./cmd/api"}},
		{"double dash space form", []string{"--overlay", "o.json", "."}, "o.json", []string{"."}},
		{"equals form", []string{"-overlay=o.json", "."}, "o.json", []string{"."}},
		{"double dash equals form", []string{"--overlay=/abs/o.json", "."}, "/abs/o.json", []string{"."}},
		{"first wins", []string{"-overlay=a.json", "-overlay=b.json"}, "a.json", []string{"-overlay=b.json"}},
	}
	for _, c := range cases {
		path, rest, err := extractUserOverlay(c.args)
		if err != nil {
			t.Errorf("%s: unexpected error %v", c.name, err)
			continue
		}
		if path != c.wantPath {
			t.Errorf("%s: path = %q, want %q", c.name, path, c.wantPath)
		}
		if strings.Join(rest, " ") != strings.Join(c.wantRest, " ") {
			t.Errorf("%s: remaining = %v, want %v", c.name, rest, c.wantRest)
		}
	}

	if _, _, err := extractUserOverlay([]string{".", "-overlay"}); err == nil {
		t.Error("dangling -overlay with no value must be an error, not a silent drop")
	}

	// The input slice must never be mutated — the caller still owns it.
	orig := []string{"-overlay", "o.json", "."}
	copyOf := append([]string{}, orig...)
	extractUserOverlay(orig)
	if strings.Join(orig, " ") != strings.Join(copyOf, " ") {
		t.Errorf("extractUserOverlay mutated its input: %v", orig)
	}
}

func writeManifest(t *testing.T, replace map[string]string) string {
	t.Helper()
	data, err := json.Marshal(overlayManifest{Replace: replace})
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "user-overlay.json")
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestMergeUserOverlayMergesDisjointEntries(t *testing.T) {
	ours := map[string]string{"/mod/a.go": "/work/overlay/a.go"}
	theirs := writeManifest(t, map[string]string{
		"/mod/b.go":   "/elsewhere/b.go",
		"/mod/gen.go": "", // an empty replacement deletes the file; must survive verbatim
	})
	if err := mergeUserOverlay(theirs, ours); err != nil {
		t.Fatalf("merge: %v", err)
	}
	if len(ours) != 3 || ours["/mod/b.go"] != "/elsewhere/b.go" || ours["/mod/a.go"] != "/work/overlay/a.go" {
		t.Errorf("merged overlay = %v", ours)
	}
	if v, ok := ours["/mod/gen.go"]; !ok || v != "" {
		t.Errorf("empty (delete) replacement lost: %v", ours)
	}
}

func TestMergeUserOverlayRejectsCollision(t *testing.T) {
	ours := map[string]string{"/mod/a.go": "/work/overlay/a.go"}
	theirs := writeManifest(t, map[string]string{"/mod/a.go": "/elsewhere/a.go"})
	err := mergeUserOverlay(theirs, ours)
	if err == nil || !strings.Contains(err.Error(), "/mod/a.go") {
		t.Fatalf("both remapping the same file must fail naming it, got %v", err)
	}
	if ours["/mod/a.go"] != "/work/overlay/a.go" {
		t.Errorf("a failed merge must leave flowtrace's own mapping intact: %v", ours)
	}
}

func TestMergeUserOverlayAcceptsIdenticalMapping(t *testing.T) {
	ours := map[string]string{"/mod/a.go": "/same/a.go"}
	theirs := writeManifest(t, map[string]string{"/mod/a.go": "/same/a.go"})
	if err := mergeUserOverlay(theirs, ours); err != nil {
		t.Fatalf("identical mapping is not a conflict: %v", err)
	}
}

func TestMergeUserOverlayReportsUnreadableOrMalformedManifest(t *testing.T) {
	ours := map[string]string{}
	if err := mergeUserOverlay(filepath.Join(t.TempDir(), "missing.json"), ours); err == nil {
		t.Error("missing manifest must be an error")
	}
	bad := filepath.Join(t.TempDir(), "bad.json")
	if err := os.WriteFile(bad, []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := mergeUserOverlay(bad, ours); err == nil || !strings.Contains(err.Error(), "parsing") {
		t.Errorf("malformed manifest: got %v, want a parsing error", err)
	}
	if len(ours) != 0 {
		t.Errorf("a failed merge must not add entries: %v", ours)
	}
}

// ---------------------------------------------------------------------------
// staging: instrumentPackages / synthesizeRuntime / writeOverlay
// ---------------------------------------------------------------------------

func assertPerm(t *testing.T, path string, want os.FileMode) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat %s: %v", path, err)
	}
	if got := info.Mode().Perm(); got != want {
		t.Errorf("%s has mode %o, want %o", path, got, want)
	}
}

func TestInstrumentPackagesStagesOnlyChangedGoFilesWithPrivatePerms(t *testing.T) {
	moduleDir := t.TempDir()
	pkgDir := filepath.Join(moduleDir, "svc")
	if err := os.MkdirAll(pkgDir, 0o755); err != nil {
		t.Fatal(err)
	}
	mustWriteFile(t, filepath.Join(pkgDir, "svc.go"), "package svc\n\nfunc Do(n int) int { return n }\n")
	mustWriteFile(t, filepath.Join(pkgDir, "types.go"), "package svc\n\ntype T struct{}\n") // nothing to instrument
	mustWriteFile(t, filepath.Join(pkgDir, "cgo.go"), "package svc\n\n// #include <stdio.h>\nimport \"C\"\n\nfunc Native() { C.fflush(nil) }\n")

	workDir := t.TempDir()
	overlay := map[string]string{}
	pkgs := []goPackage{{
		Dir:        pkgDir,
		ImportPath: "example.com/app/svc",
		GoFiles:    []string{"svc.go", "types.go"},
		CgoFiles:   []string{"cgo.go"},
		Module:     &goModule{Path: "example.com/app", Dir: moduleDir, Main: true},
	}, {
		Dir:        pkgDir,
		ImportPath: "example.com/dep/x",
		GoFiles:    []string{"svc.go"},
		Module:     &goModule{Path: "example.com/dep", Main: false},
	}}

	report, err := instrumentPackages(pkgs, moduleDir, "example.com/app", workDir, overlay)
	if err != nil {
		t.Fatalf("instrumentPackages: %v", err)
	}
	if report.instrumentedFiles != 1 {
		t.Errorf("instrumentedFiles = %d, want 1 (svc.go only)", report.instrumentedFiles)
	}
	if report.cgoFilesSkipped != 1 {
		t.Errorf("cgoFilesSkipped = %d, want 1", report.cgoFilesSkipped)
	}
	if len(overlay) != 1 {
		t.Fatalf("overlay = %v, want exactly the one rewritten file", overlay)
	}
	dest, ok := overlay[filepath.Join(pkgDir, "svc.go")]
	if !ok {
		t.Fatalf("svc.go not in overlay: %v", overlay)
	}
	if want := filepath.Join(workDir, "overlay", "svc", "svc.go"); dest != want {
		t.Errorf("dest = %s, want the module layout mirrored at %s", dest, want)
	}
	staged, err := os.ReadFile(dest)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(staged), "_ftrt.Enter(") || !strings.Contains(string(staged), `"example.com/app/internal/flowtracert"`) {
		t.Errorf("staged file is not instrumented:\n%s", staged)
	}
	// The user's tree is never written to.
	orig, _ := os.ReadFile(filepath.Join(pkgDir, "svc.go"))
	if strings.Contains(string(orig), "_ftrt") {
		t.Fatal("original source was modified")
	}
	assertPerm(t, filepath.Join(workDir, "overlay"), 0o700)
	assertPerm(t, filepath.Join(workDir, "overlay", "svc"), 0o700)
	assertPerm(t, dest, 0o600)
}

func TestSynthesizeRuntimeCopiesNonTestFilesVerbatim(t *testing.T) {
	runtimeSrc, err := filepath.Abs(filepath.Join("..", "..", "flowtracert"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(runtimeSrc); err != nil {
		t.Skipf("runtime source not found at %s: %v", runtimeSrc, err)
	}
	moduleDir := "/fake/module"
	workDir := t.TempDir()
	overlay := map[string]string{}
	if err := synthesizeRuntime(runtimeSrc, moduleDir, workDir, overlay); err != nil {
		t.Fatalf("synthesizeRuntime: %v", err)
	}
	if len(overlay) == 0 {
		t.Fatal("nothing was synthesized")
	}
	destDir := filepath.Join(workDir, "overlay", "internal", "flowtracert")
	assertPerm(t, destDir, 0o700)
	for orig, dest := range overlay {
		if !strings.HasPrefix(orig, filepath.Join(moduleDir, "internal", "flowtracert")+string(os.PathSeparator)) {
			t.Errorf("overlay key %s is not under <module>/internal/flowtracert", orig)
		}
		if strings.HasSuffix(orig, "_test.go") {
			t.Errorf("test file %s must not be injected into the user's module", orig)
		}
		src, err := os.ReadFile(filepath.Join(runtimeSrc, filepath.Base(orig)))
		if err != nil {
			t.Fatal(err)
		}
		got, err := os.ReadFile(dest)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(src, got) {
			t.Errorf("%s was not copied byte-for-byte", filepath.Base(orig))
		}
		// Every injected file lands in a third party's module, so it must
		// declare its licence on its first line.
		if !bytes.HasPrefix(got, []byte("// SPDX-License-Identifier: MIT\n")) {
			t.Errorf("%s does not start with the SPDX licence line", filepath.Base(orig))
		}
		assertPerm(t, dest, 0o600)
	}
}

func TestWriteOverlayManifest(t *testing.T) {
	workDir := t.TempDir()
	path, err := writeOverlay(workDir, map[string]string{"/mod/a.go": "/work/a.go"})
	if err != nil {
		t.Fatal(err)
	}
	assertPerm(t, path, 0o600)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var m overlayManifest
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatalf("manifest is not JSON: %v\n%s", err, data)
	}
	if m.Replace["/mod/a.go"] != "/work/a.go" {
		t.Errorf("manifest = %v", m)
	}
}

func mustWriteFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}
