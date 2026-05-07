package ast

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"go/types"
	"strings"

	"golang.org/x/tools/go/packages"
)

// Transformer handles AST transformation for code instrumentation
type Transformer struct {
	fset    *token.FileSet
	config  *Config
	pkgPath string
}

// Config holds transformer configuration
type Config struct {
	// Packages to include (glob patterns)
	Include []string
	// Packages to exclude (glob patterns)
	Exclude []string
	// Maximum instrumentation depth
	MaxDepth int
	// Whether to instrument test files
	InstrumentTests bool
}

// NewTransformer creates a new AST transformer
func NewTransformer(fset *token.FileSet, config *Config) *Transformer {
	if config == nil {
		config = &Config{
			MaxDepth:        100,
			InstrumentTests: false,
		}
	}
	return &Transformer{
		fset:   fset,
		config: config,
	}
}

// TransformPackage transforms all files in a package
func (t *Transformer) TransformPackage(pkgPath string) ([]*ast.File, error) {
	// Load package
	cfg := &packages.Config{
		Mode: packages.NeedFiles | packages.NeedSyntax | packages.NeedTypes,
		Fset: t.fset,
	}

	pkgs, err := packages.Load(cfg, pkgPath)
	if err != nil {
		return nil, fmt.Errorf("failed to load package: %w", err)
	}

	if len(pkgs) == 0 {
		return nil, fmt.Errorf("no packages found")
	}

	pkg := pkgs[0]
	t.pkgPath = pkg.PkgPath

	var transformed []*ast.File
	for _, file := range pkg.Syntax {
		// Skip test files if configured
		filename := t.fset.Position(file.Pos()).Filename
		if !t.config.InstrumentTests && strings.HasSuffix(filename, "_test.go") {
			continue
		}

		// Transform file
		if err := t.TransformFile(file); err != nil {
			return nil, fmt.Errorf("failed to transform %s: %w", filename, err)
		}

		transformed = append(transformed, file)
	}

	return transformed, nil
}

// TransformFile transforms a single AST file
func (t *Transformer) TransformFile(file *ast.File) error {
	// Walk the AST and transform function declarations
	ast.Inspect(file, func(n ast.Node) bool {
		if fn, ok := n.(*ast.FuncDecl); ok {
			if err := t.instrumentFunction(fn); err != nil {
				// Log error but continue
				fmt.Printf("Warning: failed to instrument %s: %v\n", fn.Name.Name, err)
			}
			return false // Don't descend into function body during inspection
		}
		return true
	})

	// Add flowtrace import if not present
	t.ensureFlowtraceImport(file)

	return nil
}

// instrumentFunction instruments a single function
func (t *Transformer) instrumentFunction(fn *ast.FuncDecl) error {
	if fn.Body == nil {
		// Skip functions without body (interface methods, external declarations)
		return nil
	}

	// Skip init functions (they run before we can set up tracing)
	if fn.Name.Name == "init" {
		return nil
	}

	// Get function info
	info := t.analyzeFuncSignature(fn)

	// Step 1: Ensure function has named returns
	t.ensureNamedReturns(fn, info)

	// Step 2: Create instrumentation statements
	enterStmt := t.createEnterCall(fn, info)
	exitDefer := t.createExitDefer(fn, info)
	recoverDefer := t.createRecoverDefer(fn, info)

	// Step 3: Transform return statements
	t.transformReturns(fn, info)

	// Step 4: Inject instrumentation at function start
	newBody := []ast.Stmt{
		enterStmt,
		recoverDefer,
		exitDefer,
	}
	newBody = append(newBody, fn.Body.List...)
	fn.Body.List = newBody

	return nil
}

// FuncInfo holds analyzed function information
type FuncInfo struct {
	Name           string
	PackageName    string
	ReceiverName   string
	ReceiverType   string
	Args           []ArgInfo
	Results        []ResultInfo
	HasNamedReturns bool
}

// ArgInfo holds argument information
type ArgInfo struct {
	Name string
	Type string
}

// ResultInfo holds return value information
type ResultInfo struct {
	Name string
	Type string
}

