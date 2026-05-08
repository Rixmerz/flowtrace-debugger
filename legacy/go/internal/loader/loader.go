package loader

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/ioutil"
	"os"
	"path/filepath"

	"golang.org/x/tools/go/packages"
)

// Loader handles loading Go packages and files
type Loader struct {
	fset   *token.FileSet
	config *LoadConfig
}

// LoadConfig holds loader configuration
type LoadConfig struct {
	// Directory to load packages from
	Dir string
	// Include test files
	Tests bool
	// Build tags
	Tags []string
	// Go module mode
	Mod string
}

// PackageInfo holds loaded package information
type PackageInfo struct {
	Package *packages.Package
	Files   []*FileInfo
}

// FileInfo holds file information
type FileInfo struct {
	Path     string
	AST      *ast.File
	IsTest   bool
	IsGenerated bool
}

// NewLoader creates a new package loader
func NewLoader(config *LoadConfig) *Loader {
	if config == nil {
		config = &LoadConfig{
			Dir:  ".",
			Mod:  "readonly",
		}
	}

	return &Loader{
		fset:   token.NewFileSet(),
		config: config,
	}
}

// FileSet returns the file set
func (l *Loader) FileSet() *token.FileSet {
	return l.fset
}

// LoadPackage loads a single package
func (l *Loader) LoadPackage(pkgPattern string) (*PackageInfo, error) {
	cfg := &packages.Config{
		Mode: packages.NeedName |
			packages.NeedFiles |
			packages.NeedCompiledGoFiles |
			packages.NeedImports |
			packages.NeedTypes |
			packages.NeedSyntax |
			packages.NeedTypesInfo,
		Dir:   l.config.Dir,
		Fset:  l.fset,
		Tests: l.config.Tests,
	}

	if len(l.config.Tags) > 0 {
		cfg.BuildFlags = []string{"-tags", joinTags(l.config.Tags)}
	}

	pkgs, err := packages.Load(cfg, pkgPattern)
	if err != nil {
		return nil, fmt.Errorf("failed to load package: %w", err)
	}

	if len(pkgs) == 0 {
		return nil, fmt.Errorf("no packages found for pattern: %s", pkgPattern)
	}

	pkg := pkgs[0]

	// Check for errors
	if len(pkg.Errors) > 0 {
		return nil, fmt.Errorf("package has errors: %v", pkg.Errors)
	}

	// Create package info
	info := &PackageInfo{
		Package: pkg,
		Files:   make([]*FileInfo, 0, len(pkg.Syntax)),
	}

	// Process files
	for i, file := range pkg.Syntax {
		filePath := pkg.CompiledGoFiles[i]

		fileInfo := &FileInfo{
			Path:        filePath,
			AST:         file,
			IsTest:      isTestFile(filePath),
			IsGenerated: isGeneratedFile(file),
		}

		info.Files = append(info.Files, fileInfo)
	}

	return info, nil
}

// LoadPackages loads multiple packages
func (l *Loader) LoadPackages(patterns ...string) ([]*PackageInfo, error) {
	result := make([]*PackageInfo, 0, len(patterns))

	for _, pattern := range patterns {
		info, err := l.LoadPackage(pattern)
		if err != nil {
			return nil, err
		}
		result = append(result, info)
	}

	return result, nil
}

// LoadFile loads a single Go file
func (l *Loader) LoadFile(filename string) (*FileInfo, error) {
	file, err := parser.ParseFile(l.fset, filename, nil, parser.ParseComments)
	if err != nil {
		return nil, fmt.Errorf("failed to parse file: %w", err)
	}

	return &FileInfo{
		Path:        filename,
		AST:         file,
		IsTest:      isTestFile(filename),
		IsGenerated: isGeneratedFile(file),
	}, nil
}

// LoadDirectory loads all Go files in a directory
func (l *Loader) LoadDirectory(dir string) ([]*FileInfo, error) {
	files, err := ioutil.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("failed to read directory: %w", err)
	}

	var result []*FileInfo

	for _, file := range files {
		if file.IsDir() {
			continue
		}

		if filepath.Ext(file.Name()) != ".go" {
			continue
		}

		// Skip test files if not configured
		if !l.config.Tests && isTestFile(file.Name()) {
			continue
		}

		filePath := filepath.Join(dir, file.Name())
		fileInfo, err := l.LoadFile(filePath)
		if err != nil {
			// Log warning but continue
			fmt.Printf("Warning: failed to load %s: %v\n", filePath, err)
			continue
		}

		result = append(result, fileInfo)
	}

	return result, nil
}

// LoadRecursive loads all Go files recursively from a directory
func (l *Loader) LoadRecursive(root string) ([]*FileInfo, error) {
	var result []*FileInfo

	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if info.IsDir() {
			// Skip vendor and hidden directories
			if info.Name() == "vendor" || info.Name() == ".git" || info.Name()[0] == '.' {
				return filepath.SkipDir
			}
			return nil
		}

		if filepath.Ext(path) != ".go" {
			return nil
		}

		// Skip test files if not configured
		if !l.config.Tests && isTestFile(path) {
			return nil
		}

		fileInfo, err := l.LoadFile(path)
		if err != nil {
			// Log warning but continue
			fmt.Printf("Warning: failed to load %s: %v\n", path, err)
			return nil
		}

		result = append(result, fileInfo)
		return nil
	})

	if err != nil {
		return nil, err
	}

	return result, nil
}

// WriteFile writes an AST file to disk
func (l *Loader) WriteFile(file *ast.File, outputPath string) error {
	// Create output directory if needed
	dir := filepath.Dir(outputPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create directory: %w", err)
	}

	// Create output file
	f, err := os.Create(outputPath)
	if err != nil {
		return fmt.Errorf("failed to create file: %w", err)
	}
	defer f.Close()

	// Format and write
	if err := formatAST(l.fset, file, f); err != nil {
		return fmt.Errorf("failed to format file: %w", err)
	}

	return nil
}

// isTestFile checks if a filename is a test file
func isTestFile(filename string) bool {
	return len(filename) > 8 && filename[len(filename)-8:] == "_test.go"
}

// isGeneratedFile checks if a file is generated
func isGeneratedFile(file *ast.File) bool {
	for _, comment := range file.Comments {
		for _, c := range comment.List {
			if len(c.Text) > 17 && c.Text[:17] == "// Code generated" {
				return true
			}
		}
	}
	return false
}

// joinTags joins build tags
func joinTags(tags []string) string {
	result := ""
	for i, tag := range tags {
		if i > 0 {
			result += ","
		}
		result += tag
	}
	return result
}
