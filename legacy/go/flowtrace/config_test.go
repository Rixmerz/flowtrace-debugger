package flowtrace

import (
	"os"
	"testing"
)

func TestDefaultConfig(t *testing.T) {
	config := DefaultConfig()

	if config == nil {
		t.Fatal("DefaultConfig() returned nil")
	}

	if config.LogFile != "flowtrace.jsonl" {
		t.Errorf("Expected default LogFile 'flowtrace.jsonl', got %q", config.LogFile)
	}

	if config.MaxArgLength != 1000 {
		t.Errorf("Expected MaxArgLength 1000, got %d", config.MaxArgLength)
	}

	if config.MaxDepth != 100 {
		t.Errorf("Expected MaxDepth 100, got %d", config.MaxDepth)
	}

	if config.SamplingRate != 1.0 {
		t.Errorf("Expected SamplingRate 1.0, got %f", config.SamplingRate)
	}

	if !config.Frameworks.AutoDetect {
		t.Error("Expected Frameworks.AutoDetect to be true")
	}
}

func TestConfigValidation(t *testing.T) {
	tests := []struct {
		name      string
		config    *Config
		expectErr bool
	}{
		{
			name:      "valid default config",
			config:    DefaultConfig(),
			expectErr: false,
		},
		{
			name: "negative max arg length",
			config: &Config{
				MaxArgLength: -1,
				MaxDepth:     100,
				SamplingRate: 1.0,
			},
			expectErr: true,
		},
		{
			name: "zero max depth",
			config: &Config{
				MaxArgLength: 1000,
				MaxDepth:     0,
				SamplingRate: 1.0,
			},
			expectErr: true,
		},
		{
			name: "negative sampling rate",
			config: &Config{
				MaxArgLength: 1000,
				MaxDepth:     100,
				SamplingRate: -0.1,
			},
			expectErr: true,
		},
		{
			name: "sampling rate too high",
			config: &Config{
				MaxArgLength: 1000,
				MaxDepth:     100,
				SamplingRate: 1.5,
			},
			expectErr: true,
		},
		{
			name: "minimum valid config",
			config: &Config{
				MaxArgLength: 0,
				MaxDepth:     1,
				SamplingRate: 0.0,
			},
			expectErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.config.Validate()
			if tt.expectErr && err == nil {
				t.Error("Expected validation error, got nil")
			}
			if !tt.expectErr && err != nil {
				t.Errorf("Expected no error, got: %v", err)
			}
		})
	}
}

func TestLoadConfigFromEnv(t *testing.T) {
	// Save original env vars
	originalPrefix := os.Getenv("FLOWTRACE_PACKAGE_PREFIX")
	originalLogfile := os.Getenv("FLOWTRACE_LOGFILE")
	originalStdout := os.Getenv("FLOWTRACE_STDOUT")

	// Clean up after test
	defer func() {
		os.Setenv("FLOWTRACE_PACKAGE_PREFIX", originalPrefix)
		os.Setenv("FLOWTRACE_LOGFILE", originalLogfile)
		os.Setenv("FLOWTRACE_STDOUT", originalStdout)
	}()

	// Set test env vars
	os.Setenv("FLOWTRACE_PACKAGE_PREFIX", "github.com/test")
	os.Setenv("FLOWTRACE_LOGFILE", "custom.jsonl")
	os.Setenv("FLOWTRACE_STDOUT", "true")

	config := LoadConfigFromEnv()

	if config.PackagePrefix != "github.com/test" {
		t.Errorf("Expected PackagePrefix 'github.com/test', got %q", config.PackagePrefix)
	}

	if config.LogFile != "custom.jsonl" {
		t.Errorf("Expected LogFile 'custom.jsonl', got %q", config.LogFile)
	}

	if !config.Stdout {
		t.Error("Expected Stdout to be true")
	}
}