// analyzeFuncSignature extracts function signature information
func (t *Transformer) analyzeFuncSignature(fn *ast.FuncDecl) *FuncInfo {
	info := &FuncInfo{
		Name:        fn.Name.Name,
		PackageName: t.pkgPath,
	}

	// Extract receiver info (for methods)
	if fn.Recv != nil && len(fn.Recv.List) > 0 {
		recv := fn.Recv.List[0]
		if len(recv.Names) > 0 {
			info.ReceiverName = recv.Names[0].Name
		}
		info.ReceiverType = types.ExprString(recv.Type)
	}

	// Extract arguments
	if fn.Type.Params != nil {
		for _, field := range fn.Type.Params.List {
			typeName := types.ExprString(field.Type)
			if len(field.Names) == 0 {
				// Unnamed parameter
				info.Args = append(info.Args, ArgInfo{
					Name: "_",
					Type: typeName,
				})
			} else {
				for _, name := range field.Names {
					info.Args = append(info.Args, ArgInfo{
						Name: name.Name,
						Type: typeName,
					})
				}
			}
		}
	}

	// Extract results
	if fn.Type.Results != nil {
		hasNames := false
		for _, field := range fn.Type.Results.List {
			typeName := types.ExprString(field.Type)
			if len(field.Names) > 0 {
				hasNames = true
				for _, name := range field.Names {
					info.Results = append(info.Results, ResultInfo{
						Name: name.Name,
						Type: typeName,
					})
				}
			} else {
				info.Results = append(info.Results, ResultInfo{
					Name: "",
					Type: typeName,
				})
			}
		}
		info.HasNamedReturns = hasNames
	}

	return info
}

// ensureNamedReturns converts unnamed returns to named returns
func (t *Transformer) ensureNamedReturns(fn *ast.FuncDecl, info *FuncInfo) {
	if fn.Type.Results == nil || info.HasNamedReturns {
		return
	}

	// Add names to return values
	idx := 0
	for _, field := range fn.Type.Results.List {
		if len(field.Names) == 0 {
			// Generate name: __ft_ret0, __ft_ret1, etc.
			name := ast.NewIdent(fmt.Sprintf("__ft_ret%d", idx))
			field.Names = []*ast.Ident{name}

			// Update info
			if idx < len(info.Results) {
				info.Results[idx].Name = name.Name
			}
			idx++
		}
	}

	info.HasNamedReturns = true
}

// createEnterCall creates the flowtrace.Enter() call
func (t *Transformer) createEnterCall(fn *ast.FuncDecl, info *FuncInfo) *ast.AssignStmt {
	// Build args map: map[string]interface{}{"arg1": arg1, "arg2": arg2}
	var argElements []ast.Expr

	for _, arg := range info.Args {
		if arg.Name != "_" {
			// Key-value pair
			argElements = append(argElements,
				&ast.KeyValueExpr{
					Key:   &ast.BasicLit{Kind: token.STRING, Value: fmt.Sprintf(`"%s"`, arg.Name)},
					Value: ast.NewIdent(arg.Name),
				},
			)
		}
	}

	// Add receiver for methods
	if info.ReceiverName != "" {
		argElements = append([]ast.Expr{
			&ast.KeyValueExpr{
				Key:   &ast.BasicLit{Kind: token.STRING, Value: `"receiver"`},
				Value: ast.NewIdent(info.ReceiverName),
			},
		}, argElements...)
	}

	// Create: __ft_ctx := flowtrace.Enter("pkg", "func", map[string]interface{}{...})
	return &ast.AssignStmt{
		Lhs: []ast.Expr{ast.NewIdent("__ft_ctx")},
		Tok: token.DEFINE,
		Rhs: []ast.Expr{
			&ast.CallExpr{
				Fun: &ast.SelectorExpr{
					X:   ast.NewIdent("flowtrace"),
					Sel: ast.NewIdent("Enter"),
				},
				Args: []ast.Expr{
					&ast.BasicLit{Kind: token.STRING, Value: fmt.Sprintf(`"%s"`, info.PackageName)},
					&ast.BasicLit{Kind: token.STRING, Value: fmt.Sprintf(`"%s"`, info.Name)},
					&ast.CompositeLit{
						Type: &ast.MapType{
							Key:   ast.NewIdent("string"),
							Value: &ast.InterfaceType{Methods: &ast.FieldList{}},
						},
						Elts: argElements,
					},
				},
			},
		},
	}
}

