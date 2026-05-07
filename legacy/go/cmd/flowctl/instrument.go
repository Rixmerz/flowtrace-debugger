package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/rixmerz/flowtrace-agent-go/internal/ast"
	"github.com/rixmerz/flowtrace-agent-go/internal/filter"
	"github.com/rixmerz/flowtrace-agent-go/internal/loader"
	"github.com/spf13/cobra"
)

var instrumentCmd = &cobra.Command{
	Use:   "instrument [packages...]",
	Short: "Instrument Go packages with FlowTrace",
	Long: `Instrument Go code with automatic tracing.

This command transforms Go source code by injecting FlowTrace instrumentation
calls at function entry and exit points.

Examples:
  # Instrument current package
  flowctl instrument .

  # Instrument all packages recursively
  flowctl instrument ./...

  # Instrument specific package
  flowctl instrument ./cmd/myapp

  # Instrument with custom output directory
  flowctl instrument --output ./instrumented ./...

  # Instrument with exclusion patterns
  flowctl instrument --exclude "**/*_test.go" --exclude "**/vendor/**" ./...`,
	Args: cobra.MinimumNArgs(1),
	RunE: runInstrument,
}

var (
	instrumentOutput  string
	instrumentInPlace bool
	instrumentExclude []string
	instrumentInclude []string
	instrumentTests   bool
)

func init() {
	instrumentCmd.Flags().StringVarP(&instrumentOutput, "output", "o", "", "output directory for instrumented files")
	instrumentCmd.Flags().BoolVarP(&instrumentInPlace, "in-place", "i", false, "modify files in place")
	instrumentCmd.Flags().StringSliceVarP(&instrumentExclude, "exclude", "e", nil, "exclude patterns (glob)")
	instrumentCmd.Flags().StringSliceVar(&instrumentInclude, "include", nil, "include patterns (glob)")
	instrumentCmd.Flags().BoolVarP(&instrumentTests, "tests", "t", false, "instrument test files")
}

func runInstrument(cmd *cobra.Command, args []string) error {
	verbose, _ := cmd.Flags().GetBool("verbose")
	debug, _ := cmd.Flags().GetBool("debug")

	if verbose {
		fmt.Println("🔧 FlowTrace Go Instrumentor")
		fmt.Printf("📦 Packages: %v\n", args)
	}

	// Validate flags
	if instrumentInPlace && instrumentOutput != "" {
		return fmt.Errorf("cannot use --in-place and --output together")
	}

	if !instrumentInPlace && instrumentOutput == "" {
		return fmt.Errorf("must specify either --in-place or --output")
	}

	// Setup filter
	excludePatterns := instrumentExclude
	if len(excludePatterns) == 0 {
		// Use default exclude patterns
		excludePatterns = filter.DefaultExcludePatterns()
	}

	pkgFilter := filter.NewFilter(instrumentInclude, excludePatterns)

	// Setup loader
	loaderConfig := &loader.LoadConfig{
		Dir:   ".",
		Tests: instrumentTests,
	}
	pkgLoader := loader.NewLoader(loaderConfig)

	// Process each package pattern
	for _, pattern := range args {
		if verbose {
			fmt.Printf("\n📂 Processing pattern: %s\n", pattern)
		}

		// Expand pattern
		pkgs, err := expandPattern(pattern)
		if err != nil {
			return fmt.Errorf("failed to expand pattern %s: %w", pattern, err)
		}

		for _, pkg := range pkgs {
			// Check filter
			if !pkgFilter.ShouldInstrumentPackage(pkg) {
				if debug {
					fmt.Printf("   ⏭️  Skipping excluded package: %s\n", pkg)
				}
				continue
			}

			if verbose {
				fmt.Printf("   🔍 Loading package: %s\n", pkg)
			}

			// Load package
			pkgInfo, err := pkgLoader.LoadPackage(pkg)
			if err != nil {
				fmt.Fprintf(os.Stderr, "   ⚠️  Warning: failed to load %s: %v\n", pkg, err)
				continue
			}

			// Instrument files
			for _, fileInfo := range pkgInfo.Files {
				// Skip if filtered
				if !pkgFilter.ShouldInstrumentFile(fileInfo.Path) {
					if debug {
						fmt.Printf("      ⏭️  Skipping: %s\n", fileInfo.Path)
					}
					continue
				}

				// Skip generated files
				if fileInfo.IsGenerated {
					if debug {
						fmt.Printf("      ⏭️  Skipping generated: %s\n", fileInfo.Path)
					}
					continue
				}

				if verbose {
					fmt.Printf("      ⚙️  Instrumenting: %s\n", fileInfo.Path)
				}

				// Create transformer
				transformerConfig := &ast.Config{
					Include:         instrumentInclude,
					Exclude:         excludePatterns,
					InstrumentTests: instrumentTests,
				}
				transformer := ast.NewTransformer(pkgLoader.FileSet(), transformerConfig)

				// Transform file
				if err := transformer.TransformFile(fileInfo.AST); err != nil {
					return fmt.Errorf("failed to transform %s: %w", fileInfo.Path, err)
				}

				// Determine output path
				outputPath := fileInfo.Path
				if instrumentOutput != "" {
					// Calculate relative path
					relPath, err := filepath.Rel(".", fileInfo.Path)
					if err != nil {
						relPath = fileInfo.Path
					}
					outputPath = filepath.Join(instrumentOutput, relPath)
				}

				// Write instrumented file
				if err := pkgLoader.WriteFile(fileInfo.AST, outputPath); err != nil {
					return fmt.Errorf("failed to write %s: %w", outputPath, err)
				}

				if verbose {
					fmt.Printf("      ✅ Written: %s\n", outputPath)
				}
			}
		}
	}

	if verbose {
		fmt.Println("\n✨ Instrumentation complete!")
	}

	return nil
}

// expandPattern expands a package pattern to a list of packages
func expandPattern(pattern string) ([]string, error) {
	// Handle special patterns
	if pattern == "." {
		return []string{"."}, nil
	}

	if pattern == "./..." {
		// Get all packages recursively
		return getRecursivePackages(".")
	}

	// Handle patterns like ./cmd/...
	if len(pattern) > 4 && pattern[len(pattern)-4:] == "/..." {
		dir := pattern[:len(pattern)-4]
		return getRecursivePackages(dir)
	}

	// Single package
	return []string{pattern}, nil
}

// getRecursivePackages gets all packages recursively from a directory
func getRecursivePackages(root string) ([]string, error) {
	var packages []string

	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if !info.IsDir() {
			return nil
		}

		// Skip vendor and hidden directories
		if info.Name() == "vendor" || info.Name() == ".git" || (len(info.Name()) > 0 && info.Name()[0] == '.') {
			return filepath.SkipDir
		}

		// Check if directory contains Go files
		hasGoFiles, err := hasGoFiles(path)
		if err != nil {
			return err
		}

		if hasGoFiles {
			packages = append(packages, path)
		}

		return nil
	})

	if err != nil {
		return nil, err
	}

	return packages, nil
}

// hasGoFiles checks if a directory contains Go files
func hasGoFiles(dir string) (bool, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false, err
	}

	for _, entry := range entries {
		if !entry.IsDir() && filepath.Ext(entry.Name()) == ".go" {
			return true, nil
		}
	}

	return false, nil
}
