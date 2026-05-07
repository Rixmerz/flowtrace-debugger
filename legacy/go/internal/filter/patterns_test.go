package filter

import (
	"regexp"
	"testing"
)

func TestGlobToRegex(t *testing.T) {
	tests := []struct {
		name    string
		pattern string
		text    string
		matches bool
	}{
		{
			name:    "exact match",
			pattern: "exact",
			text:    "exact",
			matches: true,
		},
		{
			name:    "exact no match",
			pattern: "exact",
			text:    "different",
			matches: false,
		},
		{
			name:    "wildcard single level",
			pattern: "*.go",
			text:    "file.go",
			matches: true,
		},
		{
			name:    "wildcard no match extension",
			pattern: "*.go",
			text:    "file.txt",
			matches: false,
		},
		{
			name:    "recursive wildcard",
			pattern: "**/*.go",
			text:    "path/to/file.go",
			matches: true,
		},
		{
			name:    "recursive wildcard deep",
			pattern: "**/*.go",
			text:    "very/deep/nested/path/file.go",
			matches: true,
		},
		{
			name:    "prefix match",
			pattern: "prefix*",
			text:    "prefix_anything",
			matches: true,
		},
		{
			name:    "suffix match",
			pattern: "*_test.go",
			text:    "api_test.go",
			matches: true,
		},
		{
			name:    "middle wildcard",
			pattern: "start*end",
			text:    "start_middle_end",
			matches: true,
		},
		{
			name:    "vendor exclusion",
			pattern: "**/vendor/**",
			text:    "project/vendor/pkg/file.go",
			matches: true,
		},
		{
			name:    "testdata exclusion",
			pattern: "**/testdata/**",
			text:    "module/testdata/fixtures/data.json",
			matches: true,
		},
		{
			name:    "generated file",
			pattern: "**/*.pb.go",
			text:    "api/proto/service.pb.go",
			matches: true,
		},
		{
			name:    "question mark single char",
			pattern: "file?.go",
			text:    "file1.go",
			matches: true,
		},
		{
			name:    "question mark no match",
			pattern: "file?.go",
			text:    "file12.go",
			matches: false,
		},
		{
			name:    "multiple wildcards",
			pattern: "*/test/*",
			text:    "pkg/test/file.go",
			matches: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			regexPattern := globToRegex(tt.pattern)
			regex, err := regexp.Compile(regexPattern)
			if err != nil {
				t.Fatalf("regexp.Compile() error: %v", err)
			}

			matches := regex.MatchString(tt.text)
			if matches != tt.matches {
				t.Errorf("Pattern %q against %q: got %v, want %v",
					tt.pattern, tt.text, matches, tt.matches)
			}
		})
	}
}

func TestMatchPattern(t *testing.T) {
	tests := []struct {
		name    string
		pattern string
		path    string
		matches bool
	}{
		{
			name:    "stdlib package",
			pattern: "fmt",
			path:    "fmt",
			matches: true,
		},
		{
			name:    "stdlib with wildcard",
			pattern: "fmt/**",
			path:    "fmt/errors",
			matches: true,
		},
		{
			name:    "user package exact",
			pattern: "github.com/user/project",
			path:    "github.com/user/project",
			matches: true,
		},
		{
			name:    "user package recursive",
			pattern: "github.com/user/project/**",
			path:    "github.com/user/project/api/handlers",
			matches: true,
		},
		{
			name:    "vendor path with prefix",
			pattern: "vendor/**",
			path:    "vendor/pkg/lib",
			matches: true,
		},
		{
			name:    "test file pattern",
			pattern: "*_test.go",
			path:    "user_test.go",
			matches: true,
		},
		{
			name:    "no match different prefix",
			pattern: "github.com/user/**",
			path:    "github.com/other/project",
			matches: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := &Filter{}
			matches := f.matchPattern(tt.pattern, tt.path)
			if matches != tt.matches {
				t.Errorf("matchPattern(%q, %q) = %v, want %v",
					tt.pattern, tt.path, matches, tt.matches)
			}
		})
	}
}

func TestPatternEdgeCases(t *testing.T) {
	t.Run("empty pattern", func(t *testing.T) {
		regexPattern := globToRegex("")
		regex, err := regexp.Compile(regexPattern)
		if err != nil {
			t.Fatalf("regexp.Compile() error: %v", err)
		}
		if !regex.MatchString("") {
			t.Error("Empty pattern should match empty string")
		}
	})

	t.Run("only wildcards", func(t *testing.T) {
		regexPattern := globToRegex("**")
		regex, err := regexp.Compile(regexPattern)
		if err != nil {
			t.Fatalf("regexp.Compile() error: %v", err)
		}
		if !regex.MatchString("anything/goes/here") {
			t.Error("** pattern should match anything")
		}
	})

	t.Run("special regex characters", func(t *testing.T) {
		// Patterns with characters that are special in regex
		tests := []struct {
			pattern string
			text    string
			matches bool
		}{
			{"file.go", "file.go", true},
			{"file.go", "filexgo", false}, // dot should be literal
			{"[test]", "[test]", true},
			{"(test)", "(test)", true},
			{"test+file", "test+file", true},
		}

		for _, tt := range tests {
			regexPattern := globToRegex(tt.pattern)
			regex, err := regexp.Compile(regexPattern)
			if err != nil {
				t.Fatalf("regexp.Compile(%q) error: %v", tt.pattern, err)
			}
			matches := regex.MatchString(tt.text)
			if matches != tt.matches {
				t.Errorf("Pattern %q against %q: got %v, want %v",
					tt.pattern, tt.text, matches, tt.matches)
			}
		}
	})

	t.Run("very long paths", func(t *testing.T) {
		pattern := "**/*.go"
		longPath := "a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q/r/s/t/u/v/w/x/y/z/file.go"

		regexPattern := globToRegex(pattern)
		regex, err := regexp.Compile(regexPattern)
		if err != nil {
			t.Fatalf("regexp.Compile() error: %v", err)
		}

		if !regex.MatchString(longPath) {
			t.Error("Should match very long paths")
		}
	})
}

func TestPatternPerformance(t *testing.T) {
	// Test that pattern matching is reasonably fast
	pattern := "github.com/user/project/**"
	paths := make([]string, 1000)
	for i := 0; i < 1000; i++ {
		paths[i] = "github.com/user/project/module/submodule/file"
	}

	f := &Filter{}
	for _, path := range paths {
		f.matchPattern(pattern, path)
	}
	// If this completes without timeout, performance is acceptable
}

func TestMultipleStarPatterns(t *testing.T) {
	tests := []struct {
		name    string
		pattern string
		path    string
		matches bool
	}{
		{
			name:    "double star at start",
			pattern: "**/file.go",
			path:    "deep/nested/file.go",
			matches: true,
		},
		{
			name:    "double star at end",
			pattern: "prefix/**",
			path:    "prefix/any/thing",
			matches: true,
		},
		{
			name:    "double star in middle",
			pattern: "start/**/end",
			path:    "start/middle/layers/end",
			matches: true,
		},
		{
			name:    "multiple double stars",
			pattern: "**/vendor/**/file.go",
			path:    "project/vendor/pkg/subpkg/file.go",
			matches: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			regexPattern := globToRegex(tt.pattern)
			regex, err := regexp.Compile(regexPattern)
			if err != nil {
				t.Fatalf("regexp.Compile() error: %v", err)
			}

			matches := regex.MatchString(tt.path)
			if matches != tt.matches {
				t.Errorf("Pattern %q against %q: got %v, want %v",
					tt.pattern, tt.path, matches, tt.matches)
			}
		})
	}
}
