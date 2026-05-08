package ast

import (
	"go/ast"
	"go/token"
	"go/types"
)

// Analyzer provides code analysis utilities
type Analyzer struct {
	fset *token.FileSet
}

// NewAnalyzer creates a new analyzer
func NewAnalyzer(fset *token.FileSet) *Analyzer {
	return &Analyzer{fset: fset}
}

// ShouldInstrument determines if a function should be instrumented
func (a *Analyzer) ShouldInstrument(fn *ast.FuncDecl) bool {
	// Skip nil functions
	if fn == nil {
		return false
	}

	// Skip functions without body
	if fn.Body == nil {
		return false
	}

	// Skip init functions
	if fn.Name.Name == "init" {
		return false
	}

	// Skip test helper functions (TestMain, etc.)
	if fn.Name.Name == "TestMain" {
		return false
	}

	// Skip benchmark setup/teardown
	if fn.Name.Name == "BenchmarkMain" {
		return false
	}

	return true
}

// IsTestFile checks if a file is a test file
func (a *Analyzer) IsTestFile(filename string) bool {
	return len(filename) > 8 && filename[len(filename)-8:] == "_test.go"
}

// HasNamedReturns checks if function has named return values
func (a *Analyzer) HasNamedReturns(fn *ast.FuncDecl) bool {
	if fn == nil || fn.Type == nil || fn.Type.Results == nil {
		return false
	}

	for _, field := range fn.Type.Results.List {
		if len(field.Names) > 0 {
			return true
		}
	}

	return false
}

// CountReturns counts return values in a function
func (a *Analyzer) CountReturns(fn *ast.FuncDecl) int {
	if fn == nil || fn.Type == nil || fn.Type.Results == nil {
		return 0
	}

	count := 0
	for _, field := range fn.Type.Results.List {
		if len(field.Names) == 0 {
			count++
		} else {
			count += len(field.Names)
		}
	}

	return count
}

// ExtractFunctionName returns the full qualified function name
func (a *Analyzer) ExtractFunctionName(fn *ast.FuncDecl) string {
	name := fn.Name.Name

	// Add receiver type for methods
	if fn.Recv != nil && len(fn.Recv.List) > 0 {
		recv := fn.Recv.List[0]
		typeName := types.ExprString(recv.Type)
		name = typeName + "." + name
	}

	return name
}

// FindReturnStatements finds all return statements in a function
func (a *Analyzer) FindReturnStatements(fn *ast.FuncDecl) []*ast.ReturnStmt {
	var returns []*ast.ReturnStmt

	if fn == nil || fn.Body == nil {
		return returns
	}

	ast.Inspect(fn.Body, func(n ast.Node) bool {
		if ret, ok := n.(*ast.ReturnStmt); ok {
			returns = append(returns, ret)
		}
		return true
	})

	return returns
}

// HasDefer checks if function contains defer statements
func (a *Analyzer) HasDefer(fn *ast.FuncDecl) bool {
	hasDefer := false

	ast.Inspect(fn.Body, func(n ast.Node) bool {
		if _, ok := n.(*ast.DeferStmt); ok {
			hasDefer = true
			return false
		}
		return true
	})

	return hasDefer
}

// HasRecover checks if function uses recover()
func (a *Analyzer) HasRecover(fn *ast.FuncDecl) bool {
	hasRecover := false

	ast.Inspect(fn.Body, func(n ast.Node) bool {
		if call, ok := n.(*ast.CallExpr); ok {
			if ident, ok := call.Fun.(*ast.Ident); ok {
				if ident.Name == "recover" {
					hasRecover = true
					return false
				}
			}
		}
		return true
	})

	return hasRecover
}

// IsExported checks if a function is exported (public)
func (a *Analyzer) IsExported(fn *ast.FuncDecl) bool {
	if fn.Name == nil {
		return false
	}
	// In Go, exported names start with uppercase
	name := fn.Name.Name
	return len(name) > 0 && name[0] >= 'A' && name[0] <= 'Z'
}

// FunctionComplexity calculates cyclomatic complexity
func (a *Analyzer) FunctionComplexity(fn *ast.FuncDecl) int {
	complexity := 1 // Base complexity

	ast.Inspect(fn.Body, func(n ast.Node) bool {
		switch n.(type) {
		case *ast.IfStmt:
			complexity++
		case *ast.ForStmt:
			complexity++
		case *ast.RangeStmt:
			complexity++
		case *ast.CaseClause:
			complexity++
		case *ast.CommClause:
			complexity++
		case *ast.BinaryExpr:
			// Count logical operators
			if expr, ok := n.(*ast.BinaryExpr); ok {
				if expr.Op == token.LAND || expr.Op == token.LOR {
					complexity++
				}
			}
		}
		return true
	})

	return complexity
}

// HasVariadicParams checks if function has variadic parameters
func (a *Analyzer) HasVariadicParams(fn *ast.FuncDecl) bool {
	if fn.Type.Params == nil {
		return false
	}

	for _, field := range fn.Type.Params.List {
		if _, ok := field.Type.(*ast.Ellipsis); ok {
			return true
		}
	}

	return false
}

// GetPosition returns the file position of a node
func (a *Analyzer) GetPosition(node ast.Node) token.Position {
	return a.fset.Position(node.Pos())
}

// IsGenerated checks if a file is generated code
func (a *Analyzer) IsGenerated(file *ast.File) bool {
	// Check for "// Code generated" comment
	for _, commentGroup := range file.Comments {
		for _, comment := range commentGroup.List {
			if len(comment.Text) > 17 && comment.Text[:17] == "// Code generated" {
				return true
			}
		}
	}
	return false
}
