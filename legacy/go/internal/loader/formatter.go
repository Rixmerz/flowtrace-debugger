package loader

import (
	"bytes"
	"go/ast"
	"go/format"
	"go/printer"
	"go/token"
	"io"

	"golang.org/x/tools/imports"
)

// formatAST formats an AST file and writes it to the writer
func formatAST(fset *token.FileSet, file *ast.File, w io.Writer) error {
	// First, print to buffer
	var buf bytes.Buffer
	cfg := printer.Config{
		Mode:     printer.TabIndent | printer.UseSpaces,
		Tabwidth: 4,
	}

	if err := cfg.Fprint(&buf, fset, file); err != nil {
		return err
	}

	// Use imports.Process to format AND clean up unused imports
	// This handles both formatting and import management in one step
	formatted, err := imports.Process("", buf.Bytes(), nil)
	if err != nil {
		// If imports.Process fails, try regular format
		formatted, err = format.Source(buf.Bytes())
		if err != nil {
			// If both fail, write unformatted code
			_, writeErr := w.Write(buf.Bytes())
			return writeErr
		}
	}

	// Write formatted code
	_, err = w.Write(formatted)
	return err
}

// FormatNode formats an AST node and returns formatted source
func FormatNode(fset *token.FileSet, node ast.Node) ([]byte, error) {
	var buf bytes.Buffer
	if file, ok := node.(*ast.File); ok {
		if err := formatAST(fset, file, &buf); err != nil {
			return nil, err
		}
	} else {
		// For non-file nodes, use printer directly
		cfg := printer.Config{
			Mode:     printer.TabIndent | printer.UseSpaces,
			Tabwidth: 4,
		}
		if err := cfg.Fprint(&buf, fset, node); err != nil {
			return nil, err
		}
	}
	return buf.Bytes(), nil
}

// FormatFile formats an entire file and returns formatted source
func FormatFile(fset *token.FileSet, file *ast.File) ([]byte, error) {
	return FormatNode(fset, file)
}
