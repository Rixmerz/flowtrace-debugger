package filter

import (
	"testing"
)

func TestFilterShouldInstrumentPackage(t *testing.T) {
	tests := []struct {
		name     string
		include  []string
		exclude  []string
		pkgPath  string
		expected bool
	}{
		{
			name:     "exclude standard library",
			include:  []string{},
			exclude:  DefaultExcludePatterns(),
			pkgPath:  "fmt",
			expected: false,
		},
		{
			name:     "exclude runtime",
			include:  []string{},
			exclude:  DefaultExcludePatterns(),
			pkgPath:  "runtime",
			expected: false,
		},
		{
			name:     "include user package",
			include:  []string{"github.com/user/project/**"},
			exclude:  DefaultExcludePatterns(),
			pkgPath:  "github.com/user/project/api",
			expected: true,
		},
		{
			name:     "exclude vendor using prefix",
			include:  []string{},
			exclude:  []string{"vendor/**"},
			pkgPath:  "vendor/pkg",
			expected: false,
		},
		{
			name:     "exclude test files",
			include:  []string{},
			exclude:  []string{"**/*_test.go"},
			pkgPath:  "github.com/user/project/api_test",
			expected: true, // Package path, not file path
		},
		{
			name:     "include specific package",
			include:  []string{"github.com/user/project/api"},
			exclude:  []string{},
			pkgPath:  "github.com/user/project/api",
			expected: true,
		},
		{
			name:     "not in include list",
			include:  []string{"github.com/user/project/api"},
			exclude:  []string{},
			pkgPath:  "github.com/user/project/web",
			expected: false,
		},
		{
			name:     "wildcard include",
			include:  []string{"github.com/user/**"},
			exclude:  []string{},
			pkgPath:  "github.com/user/project/deep/nested",
			expected: true,
		},
		{
			name:     "exclude takes precedence",
			include:  []string{"github.com/user/**"},
			exclude:  []string{"github.com/user/project/vendor/**"},
			pkgPath:  "github.com/user/project/vendor/pkg",
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := NewFilter(tt.include, tt.exclude)
			result := f.ShouldInstrumentPackage(tt.pkgPath)
			if result != tt.expected {
				t.Errorf("ShouldInstrumentPackage(%q) = %v, want %v",
					tt.pkgPath, result, tt.expected)
			}
		})
	}
}

func TestFilterShouldInstrumentFile(t *testing.T) {
	tests := []struct {
		name         string
		excludeFiles []string
		filePath     string
		expected     bool
	}{
		{
			name:         "exclude test files",
			excludeFiles: []string{"**/*_test.go"},
			filePath:     "api_test.go",
			expected:     false,
		},
		{
			name:         "include regular files",
			excludeFiles: []string{"**/*_test.go"},
			filePath:     "api.go",
			expected:     true,
		},
		{
			name:         "exclude generated files",
			excludeFiles: []string{"**/*.pb.go"},
			filePath:     "api.pb.go",
			expected:     false,
		},
		{
			name:         "exclude specific directory",
			excludeFiles: []string{"mocks/**"},
			filePath:     "mocks/service.go",
			expected:     false,
		},
		{
			name:         "no exclusions",
			excludeFiles: []string{},
			filePath:     "anything.go",
			expected:     true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := &Filter{exclude: tt.excludeFiles}
			result := f.ShouldInstrumentFile(tt.filePath)
			if result != tt.expected {
				t.Errorf("ShouldInstrumentFile(%q) = %v, want %v",
					tt.filePath, result, tt.expected)
			}
		})
	}
}

func TestDefaultExcludePatterns(t *testing.T) {
	patterns := DefaultExcludePatterns()

	if len(patterns) == 0 {
		t.Error("Expected default exclude patterns to be non-empty")
	}

	// Check for essential exclusions
	stdlibFound := false
	for _, pattern := range patterns {
		if pattern == "runtime" || pattern == "runtime/**" {
			stdlibFound = true
			break
		}
	}

	if !stdlibFound {
		t.Error("Expected default patterns to exclude runtime package")
	}
}

func TestFilterEdgeCases(t *testing.T) {
	t.Run("empty package path", func(t *testing.T) {
		f := NewFilter([]string{}, DefaultExcludePatterns())
		if !f.ShouldInstrumentPackage("") {
			t.Error("Expected true for empty package path when no includes")
		}
	})

	t.Run("empty file path", func(t *testing.T) {
		f := NewFilter([]string{}, []string{})
		if !f.ShouldInstrumentFile("") {
			t.Error("Expected true for empty file path when no exclusions")
		}
	})

	t.Run("nil filter", func(t *testing.T) {
		// Should not panic
		defer func() {
			if r := recover(); r != nil {
				t.Errorf("NewFilter panicked with nil slices: %v", r)
			}
		}()
		f := NewFilter(nil, nil)
		_ = f.ShouldInstrumentPackage("test")
	})
}

func TestFilterMultiplePatterns(t *testing.T) {
	f := NewFilter(
		[]string{
			"github.com/user/project/api/**",
			"github.com/user/project/web/**",
		},
		[]string{
			"**/vendor/**",
			"**/testdata/**",
			"**/*_test.go",
		},
	)

	testCases := []struct {
		path     string
		expected bool
	}{
		{"github.com/user/project/api/handlers", true},
		{"github.com/user/project/web/routes", true},
		{"github.com/user/project/db", false},
		{"vendor/pkg", false},
		{"testdata/fixtures", false},
	}

	for _, tc := range testCases {
		result := f.ShouldInstrumentPackage(tc.path)
		if result != tc.expected {
			t.Errorf("ShouldInstrumentPackage(%q) = %v, want %v",
				tc.path, result, tc.expected)
		}
	}
}

func TestFilterCaseSensitivity(t *testing.T) {
	f := NewFilter(
		[]string{"github.com/User/Project/**"},
		[]string{},
	)

	// Pattern matching should be case-sensitive
	if !f.ShouldInstrumentPackage("github.com/User/Project/api") {
		t.Error("Expected case-sensitive match to succeed")
	}

	// This may or may not match depending on implementation
	// Document the behavior
	result := f.ShouldInstrumentPackage("github.com/user/project/api")
	t.Logf("Case-insensitive match result: %v", result)
}
