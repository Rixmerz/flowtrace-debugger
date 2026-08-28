package transform

import (
	"fmt"
	"go/ast"
	"go/token"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// receiverClass extracts the receiver's type name for a method: the pointer
// is stripped ((c *Calc) -> Calc) and so are any type-parameter brackets
// ((r *Repo[T]) -> Repo). A plain function (no receiver) yields "".
// An unnamed receiver (func (*Calc) M()) still yields a class - class comes
// from the type expression, not from the receiver's identifier.
func receiverClass(fd *ast.FuncDecl) string {
	if fd.Recv == nil || len(fd.Recv.List) == 0 {
		return ""
	}
	return typeName(fd.Recv.List[0].Type)
}

func typeName(expr ast.Expr) string {
	switch t := expr.(type) {
	case *ast.StarExpr:
		return typeName(t.X)
	case *ast.IndexExpr: // generic type with one type argument: Repo[T]
		return typeName(t.X)
	case *ast.IndexListExpr: // generic type with multiple type arguments: Repo[K, V]
		return typeName(t.X)
	case *ast.Ident:
		return t.Name
	default:
		return ""
	}
}

// visibility follows Go's own export rule: a leading uppercase letter in the
// method name. Go has no third case, so callers never see anything but
// "public" or "private".
func visibility(name string) string {
	r, _ := utf8.DecodeRuneInString(name)
	if unicode.IsUpper(r) {
		return "public"
	}
	return "private"
}

// collectIdents gathers every identifier name that appears anywhere in fd -
// receiver, type params, parameters, named results, and the body. It is a
// deliberate over-approximation (it also picks up selector/field names that
// are never local bindings) because the only cost of treating too many names
// as "taken" is a slightly longer generated name, never a collision.
func collectIdents(fd *ast.FuncDecl) map[string]struct{} {
	used := make(map[string]struct{})
	ast.Inspect(fd, func(n ast.Node) bool {
		if id, ok := n.(*ast.Ident); ok {
			used[id.Name] = struct{}{}
		}
		return true
	})
	return used
}

// uniqueName returns base if it is not already in used, else the first
// base_2, base_3, ... that is free. Either way the chosen name is added to
// used before it is returned, so a later call never collides with an
// earlier one from the same scan.
func uniqueName(base string, used map[string]struct{}) string {
	if _, ok := used[base]; !ok {
		used[base] = struct{}{}
		return base
	}
	for i := 2; ; i++ {
		cand := fmt.Sprintf("%s_%d", base, i)
		if _, ok := used[cand]; !ok {
			used[cand] = struct{}{}
			return cand
		}
	}
}

// paramArgsText builds the `"name", name, "other", other` fragment passed to
// Enter for a function's parameters, in declaration order. Blank parameters
// (_) are unreadable and are skipped; a variadic parameter is just another
// named identifier here (inside the body it already denotes the slice), so
// it needs no special case.
func paramArgsText(fd *ast.FuncDecl) string {
	if fd.Type.Params == nil {
		return ""
	}
	var parts []string
	for _, field := range fd.Type.Params.List {
		for _, name := range field.Names {
			if name.Name == "_" {
				continue
			}
			parts = append(parts, strconv.Quote(name.Name)+", "+name.Name)
		}
	}
	return strings.Join(parts, ", ")
}

// instrumentResults decides the final name for every result value - reusing
// an existing name, renaming a blank _, or generating one for an unnamed
// result - and returns the edits needed to make the signature match. Go
// requires results to be either all-named or all-unnamed (never mixed), so
// there are exactly two shapes to handle.
func instrumentResults(fset *token.FileSet, fd *ast.FuncDecl, used map[string]struct{}) ([]string, []edit) {
	res := fd.Type.Results
	if res == nil {
		return nil, nil
	}

	anyNamed := len(res.List) > 0 && len(res.List[0].Names) > 0

	var names []string
	var edits []edit

	if anyNamed {
		for _, field := range res.List {
			for _, name := range field.Names {
				if name.Name != "_" {
					names = append(names, name.Name)
					continue
				}
				newName := uniqueName(fmt.Sprintf("_ft_r%d", len(names)), used)
				edits = append(edits, edit{
					start: fset.Position(name.Pos()).Offset,
					end:   fset.Position(name.End()).Offset,
					text:  newName,
				})
				names = append(names, newName)
			}
		}
		return names, edits
	}

	// Unnamed results: a single unnamed result may have no parens at all
	// (func F() error); naming it requires synthesising them.
	needsParens := !res.Opening.IsValid()
	for i, field := range res.List {
		newName := uniqueName(fmt.Sprintf("_ft_r%d", i), used)
		names = append(names, newName)

		prefix := newName + " "
		if needsParens && i == 0 {
			prefix = "(" + prefix
		}
		typeStart := fset.Position(field.Type.Pos()).Offset
		edits = append(edits, edit{start: typeStart, end: typeStart, text: prefix})
	}
	if needsParens {
		last := res.List[len(res.List)-1]
		endPos := fset.Position(last.Type.End()).Offset
		edits = append(edits, edit{start: endPos, end: endPos, text: ")"})
	}
	return names, edits
}
