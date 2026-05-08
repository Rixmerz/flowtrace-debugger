package ast

import (
	"crypto/sha256"
	"encoding/hex"
	"go/ast"
	"go/token"
	"sync"
)

// Cache provides AST transformation caching for performance optimization
type Cache struct {
	mu          sync.RWMutex
	transformed map[string]*CachedAST
	maxSize     int
}

// CachedAST represents a cached AST transformation result
type CachedAST struct {
	File       *ast.File
	FileSet    *token.FileSet
	Hash       string
	ModTime    int64
	Hits       int
	Size       int
	Compressed bool
}

// NewCache creates a new AST cache with specified max size (in entries)
func NewCache(maxSize int) *Cache {
	if maxSize <= 0 {
		maxSize = 100 // Default: cache 100 files
	}
	return &Cache{
		transformed: make(map[string]*CachedAST),
		maxSize:     maxSize,
	}
}

// Get retrieves a cached AST transformation
func (c *Cache) Get(key string) (*ast.File, *token.FileSet, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	cached, ok := c.transformed[key]
	if !ok {
		return nil, nil, false
	}

	// Update hit counter
	cached.Hits++

	return cached.File, cached.FileSet, true
}

// Put stores an AST transformation in cache
func (c *Cache) Put(key string, file *ast.File, fset *token.FileSet, modTime int64) {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Check if we need to evict entries
	if len(c.transformed) >= c.maxSize {
		c.evictLRU()
	}

	// Calculate hash for validation
	hash := c.calculateHash(file)

	// Store in cache
	c.transformed[key] = &CachedAST{
		File:    file,
		FileSet: fset,
		Hash:    hash,
		ModTime: modTime,
		Hits:    0,
	}
}

// Invalidate removes a specific entry from cache
func (c *Cache) Invalidate(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	delete(c.transformed, key)
}

// Clear removes all entries from cache
func (c *Cache) Clear() {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.transformed = make(map[string]*CachedAST)
}

// Stats returns cache statistics
func (c *Cache) Stats() CacheStats {
	c.mu.RLock()
	defer c.mu.RUnlock()

	totalHits := 0
	totalSize := 0

	for _, cached := range c.transformed {
		totalHits += cached.Hits
		totalSize += cached.Size
	}

	return CacheStats{
		Entries:   len(c.transformed),
		TotalHits: totalHits,
		TotalSize: totalSize,
		MaxSize:   c.maxSize,
	}
}

// CacheStats holds cache statistics
type CacheStats struct {
	Entries   int
	TotalHits int
	TotalSize int
	MaxSize   int
}

// HitRate returns the cache hit rate
func (s CacheStats) HitRate() float64 {
	if s.TotalHits == 0 {
		return 0.0
	}
	return float64(s.TotalHits) / float64(s.Entries)
}

// evictLRU removes the least recently used entry
func (c *Cache) evictLRU() {
	var lruKey string
	minHits := -1

	for key, cached := range c.transformed {
		if minHits == -1 || cached.Hits < minHits {
			minHits = cached.Hits
			lruKey = key
		}
	}

	if lruKey != "" {
		delete(c.transformed, lruKey)
	}
}

// calculateHash computes a hash of the AST for validation
func (c *Cache) calculateHash(file *ast.File) string {
	h := sha256.New()

	// Simple hash based on package name and declarations count
	h.Write([]byte(file.Name.Name))

	for _, decl := range file.Decls {
		if fn, ok := decl.(*ast.FuncDecl); ok {
			h.Write([]byte(fn.Name.Name))
		}
	}

	return hex.EncodeToString(h.Sum(nil))
}

// Validate checks if cached AST is still valid
func (c *Cache) Validate(key string, modTime int64) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()

	cached, ok := c.transformed[key]
	if !ok {
		return false
	}

	// Check if file has been modified
	return cached.ModTime == modTime
}
