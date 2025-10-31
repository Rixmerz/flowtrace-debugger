package ast

import (
	"fmt"
	"go/ast"
	"go/token"
)

// Rewriter handles complex AST rewriting operations
type Rewriter struct {
	fset *token.FileSet
}

// NewRewriter creates a new rewriter
func NewRewriter(fset *token.FileSet) *Rewriter {
	return &Rewriter{fset: fset}
}

// RewriteReturnStatements rewrites return statements to use named returns
func (r *Rewriter) RewriteReturnStatements(fn *ast.FuncDecl, info *FuncInfo) {
	if len(info.Results) == 0 {
		return
	}

	// We need to track the parent statement to insert assignments
	// This requires a more sophisticated visitor pattern

	// Create a map to track statements that need to be replaced
	replacements := make(map[*ast.ReturnStmt]*ast.BlockStmt)

	// Find all return statements
	ast.Inspect(fn.Body, func(n ast.Node) bool {
		if ret, ok := n.(*ast.ReturnStmt); ok {
			if len(ret.Results) > 0 {
				// Create assignment statement
				assignment := r.createReturnAssignment(ret, info)

				// Create new block with assignment + naked return
				block := &ast.BlockStmt{
					List: []ast.Stmt{
						assignment,
						&ast.ReturnStmt{}, // Naked return
					},
				}

				replacements[ret] = block
			}
			return false
		}
		return true
	})

	// Apply replacements
	// This is complex because we need to replace in parent blocks
	r.applyReturnReplacements(fn.Body, replacements)
}

// createReturnAssignment creates an assignment for return values
func (r *Rewriter) createReturnAssignment(ret *ast.ReturnStmt, info *FuncInfo) *ast.AssignStmt {
	assignment := &ast.AssignStmt{
		Tok: token.ASSIGN,
	}

	// Build LHS (named returns)
	for _, res := range info.Results {
		assignment.Lhs = append(assignment.Lhs, ast.NewIdent(res.Name))
	}

	// Use existing RHS
	assignment.Rhs = ret.Results

	return assignment
}

// applyReturnReplacements applies return statement replacements
func (r *Rewriter) applyReturnReplacements(body *ast.BlockStmt, replacements map[*ast.ReturnStmt]*ast.BlockStmt) {
	// Walk through statements and replace
	for i, stmt := range body.List {
		switch s := stmt.(type) {
		case *ast.ReturnStmt:
			// Direct return in this block
			if block, ok := replacements[s]; ok {
				// Replace with assignment + naked return
				body.List = r.insertStatementsAt(body.List, i, block.List)
			}

		case *ast.IfStmt:
			// Check if and else blocks
			if s.Body != nil {
				r.applyReturnReplacements(s.Body, replacements)
			}
			if s.Else != nil {
				if elseBlock, ok := s.Else.(*ast.BlockStmt); ok {
					r.applyReturnReplacements(elseBlock, replacements)
				} else if elseIf, ok := s.Else.(*ast.IfStmt); ok {
					// Nested if-else
					if elseIf.Body != nil {
						r.applyReturnReplacements(elseIf.Body, replacements)
					}
				}
			}

		case *ast.ForStmt:
			if s.Body != nil {
				r.applyReturnReplacements(s.Body, replacements)
			}

		case *ast.RangeStmt:
			if s.Body != nil {
				r.applyReturnReplacements(s.Body, replacements)
			}

		case *ast.SwitchStmt:
			if s.Body != nil {
				for _, clause := range s.Body.List {
					if caseClause, ok := clause.(*ast.CaseClause); ok {
						caseBlock := &ast.BlockStmt{List: caseClause.Body}
						r.applyReturnReplacements(caseBlock, replacements)
						caseClause.Body = caseBlock.List
					}
				}
			}

		case *ast.TypeSwitchStmt:
			if s.Body != nil {
				for _, clause := range s.Body.List {
					if caseClause, ok := clause.(*ast.CaseClause); ok {
						caseBlock := &ast.BlockStmt{List: caseClause.Body}
						r.applyReturnReplacements(caseBlock, replacements)
						caseClause.Body = caseBlock.List
					}
				}
			}

		case *ast.SelectStmt:
			if s.Body != nil {
				for _, clause := range s.Body.List {
					if commClause, ok := clause.(*ast.CommClause); ok {
						commBlock := &ast.BlockStmt{List: commClause.Body}
						r.applyReturnReplacements(commBlock, replacements)
						commClause.Body = commBlock.List
					}
				}
			}

		case *ast.BlockStmt:
			r.applyReturnReplacements(s, replacements)
		}
	}
}

