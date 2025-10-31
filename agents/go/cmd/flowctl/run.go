package main

import (
	"fmt"
	"io/ioutil"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/spf13/cobra"
)

var runCmd = &cobra.Command{
	Use:   "run [flags] [file.go]",
	Short: "Run Go program with automatic instrumentation",
	Long: `Run a Go program with automatic FlowTrace instrumentation.

This command instruments the code, then runs it with 'go run'.
The original source code is not modified.

Examples:
  # Run main.go
  flowctl run main.go

  # Run with arguments
  flowctl run main.go --arg1 value1

  # Run with environment variables
  FLOWTRACE_LOGFILE=trace.jsonl flowctl run main.go`,
	Args: cobra.MinimumNArgs(1),
	RunE: runRun,
}

func runRun(cmd *cobra.Command, args []string) error {
	verbose, _ := cmd.Flags().GetBool("verbose")

	if verbose {
		fmt.Println("🏃 FlowTrace Run")
	}

	mainFile := args[0]
	programArgs := args[1:]

	// Create temporary directory for instrumented code
	tempDir, err := ioutil.TempDir("", "flowtrace-run-*")
	if err != nil {
		return fmt.Errorf("failed to create temp directory: %w", err)
	}
	defer os.RemoveAll(tempDir)

	if verbose {
		fmt.Printf("📁 Temp directory: %s\n", tempDir)
	}

	// Get directory containing main file
	mainDir := filepath.Dir(mainFile)
	if mainDir == "." {
		mainDir, _ = os.Getwd()
	} else {
		mainDir, _ = filepath.Abs(mainDir)
	}

	// Instrument the package
	if verbose {
		fmt.Println("⚙️  Instrumenting code...")
	}

	instrumentArgs := []string{
		"instrument",
		"--output", tempDir,
		"--exclude", "**/*_test.go",
		"--exclude", "**/vendor/**",
		mainDir,
	}

	instrumentCmd := exec.Command("flowctl", instrumentArgs...)
	instrumentCmd.Stdout = os.Stdout
	instrumentCmd.Stderr = os.Stderr

	if err := instrumentCmd.Run(); err != nil {
		return fmt.Errorf("instrumentation failed: %w", err)
	}

	// Run instrumented code
	if verbose {
		fmt.Println("🏃 Running instrumented code...")
	}

	// Calculate instrumented file path
	relPath, _ := filepath.Rel(mainDir, mainFile)
	instrumentedFile := filepath.Join(tempDir, filepath.Base(mainDir), relPath)

	// Prepare go run command
	runArgs := []string{"run", instrumentedFile}
	runArgs = append(runArgs, programArgs...)

	// Run go run
	goRun := exec.Command("go", runArgs...)
	goRun.Stdout = os.Stdout
	goRun.Stderr = os.Stderr
	goRun.Stdin = os.Stdin
	goRun.Env = os.Environ()

	if err := goRun.Run(); err != nil {
		return fmt.Errorf("run failed: %w", err)
	}

	return nil
}
