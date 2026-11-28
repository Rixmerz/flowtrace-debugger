package transform

import (
	"go/ast"
	"go/token"
	"path/filepath"
	"strings"
)

// declLine is the 1-indexed line of fd's `func` keyword in the original
// source — the line a static index records for the symbol. It is NOT
// fd.Pos() by accident of them being equal today: the doc comment and any
// //go: directive above the declaration are deliberately excluded, and
// naming the keyword says so. 0 when the position is unknown.
func declLine(fset *token.FileSet, fd *ast.FuncDecl) int {
	pos := fd.Pos()
	if fd.Type != nil && fd.Type.Func.IsValid() {
		pos = fd.Type.Func
	}
	if !pos.IsValid() {
		return 0
	}
	return fset.Position(pos).Line
}

// SourceFile renders path — an original source file — the way the trace's
// `file` field carries it: a POSIX path relative to root, the project root
// (the module root, unless FLOWTRACE_ROOT overrides it). A file outside
// root is rendered as an absolute POSIX path rather than a `../` chain,
// which a consumer could only resolve by knowing root.
//
// Both sides are compared lexically first and, only if that puts the file
// outside, again with symlinks resolved: `go list` reports a module under a
// symlinked directory by its resolved path while a root typed by the user
// keeps the link, and that mismatch must not turn every path absolute.
func SourceFile(root, path string) string {
	abs, err := filepath.Abs(path)
	if err != nil {
		abs = path
	}
	if root == "" {
		return filepath.ToSlash(abs)
	}
	if rel, ok := relInside(root, abs); ok {
		return rel
	}
	realRoot, errRoot := filepath.EvalSymlinks(root)
	realAbs, errAbs := filepath.EvalSymlinks(abs)
	if errRoot == nil && errAbs == nil {
		if rel, ok := relInside(realRoot, realAbs); ok {
			return rel
		}
	}
	return filepath.ToSlash(abs)
}

// relInside returns path relative to root, slash-separated, when path sits
// inside root.
func relInside(root, path string) (string, bool) {
	rel, err := filepath.Rel(root, path)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return "", false
	}
	return filepath.ToSlash(rel), true
}
