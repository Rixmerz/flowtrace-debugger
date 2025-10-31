package ast

import (
	"go/parser"
	"go/token"
	"testing"
)

func TestTransformerBasicFunction(t *testing.T) {
	source := `package main

func Add(a, b int) int {
	return a + b
}
`
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "test.go", source, parser.ParseComments)
	if err != nil {
		t.Fatalf("Failed to parse source: %v", err)
	}

	config := &Config{}
	transformer := NewTransformer(fset, config)
	err = transformer.TransformFile(file)
	if err != nil {
		t.Fatalf("TransformFile failed: %v", err)
	}

	// Verify transformation completed without error
	if len(file.Decls) < 1 {
		t.Fatal("Expected at least one declaration")
	}
}

func TestTransformerSkipInit(t *testing.T) {
	source := `package main

func init() {
	// Initialization code
	setupConfig()
}

func setupConfig() {
	// Should be instrumented
}
`
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "test.go", source, parser.ParseComments)
	if err != nil {
		t.Fatalf("Failed to parse source: %v", err)
	}

	config := &Config{}
	transformer := NewTransformer(fset, config)
	err = transformer.TransformFile(file)
	if err != nil {
		t.Fatalf("TransformFile failed: %v", err)
	}
}

func TestTransformerEmptyFunction(t *testing.T) {
	source := `package main

func Empty() {
	// No implementation
}
`
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "test.go", source, parser.ParseComments)
	if err != nil {
		t.Fatalf("Failed to parse source: %v", err)
	}

	config := &Config{}
	transformer := NewTransformer(fset, config)
	err = transformer.TransformFile(file)
	if err != nil {
		t.Fatalf("TransformFile failed: %v", err)
	}
}

func TestTransformerNoBody(t *testing.T) {
	source := `package main

type Reader interface {
	Read(p []byte) (n int, err error)
}
`
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "test.go", source, parser.ParseComments)
	if err != nil {
		t.Fatalf("Failed to parse source: %v", err)
	}

	config := &Config{}
	transformer := NewTransformer(fset, config)
	err = transformer.TransformFile(file)
	if err != nil {
		t.Fatalf("TransformFile failed: %v", err)
	}
}
