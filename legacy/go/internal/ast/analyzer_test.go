package ast

import (
	"go/ast"
	"go/parser"
	"go/token"
	"testing"
)

func TestShouldInstrument(t *testing.T) {
	tests := []struct {
		name     string
		source   string
		expected bool
	}{
		{
			name: "regular function",
			source: `package main
func Add(a, b int) int {
	return a + b
}`,
			expected: true,
		},
		{
			name: "init function",
			source: `package main
func init() {
	setupConfig()
}`,
			expected: false,
		},
		{
			name: "no body function",
			source: `package main
func External() int`,
			expected: false,
		},
		{
			name: "method with receiver",
			source: `package main
type Calculator struct{}
func (c *Calculator) Add(a, b int) int {
	return a + b
}`,
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fset := token.NewFileSet()
			file, err := parser.ParseFile(fset, "test.go", tt.source, 0)
			if err != nil {
				t.Fatalf("Failed to parse: %v", err)
			}

			var fn *ast.FuncDecl
			for _, decl := range file.Decls {
				if f, ok := decl.(*ast.FuncDecl); ok {
					fn = f
					break
				}
			}

			if fn == nil {
				t.Fatal("No function declaration found")
			}

			analyzer := &Analyzer{}
			result := analyzer.ShouldInstrument(fn)
			if result != tt.expected {
				t.Errorf("ShouldInstrument() = %v, want %v", result, tt.expected)
			}
		})
	}
}

func TestHasNamedReturns(t *testing.T) {
	tests := []struct {
		name     string
		source   string
		expected bool
	}{
		{
			name: "named returns",
			source: `package main
func Add(a, b int) (result int) {
	result = a + b
	return
}`,
			expected: true,
		},
		{
			name: "unnamed returns",
			source: `package main
func Add(a, b int) int {
	return a + b
}`,
			expected: false,
		},
		{
			name: "multiple named returns",
			source: `package main
func Divide(a, b int) (result int, err error) {
	if b == 0 {
		err = fmt.Errorf("div by zero")
		return
	}
	result = a / b
	return
}`,
			expected: true,
		},
		{
			name: "no returns",
			source: `package main
func Print() {
	fmt.Println("hello")
}`,
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fset := token.NewFileSet()
			file, err := parser.ParseFile(fset, "test.go", tt.source, 0)
			if err != nil {
				t.Fatalf("Failed to parse: %v", err)
			}

			var fn *ast.FuncDecl
			for _, decl := range file.Decls {
				if f, ok := decl.(*ast.FuncDecl); ok {
					fn = f
					break
				}
			}

			if fn == nil {
				t.Fatal("No function declaration found")
			}

			analyzer := &Analyzer{}
			result := analyzer.HasNamedReturns(fn)
			if result != tt.expected {
				t.Errorf("HasNamedReturns() = %v, want %v", result, tt.expected)
			}
		})
	}
}

func TestCountReturns(t *testing.T) {
	tests := []struct {
		name     string
		source   string
		expected int
	}{
		{
			name: "single return value",
			source: `package main
func Add(a, b int) int {
	return a + b
}`,
			expected: 1,
		},
		{
			name: "multiple return values",
			source: `package main
func Divide(a, b int) (int, error) {
	if b == 0 {
		return 0, fmt.Errorf("div by zero")
	}
	return a / b, nil
}`,
			expected: 2,
		},
		{
			name: "no return values",
			source: `package main
func Print() {
	fmt.Println("hello")
}`,
			expected: 0,
		},
		{
			name: "three return values",
			source: `package main
func Parse(s string) (int, string, error) {
	return 0, "", nil
}`,
			expected: 3,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fset := token.NewFileSet()
			file, err := parser.ParseFile(fset, "test.go", tt.source, 0)
			if err != nil {
				t.Fatalf("Failed to parse: %v", err)
			}

			var fn *ast.FuncDecl
			for _, decl := range file.Decls {
				if f, ok := decl.(*ast.FuncDecl); ok {
					fn = f
					break
				}
			}

			if fn == nil {
				t.Fatal("No function declaration found")
			}

			analyzer := &Analyzer{}
			result := analyzer.CountReturns(fn)
			if result != tt.expected {
				t.Errorf("CountReturns() = %v, want %v", result, tt.expected)
			}
		})
	}
}

