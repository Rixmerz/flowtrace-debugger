// Package transform instruments Go source files for FlowTrace by
// byte-splicing enter/exit calls into the original bytes - never by
// printing a mutated AST.
//
// That is not a style preference. go/printer round-trips an *unmutated* AST
// byte-identically, but printing a *mutated* one re-places comments by
// absolute position and shifts line numbers, so every stack trace in the
// traced program would point at the wrong line. A debugger that makes stack
// traces lie is worse than no debugger.
//
// So the AST here is read-only: it is used only to locate offsets
// (FuncDecl.Body.Lbrace, the results list, the import block), and every
// change is then applied as a text edit against the original []byte, back
// to front, so earlier offsets stay valid as later ones are spliced in.
// Inserting immediately after `{` with no newline, and never deleting a
// newline, is what keeps every line number - and so every stack trace -
// exactly where it was.
package transform

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"strconv"
	"strings"
)

// Result is the outcome of transforming one file.
type Result struct {
	// Source is the transformed bytes. When Skipped is true, or when the
	// file had nothing to instrument, this is the original bytes,
	// untouched.
	Source []byte
	// Skipped is true when the file was deliberately left alone (AC5): a
	// cgo file, a _test.go file, or a file that failed to parse. A tracer
	// must never break the build it was pointed at.
	Skipped bool
	// Reason explains why Skipped is true. Callers should log it as a
	// warning, not treat it as an error.
	Reason string
}

// File instruments the Go source src (read from disk at filename) so every
// function and method with a body gains a FlowTrace enter/exit call.
//
// modulePath is the user's own module (the `module` line of their go.mod);
// it is used to build the injected runtime import path,
// "<modulePath>/internal/flowtracert". pkgImportPath is this file's own
// package import path, passed through verbatim as the `module` argument on
// every injected Enter call.
func File(filename string, src []byte, modulePath, pkgImportPath string) (Result, error) {
	if strings.HasSuffix(filename, "_test.go") {
		return Result{Source: src, Skipped: true, Reason: "test file"}, nil
	}

	fset := token.NewFileSet()
	astFile, err := parser.ParseFile(fset, filename, src, parser.ParseComments)
	if err != nil {
		return Result{Source: src, Skipped: true, Reason: fmt.Sprintf("parse error: %v", err)}, nil
	}

	if importsCgo(astFile) {
		return Result{Source: src, Skipped: true, Reason: "cgo file"}, nil
	}

	var edits []edit
	instrumented := 0

	for _, decl := range astFile.Decls {
		fd, ok := decl.(*ast.FuncDecl)
		if !ok || fd.Body == nil {
			// Not a func, or a body-less declaration (assembly) - AC5
			// says skip it, not the whole file.
			continue
		}
		edits = append(edits, instrumentFunc(fset, astFile, fd, pkgImportPath)...)
		instrumented++
	}

	if instrumented == 0 {
		return Result{Source: src}, nil
	}

	edits = append(edits, importEdits(fset, astFile, modulePath)...)

	out, err := applyEdits(src, edits)
	if err != nil {
		return Result{}, fmt.Errorf("transform %s: %w", filename, err)
	}
	return Result{Source: out}, nil
}

func importsCgo(file *ast.File) bool {
	for _, imp := range file.Imports {
		path, err := strconv.Unquote(imp.Path.Value)
		if err == nil && path == "C" {
			return true
		}
	}
	return false
}

// instrumentFunc builds the edits for a single instrumented FuncDecl: the
// result-naming edits in its signature (if any), and the single enter/defer
// insertion right after its opening brace.
func instrumentFunc(fset *token.FileSet, file *ast.File, fd *ast.FuncDecl, module string) []edit {
	used := collectIdents(fd)

	spanVar := uniqueName("_ft_s", used)
	panicVar := uniqueName("_ft_p", used)

	results, edits := instrumentResults(fset, fd, used)

	class := receiverClass(fd)
	method := fd.Name.Name
	vis := visibility(method)

	enterArgs := []string{
		strconv.Quote(module),
		strconv.Quote(class),
		strconv.Quote(method),
		strconv.Quote(vis),
	}
	// Detected once: it decides both what the args look like and whether the
	// inbound traceparent is adopted below.
	reqParam := httpRequestParam(fd, netHTTPLocalName(file))

	if reqParam != "" {
		// A handler's own parameters are a credential leak, not data — see
		// handlerArgsText.
		enterArgs = append(enterArgs, handlerArgsText(reqParam))
	} else if argsText := paramArgsText(fd); argsText != "" {
		enterArgs = append(enterArgs, argsText)
	}

	// Results travel to Exit the same way parameters travel to Enter: as
	// name/value pairs, so a named result keeps its declared name in the
	// trace (see resultBinding).
	exitArgs := spanVar
	if len(results) > 0 {
		exitArgs = spanVar + ", " + resultArgsText(results)
	}

	inject := fmt.Sprintf(
		"%s := %s.Enter(%s); defer func() { if %s := recover(); %s != nil { %s.ExitPanic(%s, %s); panic(%s) }; %s.Exit(%s) }();",
		spanVar, runtimeImportAlias, strings.Join(enterArgs, ", "),
		panicVar, panicVar, runtimeImportAlias, spanVar, panicVar, panicVar,
		runtimeImportAlias, exitArgs,
	)

	// An HTTP handler adopts the caller's trace before its own span opens, so
	// this process continues one distributed trace instead of starting a fresh
	// one per request. Prepended, because Enter reads the context this
	// installs. `defer f()()` calls the seed now and defers the restore it
	// returns, which then runs after the exit defer (LIFO) — the span closes
	// inside the adopted context, and the goroutine is handed back unchanged.
	if reqParam != "" {
		inject = fmt.Sprintf(
			"defer %s.SeedFromTraceparent(%s.Header.Get(\"traceparent\"))(); ",
			runtimeImportAlias, reqParam,
		) + inject
	}

	lbrace := fset.Position(fd.Body.Lbrace).Offset + 1 // right after '{', no newline
	edits = append(edits, edit{start: lbrace, end: lbrace, text: inject})

	return edits
}
