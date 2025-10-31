package flowtrace

import (
	"fmt"
	"os"

	"github.com/spf13/viper"
)

// Config holds FlowTrace configuration
type Config struct {
	// PackagePrefix filters traces by package prefix
	PackagePrefix string

	// LogFile path to JSONL log file
	LogFile string

	// Stdout enables logging to stdout
	Stdout bool

	// MaxArgLength maximum length for argument values
	MaxArgLength int

	// Exclude packages/patterns to exclude
	Exclude []string

	// Include packages/patterns to include
	Include []string

	// SamplingRate for trace sampling (0.0-1.0)
	SamplingRate float64

	// MaxDepth maximum call stack depth to trace
	MaxDepth int

	// FrameworkConfig framework-specific configuration
	Frameworks FrameworkConfig
}

// FrameworkConfig holds framework-specific settings
type FrameworkConfig struct {
	AutoDetect bool
	Gin        bool
	Echo       bool
	Fiber      bool
	Chi        bool
}

// DefaultConfig returns default configuration
func DefaultConfig() *Config {
	return &Config{
		PackagePrefix: "",
		LogFile:       "flowtrace.jsonl",
		Stdout:        false,
		MaxArgLength:  1000,
		MaxDepth:      100,
		SamplingRate:  1.0,
		Exclude:       []string{},
		Include:       []string{},
		Frameworks: FrameworkConfig{
			AutoDetect: true,
			Gin:        true,
			Echo:       true,
			Fiber:      true,
			Chi:        true,
		},
	}
}

// LoadConfig loads configuration from file and environment
func LoadConfig(configFile string) (*Config, error) {
	config := DefaultConfig()

	// Setup viper
	v := viper.New()

	// Set config file
	if configFile != "" {
		v.SetConfigFile(configFile)
	} else {
		v.SetConfigName(".flowtrace")
		v.SetConfigType("yaml")
		v.AddConfigPath(".")
		v.AddConfigPath("$HOME")
	}

	// Read config file
	if err := v.ReadInConfig(); err != nil {
		// Config file not found is okay, use defaults + env vars
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, fmt.Errorf("failed to read config: %w", err)
		}
	}

	// Bind environment variables
	v.SetEnvPrefix("FLOWTRACE")
	v.AutomaticEnv()

	// Load configuration
	config.PackagePrefix = v.GetString("package_prefix")
	config.LogFile = v.GetString("output.file")
	config.Stdout = v.GetBool("output.stdout")
	config.MaxArgLength = v.GetInt("max_arg_length")
	config.MaxDepth = v.GetInt("max_depth")
	config.SamplingRate = v.GetFloat64("sampling.rate")

	// Load exclude/include patterns
	if v.IsSet("exclude") {
		config.Exclude = v.GetStringSlice("exclude")
	}
	if v.IsSet("include") {
		config.Include = v.GetStringSlice("include")
	}

	// Load framework config
	if v.IsSet("frameworks") {
		config.Frameworks.AutoDetect = v.GetBool("frameworks.auto_detect")
		config.Frameworks.Gin = v.GetBool("frameworks.gin")
		config.Frameworks.Echo = v.GetBool("frameworks.echo")
		config.Frameworks.Fiber = v.GetBool("frameworks.fiber")
		config.Frameworks.Chi = v.GetBool("frameworks.chi")
	}

	// Apply defaults if not set
	if config.LogFile == "" {
		config.LogFile = "flowtrace.jsonl"
	}
	if config.MaxArgLength == 0 {
		config.MaxArgLength = 1000
	}
	if config.MaxDepth == 0 {
		config.MaxDepth = 100
	}
	if config.SamplingRate == 0 {
		config.SamplingRate = 1.0
	}

	return config, nil
}

// LoadConfigFromEnv loads configuration from environment variables only
func LoadConfigFromEnv() *Config {
	config := DefaultConfig()

	if val := os.Getenv("FLOWTRACE_PACKAGE_PREFIX"); val != "" {
		config.PackagePrefix = val
	}
	if val := os.Getenv("FLOWTRACE_LOGFILE"); val != "" {
		config.LogFile = val
	}
	if val := os.Getenv("FLOWTRACE_STDOUT"); val == "true" {
		config.Stdout = true
	}

	return config
}

// Validate checks if configuration is valid
func (c *Config) Validate() error {
	if c == nil {
		return fmt.Errorf("config cannot be nil")
	}

	if c.MaxArgLength < 0 {
		return fmt.Errorf("max_arg_length must be non-negative")
	}

	if c.MaxDepth < 1 {
		return fmt.Errorf("max_depth must be at least 1")
	}

	if c.SamplingRate < 0.0 || c.SamplingRate > 1.0 {
		return fmt.Errorf("sampling_rate must be between 0.0 and 1.0")
	}

	return nil
}

// ShouldSample determines if this call should be sampled
func (c *Config) ShouldSample() bool {
	if c.SamplingRate >= 1.0 {
		return true
	}

	// Simple random sampling
	// In production, use more sophisticated sampling
	return false // TODO: Implement proper sampling
}
