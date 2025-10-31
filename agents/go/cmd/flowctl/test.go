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

var testCmd = &cobra.Command{
	Use:   "test [flags] [packages]",
	Short: "Test Go packages with automatic instrumentation",
	Long: `Test Go packages with automatic FlowTrace instrumentation.

This command instruments the code (including test files), then runs 'go test'.
The original source code is not modified.

Examples:
  # Test current package
  flowctl test

  # Test all packages recursively
  flowctl test ./...

  # Test with coverage
  flowctl test -cover ./...

  # Run specific test
  flowctl test -run TestMyFunction ./...`,
	RunE: runTest,
}

var (
	testCover   bool
	testVerbose bool
	testRun     string
)

func init() {
	testCmd.Flags().BoolVar(&testCover, "cover", false, "enable coverage analysis")
	testCmd.Flags().BoolVar(&testVerbose, "test.v", false, "verbose test output")
	testCmd.Flags().StringVar(&testRun, "run", "", "run only tests matching regexp")
}

func runTest(cmd *cobra.Command, args []string) error {
	verbose, _ := cmd.Flags().GetBool("verbose")

	if verbose {
		fmt.Println("🧪 FlowTrace Test")
	}

	// Default to current package
	if len(args) == 0 {
		args = []string{"."}
	}

	// Create temporary directory for instrumented code
	tempDir, err := ioutil.TempDir("", "flowtrace-test-*")
	if err != nil {
		return fmt.Errorf("failed to create temp directory: %w", err)
	}
	defer os.RemoveAll(tempDir)

	if verbose {
		fmt.Printf("📁 Temp directory: %s\n", tempDir)
	}

	// Instrument code to temp directory (including tests)
	if verbose {
		fmt.Println("⚙️  Instrumenting code and tests...")
	}

	instrumentArgs := []string{
		"instrument",
		"--output", tempDir,
		"--tests", // Include test files
		"--exclude", "**/vendor/**",
	}

	// Add packages
	instrumentArgs = append(instrumentArgs, args...)

	// Run instrument command
	instrumentCmd := exec.Command("flowctl", instrumentArgs...)
	instrumentCmd.Stdout = os.Stdout
	instrumentCmd.Stderr = os.Stderr

	if err := instrumentCmd.Run(); err != nil {
		return fmt.Errorf("instrumentation failed: %w", err)
	}

	// Run tests on instrumented code
	if verbose {
		fmt.Println("🧪 Running tests on instrumented code...")
	}

	testArgs := []string{"test"}

	// Add coverage flag
	if testCover {
		testArgs = append(testArgs, "-cover")
	}

	// Add verbose flag
	if testVerbose {
		testArgs = append(testArgs, "-v")
	}

	// Add run pattern
	if testRun != "" {
		testArgs = append(testArgs, "-run", testRun)
	}

	// Calculate package paths in temp directory
	for _, arg := range args {
		if arg == "." {
			testArgs = append(testArgs, tempDir)
		} else if arg == "./..." {
			testArgs = append(testArgs, filepath.Join(tempDir, "..."))
		} else {
			// Convert relative path to temp directory path
			relPath := strings.TrimPrefix(arg, "./")
			testArgs = append(testArgs, filepath.Join(tempDir, relPath))
		}
	}

	// Run go test
	goTest := exec.Command("go", testArgs...)
	goTest.Stdout = os.Stdout
	goTest.Stderr = os.Stderr
	goTest.Dir = tempDir

	if err := goTest.Run(); err != nil {
		// Tests may fail, but we still want to show the output
		if verbose {
			fmt.Println("⚠️  Tests completed with failures")
		}
		return err
	}

	if verbose {
		fmt.Println("✅ All tests passed!")
	}

	return nil
}