// createExitDefer creates the defer __ft_ctx.Exit(...) statement
func (t *Transformer) createExitDefer(fn *ast.FuncDecl, info *FuncInfo) *ast.DeferStmt {
	// Build result map or nil
	var resultExpr ast.Expr = ast.NewIdent("nil")

	if len(info.Results) > 0 {
		// Create function that returns results: func() interface{} { return map[string]interface{}{...} }
		var resultElements []ast.Expr
		for i, res := range info.Results {
			if res.Name != "" {
				resultElements = append(resultElements,
					&ast.KeyValueExpr{
						Key:   &ast.BasicLit{Kind: token.STRING, Value: fmt.Sprintf(`"result_%d"`, i)},
						Value: ast.NewIdent(res.Name),
					},
				)
			}
		}

		resultExpr = &ast.FuncLit{
			Type: &ast.FuncType{
				Results: &ast.FieldList{
					List: []*ast.Field{{
						Type: &ast.InterfaceType{Methods: &ast.FieldList{}},
					}},
				},
			},
			Body: &ast.BlockStmt{
				List: []ast.Stmt{
					&ast.ReturnStmt{
						Results: []ast.Expr{
							&ast.CompositeLit{
								Type: &ast.MapType{
									Key:   ast.NewIdent("string"),
									Value: &ast.InterfaceType{Methods: &ast.FieldList{}},
								},
								Elts: resultElements,
							},
						},
					},
				},
			},
		}
	}

	// Create: defer __ft_ctx.Exit(func() interface{} { return ... })
	return &ast.DeferStmt{
		Call: &ast.CallExpr{
			Fun: &ast.SelectorExpr{
				X:   ast.NewIdent("__ft_ctx"),
				Sel: ast.NewIdent("Exit"),
			},
			Args: []ast.Expr{resultExpr},
		},
	}
}

// createRecoverDefer creates panic recovery defer statement
func (t *Transformer) createRecoverDefer(fn *ast.FuncDecl, info *FuncInfo) *ast.DeferStmt {
	// Create: defer func() { if r := recover(); r != nil { __ft_ctx.Exception(...); panic(r) } }()
	return &ast.DeferStmt{
		Call: &ast.CallExpr{
			Fun: &ast.FuncLit{
				Type: &ast.FuncType{},
				Body: &ast.BlockStmt{
					List: []ast.Stmt{
						&ast.IfStmt{
							Init: &ast.AssignStmt{
								Lhs: []ast.Expr{ast.NewIdent("r")},
								Tok: token.DEFINE,
								Rhs: []ast.Expr{
									&ast.CallExpr{
										Fun: ast.NewIdent("recover"),
									},
								},
							},
							Cond: &ast.BinaryExpr{
								X:  ast.NewIdent("r"),
								Op: token.NEQ,
								Y:  ast.NewIdent("nil"),
							},
							Body: &ast.BlockStmt{
								List: []ast.Stmt{
									&ast.ExprStmt{
										X: &ast.CallExpr{
											Fun: &ast.SelectorExpr{
												X:   ast.NewIdent("__ft_ctx"),
												Sel: ast.NewIdent("ExceptionString"),
											},
											Args: []ast.Expr{
												&ast.CallExpr{
													Fun: &ast.SelectorExpr{
														X:   ast.NewIdent("fmt"),
														Sel: ast.NewIdent("Sprintf"),
													},
													Args: []ast.Expr{
														&ast.BasicLit{Kind: token.STRING, Value: `"panic: %v"`},
														ast.NewIdent("r"),
													},
												},
											},
										},
									},
									&ast.ExprStmt{
										X: &ast.CallExpr{
											Fun:  ast.NewIdent("panic"),
											Args: []ast.Expr{ast.NewIdent("r")},
										},
									},
								},
							},
						},
					},
				},
			},
		},
	}
}

// transformReturns transforms all return statements to use named returns
func (t *Transformer) transformReturns(fn *ast.FuncDecl, info *FuncInfo) {
	if len(info.Results) == 0 {
		return
	}

	// Use a visitor to find and replace return statements in their parent context
	t.transformReturnsInBlock(fn.Body, info)
}