// insertStatementsAt inserts statements at a specific index
func (r *Rewriter) insertStatementsAt(stmts []ast.Stmt, index int, toInsert []ast.Stmt) []ast.Stmt {
	// Remove the return statement and insert new statements
	result := make([]ast.Stmt, 0, len(stmts)+len(toInsert)-1)
	result = append(result, stmts[:index]...)
	result = append(result, toInsert...)
	result = append(result, stmts[index+1:]...)
	return result
}

// AddDeferStatements adds defer statements at the beginning of a function
func (r *Rewriter) AddDeferStatements(fn *ast.FuncDecl, defers []*ast.DeferStmt) {
	if fn.Body == nil {
		return
	}

	// Insert defer statements at the beginning
	newStmts := make([]ast.Stmt, 0, len(fn.Body.List)+len(defers))
	for _, d := range defers {
		newStmts = append(newStmts, d)
	}
	newStmts = append(newStmts, fn.Body.List...)
	fn.Body.List = newStmts
}

// WrapFunctionBody wraps the entire function body in a block
func (r *Rewriter) WrapFunctionBody(fn *ast.FuncDecl, prefix []ast.Stmt) {
	if fn.Body == nil {
		return
	}

	// Create new body with prefix + original body
	newStmts := make([]ast.Stmt, 0, len(prefix)+len(fn.Body.List))
	newStmts = append(newStmts, prefix...)
	newStmts = append(newStmts, fn.Body.List...)
	fn.Body.List = newStmts
}

// RenameVariable renames all occurrences of a variable in a function
func (r *Rewriter) RenameVariable(fn *ast.FuncDecl, oldName, newName string) {
	ast.Inspect(fn, func(n ast.Node) bool {
		if ident, ok := n.(*ast.Ident); ok {
			if ident.Name == oldName {
				ident.Name = newName
			}
		}
		return true
	})
}

// InjectStatementBefore injects a statement before a specific node
func (r *Rewriter) InjectStatementBefore(body *ast.BlockStmt, target ast.Stmt, toInject ast.Stmt) bool {
	for i, stmt := range body.List {
		if stmt == target {
			body.List = r.insertStatementsAt(body.List, i, []ast.Stmt{toInject})
			return true
		}
	}
	return false
}

// InjectStatementAfter injects a statement after a specific node
func (r *Rewriter) InjectStatementAfter(body *ast.BlockStmt, target ast.Stmt, toInject ast.Stmt) bool {
	for i, stmt := range body.List {
		if stmt == target {
			body.List = r.insertStatementsAt(body.List, i+1, []ast.Stmt{toInject})
			return true
		}
	}
	return false
}

// RemoveStatement removes a statement from a block
func (r *Rewriter) RemoveStatement(body *ast.BlockStmt, target ast.Stmt) bool {
	for i, stmt := range body.List {
		if stmt == target {
			body.List = append(body.List[:i], body.List[i+1:]...)
			return true
		}
	}
	return false
}

// CloneNode creates a deep copy of an AST node
func (r *Rewriter) CloneNode(node ast.Node) ast.Node {
	// This is a simplified clone - for production use ast.Walk with custom visitor
	switch n := node.(type) {
	case *ast.Ident:
		return &ast.Ident{Name: n.Name}
	case *ast.BasicLit:
		return &ast.BasicLit{Kind: n.Kind, Value: n.Value}
	// Add more cases as needed
	default:
		return node
	}
}

// GenerateUniqueIdentifier generates a unique identifier name
func (r *Rewriter) GenerateUniqueIdentifier(base string, existing map[string]bool) string {
	if !existing[base] {
		return base
	}

	counter := 1
	for {
		name := fmt.Sprintf("%s_%d", base, counter)
		if !existing[name] {
			return name
		}
		counter++
	}
}

// CollectIdentifiers collects all identifiers in a function
func (r *Rewriter) CollectIdentifiers(fn *ast.FuncDecl) map[string]bool {
	identifiers := make(map[string]bool)

	ast.Inspect(fn, func(n ast.Node) bool {
		if ident, ok := n.(*ast.Ident); ok {
			identifiers[ident.Name] = true
		}
		return true
	})

	return identifiers
}
