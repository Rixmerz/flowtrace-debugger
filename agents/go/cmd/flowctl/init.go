package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
	"gopkg.in/yaml.v3"
)

var initCmd = &cobra.Command{
	Use:   "init",
	Short: "Initialize FlowTrace configuration",
	Long: `Initialize a FlowTrace configuration file in the current directory.

This creates a .flowtrace.yaml file with default settings that you can customize.

Example:
  flowctl init`,
	RunE: runInit,
}

var (
	initForce bool
)

func init() {
	initCmd.Flags().BoolVarP(&initForce, "force", "f", false, "overwrite existing config")
}

func runInit(cmd *cobra.Command, args []string) error {
	verbose, _ := cmd.Flags().GetBool("verbose")

	configPath := ".flowtrace.yaml"

	// Check if config already exists
	if _, err := os.Stat(configPath); err == nil && !initForce {
		return fmt.Errorf("config file already exists (use --force to overwrite)")
	}

	if verbose {
		fmt.Println("📝 Creating FlowTrace configuration...")
	}

	// Get current directory name for package prefix suggestion
	cwd, _ := os.Getwd()
	dirName := filepath.Base(cwd)

	// Create default config
	config := DefaultConfig{
		Version: "1",
		Output: OutputConfig{
			File:   "flowtrace.jsonl",
			Stdout: false,
			Format: "jsonl",
		},
		Include: []string{
			fmt.Sprintf("github.com/yourorg/%s/**", dirName),
		},
		Exclude: []string{
			"**/vendor/**",
			"**/testdata/**",
			"**/*_test.go",
			"runtime/**",
			"reflect/**",
		},
		Sampling: SamplingConfig{
			Enabled: false,
			Rate:    0.1,
		},
		MaxArgLength: 1000,
		MaxDepth:     100,
		Frameworks: FrameworksConfig{
			AutoDetect: true,
			Gin:        true,
			Echo:       true,
			Fiber:      true,
			Chi:        true,
		},
	}

	// Marshal to YAML
	data, err := yaml.Marshal(&config)
	if err != nil {
		return fmt.Errorf("failed to marshal config: %w", err)
	}

	// Write to file
	if err := os.WriteFile(configPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write config: %w", err)
	}

	fmt.Println("✅ Created .flowtrace.yaml")
	fmt.Println()
	fmt.Println("📚 Next steps:")
	fmt.Println("  1. Edit .flowtrace.yaml to customize your configuration")
	fmt.Println("  2. Update the 'include' patterns to match your package path")
	fmt.Println("  3. Run: flowctl instrument ./...")
	fmt.Println()

	return nil
}

// DefaultConfig represents the default configuration structure
type DefaultConfig struct {
	Version      string            `yaml:"version"`
	Output       OutputConfig      `yaml:"output"`
	Include      []string          `yaml:"include"`
	Exclude      []string          `yaml:"exclude"`
	Sampling     SamplingConfig    `yaml:"sampling"`
	MaxArgLength int               `yaml:"max_arg_length"`
	MaxDepth     int               `yaml:"max_depth"`
	Frameworks   FrameworksConfig  `yaml:"frameworks"`
}

// OutputConfig represents output configuration
type OutputConfig struct {
	File   string `yaml:"file"`
	Stdout bool   `yaml:"stdout"`
	Format string `yaml:"format"`
}

// SamplingConfig represents sampling configuration
type SamplingConfig struct {
	Enabled bool    `yaml:"enabled"`
	Rate    float64 `yaml:"rate"`
}

// FrameworksConfig represents framework configuration
type FrameworksConfig struct {
	AutoDetect bool `yaml:"auto_detect"`
	Gin        bool `yaml:"gin"`
	Echo       bool `yaml:"echo"`
	Fiber      bool `yaml:"fiber"`
	Chi        bool `yaml:"chi"`
}
