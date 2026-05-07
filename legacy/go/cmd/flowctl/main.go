package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var (
	version = "1.0.0"
	commit  = "dev"
)

func main() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

var rootCmd = &cobra.Command{
	Use:   "flowctl",
	Short: "FlowTrace control tool for Go applications",
	Long: `flowctl is the command-line tool for FlowTrace Go agent.

It provides automatic code instrumentation, build integration, and tracing management
for Go applications.

Examples:
  # Instrument current package
  flowctl instrument ./...

  # Build with instrumentation
  flowctl build ./cmd/myapp

  # Run with instrumentation
  flowctl run main.go

  # Test with instrumentation
  flowctl test ./...`,
	Version: version,
}

func init() {
	// Global flags
	rootCmd.PersistentFlags().BoolP("verbose", "v", false, "verbose output")
	rootCmd.PersistentFlags().BoolP("debug", "d", false, "debug mode")
	rootCmd.PersistentFlags().StringP("config", "c", ".flowtrace.yaml", "config file")

	// Add subcommands
	rootCmd.AddCommand(instrumentCmd)
	rootCmd.AddCommand(buildCmd)
	rootCmd.AddCommand(runCmd)
	rootCmd.AddCommand(testCmd)
	rootCmd.AddCommand(versionCmd)
	rootCmd.AddCommand(initCmd)
}

var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Print version information",
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Printf("flowctl version %s (%s)\n", version, commit)
	},
}