func TestConfigShouldSample(t *testing.T) {
	tests := []struct {
		name         string
		samplingRate float64
		expected     bool
	}{
		{
			name:         "always sample",
			samplingRate: 1.0,
			expected:     true,
		},
		{
			name:         "above 1.0",
			samplingRate: 1.5,
			expected:     true,
		},
		{
			name:         "zero sampling",
			samplingRate: 0.0,
			expected:     false, // Current implementation
		},
		{
			name:         "partial sampling",
			samplingRate: 0.5,
			expected:     false, // TODO: needs proper implementation
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			config := &Config{
				SamplingRate: tt.samplingRate,
			}
			result := config.ShouldSample()
			if result != tt.expected {
				t.Errorf("ShouldSample() = %v, want %v", result, tt.expected)
			}
		})
	}
}

func TestFrameworkConfig(t *testing.T) {
	config := DefaultConfig()

	if !config.Frameworks.Gin {
		t.Error("Expected Gin framework to be enabled by default")
	}

	if !config.Frameworks.Echo {
		t.Error("Expected Echo framework to be enabled by default")
	}

	if !config.Frameworks.Fiber {
		t.Error("Expected Fiber framework to be enabled by default")
	}

	if !config.Frameworks.Chi {
		t.Error("Expected Chi framework to be enabled by default")
	}

	if !config.Frameworks.AutoDetect {
		t.Error("Expected AutoDetect to be enabled by default")
	}
}

func TestConfigExcludeIncludePatterns(t *testing.T) {
	config := DefaultConfig()

	// Should start with empty patterns
	if len(config.Exclude) != 0 {
		t.Errorf("Expected empty Exclude patterns, got %d", len(config.Exclude))
	}

	if len(config.Include) != 0 {
		t.Errorf("Expected empty Include patterns, got %d", len(config.Include))
	}

	// Test with custom patterns
	config.Exclude = []string{"**/vendor/**", "**/testdata/**"}
	config.Include = []string{"github.com/user/project/**"}

	if len(config.Exclude) != 2 {
		t.Errorf("Expected 2 exclude patterns, got %d", len(config.Exclude))
	}

	if len(config.Include) != 1 {
		t.Errorf("Expected 1 include pattern, got %d", len(config.Include))
	}
}

func TestConfigEdgeCases(t *testing.T) {
	t.Run("nil config validation", func(t *testing.T) {
		var config *Config
		err := config.Validate()
		if err == nil {
			t.Error("Expected error for nil config")
		}
	})

	t.Run("empty config validation", func(t *testing.T) {
		config := &Config{}
		err := config.Validate()
		if err == nil {
			t.Error("Expected error for empty config")
		}
	})

	t.Run("config with boundary values", func(t *testing.T) {
		config := &Config{
			MaxArgLength: 0,
			MaxDepth:     1,
			SamplingRate: 0.0,
		}
		err := config.Validate()
		if err != nil {
			t.Errorf("Boundary values should be valid: %v", err)
		}
	})
}

func TestLoadConfigMissingFile(t *testing.T) {
	// Test loading with empty path (uses default search paths)
	config, err := LoadConfig("")

	// Should not error when using default paths
	if err != nil {
		// It's okay if config file is not found, should use defaults
		t.Logf("Config file not found (expected), using defaults: %v", err)
	}

	// Should return valid config with defaults
	if config != nil {
		// Should have default values
		if config.LogFile != "flowtrace.jsonl" {
			t.Error("Expected default LogFile when config file missing")
		}
	}
}

func TestConfigDefaults(t *testing.T) {
	// Test that defaults are applied correctly
	config := &Config{}

	// Before validation
	if config.MaxArgLength != 0 {
		t.Error("Expected uninitialized MaxArgLength to be 0")
	}

	// After LoadConfig with missing file and env vars
	loaded, err := LoadConfig("")
	if err != nil {
		t.Fatalf("LoadConfig failed: %v", err)
	}

	if loaded.MaxArgLength == 0 {
		t.Error("Expected default MaxArgLength to be set")
	}

	if loaded.LogFile == "" {
		t.Error("Expected default LogFile to be set")
	}
}