func TestFindReturnStatements(t *testing.T) {
	source := `package main
func Example() int {
	if condition {
		return 1
	}
	for i := 0; i < 10; i++ {
		if i == 5 {
			return 5
		}
	}
	return 0
}`

	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "test.go", source, 0)
	if err != nil {
		t.Fatalf("Failed to parse: %v", err)
	}

	var fn *ast.FuncDecl
	for _, decl := range file.Decls {
		if f, ok := decl.(*ast.FuncDecl); ok {
			fn = f
			break
		}
	}

	if fn == nil {
		t.Fatal("No function declaration found")
	}

	analyzer := &Analyzer{}
	returns := analyzer.FindReturnStatements(fn)

	if len(returns) != 3 {
		t.Errorf("Expected 3 return statements, got %d", len(returns))
	}
}

func TestFunctionComplexity(t *testing.T) {
	tests := []struct {
		name     string
		source   string
		minScore int
		maxScore int
	}{
		{
			name: "simple function",
			source: `package main
func Add(a, b int) int {
	return a + b
}`,
			minScore: 1,
			maxScore: 2,
		},
		{
			name: "moderate complexity",
			source: `package main
func Abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}`,
			minScore: 1,
			maxScore: 3,
		},
		{
			name: "high complexity",
			source: `package main
func Complex(n int) int {
	switch n {
	case 0:
		return 0
	case 1:
		return 1
	default:
		for i := 0; i < n; i++ {
			if i%2 == 0 {
				continue
			}
			if i > 10 {
				break
			}
		}
		return n
	}
}`,
			minScore: 5,
			maxScore: 10,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fset := token.NewFileSet()
			file, err := parser.ParseFile(fset, "test.go", tt.source, 0)
			if err != nil {
				t.Fatalf("Failed to parse: %v", err)
			}

			var fn *ast.FuncDecl
			for _, decl := range file.Decls {
				if f, ok := decl.(*ast.FuncDecl); ok {
					fn = f
					break
				}
			}

			if fn == nil {
				t.Fatal("No function declaration found")
			}

			analyzer := &Analyzer{}
			score := analyzer.FunctionComplexity(fn)

			if score < tt.minScore || score > tt.maxScore {
				t.Errorf("FunctionComplexity() = %d, want between %d and %d",
					score, tt.minScore, tt.maxScore)
			}
		})
	}
}

func TestAnalyzerEdgeCases(t *testing.T) {
	t.Run("nil function", func(t *testing.T) {
		analyzer := &Analyzer{}
		if analyzer.ShouldInstrument(nil) {
			t.Error("Expected false for nil function")
		}
		if analyzer.HasNamedReturns(nil) {
			t.Error("Expected false for nil function")
		}
		if count := analyzer.CountReturns(nil); count != 0 {
			t.Errorf("Expected 0 returns for nil function, got %d", count)
		}
	})

	t.Run("function with empty body", func(t *testing.T) {
		source := `package main
func Empty() {
}`
		fset := token.NewFileSet()
		file, err := parser.ParseFile(fset, "test.go", source, 0)
		if err != nil {
			t.Fatalf("Failed to parse: %v", err)
		}

		var fn *ast.FuncDecl
		for _, decl := range file.Decls {
			if f, ok := decl.(*ast.FuncDecl); ok {
				fn = f
				break
			}
		}

		analyzer := &Analyzer{}
		if !analyzer.ShouldInstrument(fn) {
			t.Error("Expected true for function with empty body")
		}
		if count := analyzer.CountReturns(fn); count != 0 {
			t.Errorf("Expected 0 returns, got %d", count)
		}
	})
}
