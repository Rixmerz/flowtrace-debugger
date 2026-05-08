package main

import (
	"fmt"
	"io/ioutil"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
)

var buildCmd = &cobra.Command{
	Use:   "build [flags] [packages]",
	Short: "Build Go packages with automatic instrumentation",
	Long: `Build Go packages with automatic FlowTrace instrumentation.

This command instruments the code, then runs 'go build' on the instrumented version.
The original source code is not modified.

Examples:
  # Build current package
  flowctl build

  # Build specific package
  flowctl build ./cmd/myapp

  # Build with output file
  flowctl build -o myapp ./cmd/myapp

  # Pass flags to go build
  flowctl build -tags prod ./...`,
	RunE: runBuild,
}

var (
	buildOutput string
	buildTags   []string
)

func init() {
	buildCmd.Flags().StringVarP(&buildOutput, "output", "o", "", "output file name")
	buildCmd.Flags().StringSliceVar(&buildTags, "tags", nil, "build tags")
}

func runBuild(cmd *cobra.Command, args []string) error {
	verbose, _ := cmd.Flags().GetBool("verbose")

	if verbose {
		fmt.Println("🔨 FlowTrace Build")
	}

	// Default to current package
	if len(args) == 0 {
		args = []string{"."}
	}

	// Create temporary directory for instrumented code
	tempDir, err := ioutil.TempDir("", "flowtrace-build-*")
	if err != nil {
		return fmt.Errorf("failed to create temp directory: %w", err)
	}
	defer os.RemoveAll(tempDir)

	if verbose {
		fmt.Printf("📁 Temp directory: %s\n", tempDir)
	}

	// Instrument code to temp directory
	if verbose {
		fmt.Println("⚙️  Instrumenting code...")
	}

	instrumentArgs := []string{
		"instrument",
		"--output", tempDir,
	}

	// Add exclude patterns
	instrumentArgs = append(instrumentArgs,
		"--exclude", "**/*_test.go",
		"--exclude", "**/vendor/**",
	)

	// Add packages
	instrumentArgs = append(instrumentArgs, args...)

	// Run instrument command
	instrumentCmd := exec.Command("flowctl", instrumentArgs...)
	instrumentCmd.Stdout = os.Stdout
	instrumentCmd.Stderr = os.Stderr

	if err := instrumentCmd.Run(); err != nil {
		return fmt.Errorf("instrumentation failed: %w", err)
	}

	// Build instrumented code
	if verbose {
		fmt.Println("🔨 Building instrumented code...")
	}

	buildArgs := []string{"build"}

	// Add output flag
	if buildOutput != "" {
		buildArgs = append(buildArgs, "-o", buildOutput)
	}

	// Add tags
	if len(buildTags) > 0 {
		buildArgs = append(buildArgs, "-tags", strings.Join(buildTags, ","))
	}

	// Calculate package paths in temp directory
	for _, arg := range args {
		if arg == "." {
			buildArgs = append(buildArgs, tempDir)
		} else {
			// Convert relative path to temp directory path
			relPath := strings.TrimPrefix(arg, "./")
			buildArgs = append(buildArgs, filepath.Join(tempDir, relPath))
		}
	}

	// Run go build
	goBuild := exec.Command("go", buildArgs...)
	goBuild.Stdout = os.Stdout
	goBuild.Stderr = os.Stderr
	goBuild.Dir = tempDir

	if err := goBuild.Run(); err != nil {
		return fmt.Errorf("build failed: %w", err)
	}

	if verbose {
		fmt.Println("✅ Build complete!")
	}

	return nil
}
