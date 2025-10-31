package filter

import (
	"regexp"
	"strings"
)

// PatternMatcher provides advanced pattern matching
type PatternMatcher struct {
	patterns []*Pattern
}

// Pattern represents a single filter pattern
type Pattern struct {
	original string
	regex    *regexp.Regexp
	exact    string
	prefix   string
	suffix   string
	isGlob   bool
}

// NewPatternMatcher creates a new pattern matcher
func NewPatternMatcher(patterns []string) (*PatternMatcher, error) {
	pm := &PatternMatcher{
		patterns: make([]*Pattern, 0, len(patterns)),
	}

	for _, p := range patterns {
		pattern, err := compilePattern(p)
		if err != nil {
			return nil, err
		}
		pm.patterns = append(pm.patterns, pattern)
	}

	return pm, nil
}

// Match checks if a string matches any pattern
func (pm *PatternMatcher) Match(s string) bool {
	for _, p := range pm.patterns {
		if p.Match(s) {
			return true
		}
	}
	return false
}

// MatchAll checks if a string matches all patterns
func (pm *PatternMatcher) MatchAll(s string) bool {
	for _, p := range pm.patterns {
		if !p.Match(s) {
			return false
		}
	}
	return true
}

// Match checks if a string matches this pattern
func (p *Pattern) Match(s string) bool {
	// Exact match
	if p.exact != "" {
		return s == p.exact
	}

	// Prefix match
	if p.prefix != "" {
		return strings.HasPrefix(s, p.prefix)
	}

	// Suffix match
	if p.suffix != "" {
		return strings.HasSuffix(s, p.suffix)
	}

	// Regex match
	if p.regex != nil {
		return p.regex.MatchString(s)
	}

	// Glob match
	if p.isGlob {
		return globMatch(p.original, s)
	}

	return false
}

// compilePattern compiles a pattern string into a Pattern
func compilePattern(pattern string) (*Pattern, error) {
	p := &Pattern{
		original: pattern,
	}

	// Check for exact match
	if !strings.Contains(pattern, "*") && !strings.Contains(pattern, "?") {
		p.exact = pattern
		return p, nil
	}

	// Check for prefix match (**/ at end)
	if strings.HasSuffix(pattern, "/**") {
		p.prefix = strings.TrimSuffix(pattern, "/**")
		return p, nil
	}

	// Check for suffix match (**/ at start)
	if strings.HasPrefix(pattern, "**/") {
		p.suffix = strings.TrimPrefix(pattern, "**/")
		return p, nil
	}

	// Convert glob to regex
	if strings.Contains(pattern, "*") || strings.Contains(pattern, "?") {
		regexPattern := globToRegex(pattern)
		regex, err := regexp.Compile(regexPattern)
		if err != nil {
			// Fall back to glob matching
			p.isGlob = true
			return p, nil
		}
		p.regex = regex
		return p, nil
	}

	p.exact = pattern
	return p, nil
}

// globToRegex converts a glob pattern to a regex pattern
func globToRegex(pattern string) string {
	var result strings.Builder
	result.WriteString("^")

	for i := 0; i < len(pattern); i++ {
		c := pattern[i]
		switch c {
		case '*':
			if i+1 < len(pattern) && pattern[i+1] == '*' {
				// ** matches everything including /
				result.WriteString(".*")
				i++ // Skip next *
			} else {
				// * matches everything except /
				result.WriteString("[^/]*")
			}
		case '?':
			result.WriteString(".")
		case '.', '+', '(', ')', '|', '[', ']', '{', '}', '^', '$':
			// Escape regex special characters
			result.WriteString("\\")
			result.WriteByte(c)
		default:
			result.WriteByte(c)
		}
	}

	result.WriteString("$")
	return result.String()
}

// globMatch performs simple glob matching without regex
func globMatch(pattern, s string) bool {
	return globMatchImpl(pattern, s, 0, 0)
}

// globMatchImpl is a recursive implementation of glob matching
func globMatchImpl(pattern, s string, pIdx, sIdx int) bool {
	// End of both strings - match
	if pIdx == len(pattern) && sIdx == len(s) {
		return true
	}

	// End of pattern but not string - no match
	if pIdx == len(pattern) {
		return false
	}

	// End of string but pattern has only * left
	if sIdx == len(s) {
		for i := pIdx; i < len(pattern); i++ {
			if pattern[i] != '*' {
				return false
			}
		}
		return true
	}

	// Current pattern character
	pc := pattern[pIdx]

	switch pc {
	case '*':
		// Try matching 0 or more characters
		if globMatchImpl(pattern, s, pIdx+1, sIdx) {
			return true
		}
		return globMatchImpl(pattern, s, pIdx, sIdx+1)

	case '?':
		// Match any single character
		return globMatchImpl(pattern, s, pIdx+1, sIdx+1)

	default:
		// Exact character match
		if s[sIdx] == pc {
			return globMatchImpl(pattern, s, pIdx+1, sIdx+1)
		}
		return false
	}
}

// CompilePatterns compiles multiple patterns
func CompilePatterns(patterns []string) ([]*Pattern, error) {
	result := make([]*Pattern, 0, len(patterns))
	for _, p := range patterns {
		pattern, err := compilePattern(p)
		if err != nil {
			return nil, err
		}
		result = append(result, pattern)
	}
	return result, nil
}

// MatchAny checks if string matches any of the patterns
func MatchAny(s string, patterns []*Pattern) bool {
	for _, p := range patterns {
		if p.Match(s) {
			return true
		}
	}
	return false
}

// MatchAll checks if string matches all patterns
func MatchAll(s string, patterns []*Pattern) bool {
	for _, p := range patterns {
		if !p.Match(s) {
			return false
		}
	}
	return true
}
