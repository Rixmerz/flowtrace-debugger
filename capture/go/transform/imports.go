package transform

import (
	"go/ast"
	"go/token"
	"strconv"
)

// runtimeImportAlias is the fixed alias every injected Enter/Exit/ExitPanic
// call is qualified with.
const runtimeImportAlias = "_ftrt"

// runtimeImportSuffix, appended to the user's own module path, is where the
// synthesised runtime package is injected (see D1: it is a package of the
// user's own module as far as the compiler is concerned, so it needs no
// require, replace, go.sum entry, or go.mod edit).
const runtimeImportSuffix = "/internal/flowtracert"

func runtimeImportPath(modulePath string) string {
	return modulePath + runtimeImportSuffix
}

// importEdits adds `_ftrt "<modulePath>/internal/flowtracert"` to file's
// import declaration, handling all three shapes a Go file can be in: an
// existing parenthesised import block, a single bare `import "x"` (which
// has to gain parens to hold a second spec), or no import declaration at
// all (attached onto the package clause's line).
func importEdits(fset *token.FileSet, file *ast.File, modulePath string) []edit {
	injected := runtimeImportAlias + " " + strconv.Quote(runtimeImportPath(modulePath))

	for _, decl := range file.Decls {
		gd, ok := decl.(*ast.GenDecl)
		if !ok || gd.Tok != token.IMPORT {
			continue
		}

		if gd.Lparen.IsValid() {
			pos := fset.Position(gd.Lparen).Offset + 1
			return []edit{{start: pos, end: pos, text: injected + "; "}}
		}

		// Single bare import, no parens: `import "fmt"`. Wrap it.
		spec := gd.Specs[0].(*ast.ImportSpec)
		startPos := fset.Position(spec.Pos()).Offset
		endPos := fset.Position(spec.End()).Offset
		return []edit{
			{start: endPos, end: endPos, text: ")"},
			{start: startPos, end: startPos, text: "(" + injected + "; "},
		}
	}

	// No import declaration in the file at all: attach one to the package
	// clause's line so no newline needs inserting.
	pos := fset.Position(file.Name.End()).Offset
	return []edit{{start: pos, end: pos, text: "; import " + injected}}
}
