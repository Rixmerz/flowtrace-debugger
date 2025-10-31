package filter

import (
	"path/filepath"
	"strings"
)

// Filter handles package and file filtering
type Filter struct {
	include []string
	exclude []string
}

// NewFilter creates a new filter with include/exclude patterns
func NewFilter(include, exclude []string) *Filter {
	return &Filter{
		include: include,
		exclude: exclude,
	}
}

// ShouldInstrumentPackage checks if a package should be instrumented
func (f *Filter) ShouldInstrumentPackage(pkgPath string) bool {
	// Check exclude patterns first
	for _, pattern := range f.exclude {
		if f.matchPattern(pattern, pkgPath) {
			return false
		}
	}

	// If no include patterns, instrument everything not excluded
	if len(f.include) == 0 {
		return true
	}

	// Check include patterns
	for _, pattern := range f.include {
		if f.matchPattern(pattern, pkgPath) {
			return true
		}
	}

	return false
}

// ShouldInstrumentFile checks if a file should be instrumented
func (f *Filter) ShouldInstrumentFile(filename string) bool {
	// Skip test files
	if strings.HasSuffix(filename, "_test.go") {
		return false
	}

	// Skip generated files
	if strings.Contains(filename, ".pb.go") || strings.Contains(filename, ".gen.go") {
		return false
	}

	// Check exclude patterns
	for _, pattern := range f.exclude {
		if f.matchPattern(pattern, filename) {
			return false
		}
	}

	return true
}

// matchPattern matches a glob pattern against a string
func (f *Filter) matchPattern(pattern, str string) bool {
	// Handle exact matches
	if pattern == str {
		return true
	}

	// Handle prefix matches (package/**)
	if strings.HasSuffix(pattern, "/**") {
		prefix := strings.TrimSuffix(pattern, "/**")
		return strings.HasPrefix(str, prefix)
	}

	// Handle suffix matches (**/suffix)
	if strings.HasPrefix(pattern, "**/") {
		suffix := strings.TrimPrefix(pattern, "**/")
		return strings.HasSuffix(str, suffix)
	}

	// Handle wildcard matches
	if strings.Contains(pattern, "*") {
		matched, _ := filepath.Match(pattern, str)
		return matched
	}

	// Check if str contains pattern
	return strings.Contains(str, pattern)
}

// DefaultExcludePatterns returns common packages to exclude
func DefaultExcludePatterns() []string {
	return []string{
		"**/vendor/**",
		"**/testdata/**",
		"**/*_test.go",
		"runtime/**",
		"reflect/**",
		"syscall/**",
		"unsafe/**",
		"internal/**",
		"testing/**",
		"fmt/**",
		"strings/**",
		"bytes/**",
		"io/**",
		"os/**",
		"time/**",
		"sync/**",
		"errors/**",
		"math/**",
		"sort/**",
		"encoding/**",
		"net/**",
		"http/**",
	}
}

// IsStdLibPackage checks if a package is from standard library
func IsStdLibPackage(pkgPath string) bool {
	// Standard library packages don't have dots in their import paths
	// (except for internal packages like internal/...)
	if strings.Contains(pkgPath, ".") {
		return false
	}

	// Check for common stdlib prefixes
	stdlibPrefixes := []string{
		"archive/",
		"bufio",
		"builtin",
		"bytes",
		"compress/",
		"container/",
		"context",
		"crypto/",
		"database/",
		"debug/",
		"embed",
		"encoding/",
		"errors",
		"expvar",
		"flag",
		"fmt",
		"go/",
		"hash/",
		"html/",
		"image/",
		"index/",
		"io",
		"log/",
		"math",
		"mime",
		"net",
		"os",
		"path",
		"plugin",
		"reflect",
		"regexp",
		"runtime",
		"sort",
		"strconv",
		"strings",
		"sync",
		"syscall",
		"testing",
		"text/",
		"time",
		"unicode",
		"unsafe",
	}

	for _, prefix := range stdlibPrefixes {
		if pkgPath == prefix || strings.HasPrefix(pkgPath, prefix+"/") {
			return true
		}
	}

	return false
}

// IsInternalPackage checks if a package is internal
func IsInternalPackage(pkgPath string) bool {
	return strings.Contains(pkgPath, "/internal/") || strings.HasPrefix(pkgPath, "internal/")
}

// IsVendorPackage checks if a package is in vendor directory
func IsVendorPackage(pkgPath string) bool {
	return strings.Contains(pkgPath, "/vendor/")
}

// IsGeneratedFile checks if a file is generated
func IsGeneratedFile(filename string) bool {
	// Check common generated file patterns
	patterns := []string{
		".pb.go",       // Protocol buffers
		".gen.go",      // General generated
		"_gen.go",      // General generated
		"generated.go", // General generated
		".pb.gw.go",    // gRPC gateway
		"bindata.go",   // go-bindata
		"easyjson.go",  // easyjson
	}

	for _, pattern := range patterns {
		if strings.Contains(filename, pattern) {
			return true
		}
	}

	return false
}