// transformReturnsInBlock recursively transforms return statements in a block
func (t *Transformer) transformReturnsInBlock(block *ast.BlockStmt, info *FuncInfo) {
	if block == nil {
		return
	}

	for i := 0; i < len(block.List); i++ {
		stmt := block.List[i]

		// Check if this is a return statement with results
		if ret, ok := stmt.(*ast.ReturnStmt); ok && len(ret.Results) > 0 {
			// Create assignment: __ft_ret0, __ft_ret1 = x, y
			assignment := &ast.AssignStmt{
				Tok: token.ASSIGN,
			}

			// Build LHS (named returns)
			for _, res := range info.Results {
				assignment.Lhs = append(assignment.Lhs, ast.NewIdent(res.Name))
			}

			// Use existing RHS from return
			assignment.Rhs = ret.Results

			// Clear return results (becomes bare return)
			ret.Results = nil

			// Insert assignment BEFORE return
			// Replace current statement with both assignment and return
			newStmts := []ast.Stmt{assignment, ret}
			block.List = append(block.List[:i], append(newStmts, block.List[i+1:]...)...)

			// Skip the newly inserted statements
			i++
			continue
		}

		// Recursively handle nested blocks
		switch s := stmt.(type) {
		case *ast.IfStmt:
			t.transformReturnsInBlock(s.Body, info)
			if s.Else != nil {
				if elseBlock, ok := s.Else.(*ast.BlockStmt); ok {
					t.transformReturnsInBlock(elseBlock, info)
				} else if elseIf, ok := s.Else.(*ast.IfStmt); ok {
					// Handle else-if: create a temporary block to process it
					tempBlock := &ast.BlockStmt{List: []ast.Stmt{elseIf}}
					t.transformReturnsInBlock(tempBlock, info)
				}
			}
		case *ast.ForStmt:
			t.transformReturnsInBlock(s.Body, info)
		case *ast.RangeStmt:
			t.transformReturnsInBlock(s.Body, info)
		case *ast.SwitchStmt:
			t.transformReturnsInBlock(s.Body, info)
		case *ast.TypeSwitchStmt:
			t.transformReturnsInBlock(s.Body, info)
		case *ast.SelectStmt:
			t.transformReturnsInBlock(s.Body, info)
		case *ast.CaseClause:
			t.transformReturnsInBlock(&ast.BlockStmt{List: s.Body}, info)
		case *ast.CommClause:
			t.transformReturnsInBlock(&ast.BlockStmt{List: s.Body}, info)
		}
	}
}

// ensureFlowtraceImport adds flowtrace import if not present
func (t *Transformer) ensureFlowtraceImport(file *ast.File) {
	// Check if flowtrace is already imported
	hasFlowtrace := false
	hasFmt := false

	for _, imp := range file.Imports {
		if imp.Path.Value == `"github.com/rixmerz/flowtrace-agent-go/flowtrace"` {
			hasFlowtrace = true
		}
		if imp.Path.Value == `"fmt"` {
			hasFmt = true
		}
	}

	// Add imports if needed
	if !hasFlowtrace {
		file.Imports = append(file.Imports, &ast.ImportSpec{
			Path: &ast.BasicLit{Kind: token.STRING, Value: `"github.com/rixmerz/flowtrace-agent-go/flowtrace"`},
		})
	}

	if !hasFmt {
		file.Imports = append(file.Imports, &ast.ImportSpec{
			Path: &ast.BasicLit{Kind: token.STRING, Value: `"fmt"`},
		})
	}

	// Update import declarations
	if len(file.Decls) > 0 {
		// Find or create import declaration
		var importDecl *ast.GenDecl
		for _, decl := range file.Decls {
			if gen, ok := decl.(*ast.GenDecl); ok && gen.Tok == token.IMPORT {
				importDecl = gen
				break
			}
		}

		if importDecl == nil {
			// Create new import declaration
			importDecl = &ast.GenDecl{
				Tok: token.IMPORT,
			}
			file.Decls = append([]ast.Decl{importDecl}, file.Decls...)
		}

		// Add import specs
		if !hasFlowtrace {
			importDecl.Specs = append(importDecl.Specs, &ast.ImportSpec{
				Path: &ast.BasicLit{Kind: token.STRING, Value: `"github.com/rixmerz/flowtrace-agent-go/flowtrace"`},
			})
		}
		if !hasFmt {
			importDecl.Specs = append(importDecl.Specs, &ast.ImportSpec{
				Path: &ast.BasicLit{Kind: token.STRING, Value: `"fmt"`},
			})
		}
	}
}

// ParseFile parses a Go source file
func ParseFile(filename string) (*token.FileSet, *ast.File, error) {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, filename, nil, parser.ParseComments)
	if err != nil {
		return nil, nil, err
	}
	return fset, file, nil
}

// ParseDir parses all Go files in a directory
func ParseDir(dir string) (*token.FileSet, map[string]*ast.File, error) {
	fset := token.NewFileSet()
	pkgs, err := parser.ParseDir(fset, dir, nil, parser.ParseComments)
	if err != nil {
		return nil, nil, err
	}

	files := make(map[string]*ast.File)
	for _, pkg := range pkgs {
		for name, file := range pkg.Files {
			files[name] = file
		}
	}

	return fset, files, nil
}
