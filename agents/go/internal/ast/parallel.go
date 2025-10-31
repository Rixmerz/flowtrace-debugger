package ast

import (
	"go/ast"
	"go/token"
	"runtime"
	"sync"
)

// ParallelTransformer handles parallel AST transformation
type ParallelTransformer struct {
	transformer *Transformer
	workers     int
	cache       *Cache
}

// NewParallelTransformer creates a parallel AST transformer
func NewParallelTransformer(config *Config) *ParallelTransformer {
	workers := runtime.NumCPU()
	if workers > 8 {
		workers = 8 // Cap at 8 workers for optimal performance
	}

	return &ParallelTransformer{
		transformer: NewTransformer(token.NewFileSet(), config),
		workers:     workers,
		cache:       NewCache(200), // Cache up to 200 files
	}
}

// TransformFiles transforms multiple files in parallel
func (pt *ParallelTransformer) TransformFiles(files []string) ([]*TransformResult, error) {
	// Create job channel
	jobs := make(chan string, len(files))
	results := make(chan *TransformResult, len(files))

	// Start workers
	var wg sync.WaitGroup
	for i := 0; i < pt.workers; i++ {
		wg.Add(1)
		go pt.worker(jobs, results, &wg)
	}

	// Send jobs
	for _, file := range files {
		jobs <- file
	}
	close(jobs)

	// Wait for completion
	go func() {
		wg.Wait()
		close(results)
	}()

	// Collect results
	var transformedFiles []*TransformResult
	for result := range results {
		transformedFiles = append(transformedFiles, result)
	}

	return transformedFiles, nil
}

// TransformResult holds transformation result with metadata
type TransformResult struct {
	Filename  string
	File      *ast.File
	FileSet   *token.FileSet
	Error     error
	Cached    bool
	Duration  int64 // nanoseconds
	Functions int
	Lines     int
}

// worker processes transformation jobs
func (pt *ParallelTransformer) worker(jobs <-chan string, results chan<- *TransformResult, wg *sync.WaitGroup) {
	defer wg.Done()

	for filename := range jobs {
		result := pt.transformFile(filename)
		results <- result
	}
}

// transformFile transforms a single file with caching
func (pt *ParallelTransformer) transformFile(filename string) *TransformResult {
	result := &TransformResult{
		Filename: filename,
	}

	// Check cache first
	if file, fset, ok := pt.cache.Get(filename); ok {
		result.File = file
		result.FileSet = fset
		result.Cached = true
		return result
	}

	// Parse and transform
	fset, file, err := ParseFile(filename)
	if err != nil {
		result.Error = err
		return result
	}

	// Transform file
	pt.transformer.fset = fset
	if err := pt.transformer.TransformFile(file); err != nil {
		result.Error = err
		return result
	}

	// Count functions and lines
	result.Functions = countFunctions(file)
	result.Lines = countLines(fset, file)

	// Cache result
	pt.cache.Put(filename, file, fset, 0)

	result.File = file
	result.FileSet = fset
	return result
}

// Batch Transformation with Progress Tracking
type BatchTransformer struct {
	pt       *ParallelTransformer
	progress chan *Progress
}

// Progress tracks transformation progress
type Progress struct {
	Total     int
	Completed int
	Current   string
	Errors    int
}

// NewBatchTransformer creates a batch transformer with progress tracking
func NewBatchTransformer(config *Config) *BatchTransformer {
	return &BatchTransformer{
		pt:       NewParallelTransformer(config),
		progress: make(chan *Progress, 100),
	}
}

// TransformBatch transforms files in batches with progress updates
func (bt *BatchTransformer) TransformBatch(files []string) (<-chan *Progress, <-chan *TransformResult, <-chan error) {
	progress := make(chan *Progress, 10)
	results := make(chan *TransformResult, len(files))
	errChan := make(chan error, 1)

	go func() {
		defer close(progress)
		defer close(results)
		defer close(errChan)

		totalFiles := len(files)
		completed := 0
		errors := 0

		// Transform in batches
		batchSize := 10
		for i := 0; i < totalFiles; i += batchSize {
			end := i + batchSize
			if end > totalFiles {
				end = totalFiles
			}

			batch := files[i:end]

			// Transform batch
			batchResults, err := bt.pt.TransformFiles(batch)
			if err != nil {
				errChan <- err
				return
			}

			// Process results
			for _, result := range batchResults {
				if result.Error != nil {
					errors++
				}
				results <- result
				completed++

				// Send progress update
				progress <- &Progress{
					Total:     totalFiles,
					Completed: completed,
					Current:   result.Filename,
					Errors:    errors,
				}
			}
		}
	}()

	return progress, results, errChan
}

// CacheStats returns cache statistics
func (pt *ParallelTransformer) CacheStats() CacheStats {
	return pt.cache.Stats()
}

// ClearCache clears the transformation cache
func (pt *ParallelTransformer) ClearCache() {
	pt.cache.Clear()
}

// Helper functions

func countFunctions(file *ast.File) int {
	count := 0
	ast.Inspect(file, func(n ast.Node) bool {
		if _, ok := n.(*ast.FuncDecl); ok {
			count++
		}
		return true
	})
	return count
}

func countLines(fset *token.FileSet, file *ast.File) int {
	if file.End() == 0 {
		return 0
	}
	return fset.Position(file.End()).Line
}

// OptimizedPool provides object pooling for AST nodes
type OptimizedPool struct {
	identPool    sync.Pool
	callExprPool sync.Pool
	blockPool    sync.Pool
}

// NewOptimizedPool creates a new optimized object pool
func NewOptimizedPool() *OptimizedPool {
	return &OptimizedPool{
		identPool: sync.Pool{
			New: func() interface{} {
				return &ast.Ident{}
			},
		},
		callExprPool: sync.Pool{
			New: func() interface{} {
				return &ast.CallExpr{}
			},
		},
		blockPool: sync.Pool{
			New: func() interface{} {
				return &ast.BlockStmt{List: make([]ast.Stmt, 0, 10)}
			},
		},
	}
}

// GetIdent retrieves an Ident from pool
func (p *OptimizedPool) GetIdent(name string) *ast.Ident {
	ident := p.identPool.Get().(*ast.Ident)
	ident.Name = name
	return ident
}

// PutIdent returns an Ident to pool
func (p *OptimizedPool) PutIdent(ident *ast.Ident) {
	ident.Name = ""
	ident.Obj = nil
	p.identPool.Put(ident)
}

// GetCallExpr retrieves a CallExpr from pool
func (p *OptimizedPool) GetCallExpr() *ast.CallExpr {
	call := p.callExprPool.Get().(*ast.CallExpr)
	call.Fun = nil
	call.Args = call.Args[:0]
	return call
}

// PutCallExpr returns a CallExpr to pool
func (p *OptimizedPool) PutCallExpr(call *ast.CallExpr) {
	call.Fun = nil
	call.Args = nil
	call.Ellipsis = 0
	p.callExprPool.Put(call)
}

// GetBlock retrieves a BlockStmt from pool
func (p *OptimizedPool) GetBlock() *ast.BlockStmt {
	block := p.blockPool.Get().(*ast.BlockStmt)
	block.List = block.List[:0]
	return block
}

// PutBlock returns a BlockStmt to pool
func (p *OptimizedPool) PutBlock(block *ast.BlockStmt) {
	block.List = nil
	block.Lbrace = 0
	block.Rbrace = 0
	p.blockPool.Put(block)
}
