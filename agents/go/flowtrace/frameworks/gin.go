package frameworks

import (
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/rixmerz/flowtrace-agent-go/flowtrace"
)

// GinMiddleware creates middleware for Gin framework
func GinMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		method := c.Request.Method

		// Create call context
		ctx := flowtrace.Enter("gin", path, map[string]interface{}{
			"method":     method,
			"path":       c.FullPath(),
			"query":      c.Request.URL.Query(),
			"remote":     c.ClientIP(),
			"user-agent": c.Request.UserAgent(),
		})

		// Setup panic recovery
		defer func() {
			if err := recover(); err != nil {
				ctx.ExceptionString(fmt.Sprintf("panic: %v", err))
				// Re-panic to let Gin's recovery handle it
				panic(err)
			}
		}()

		// Process request
		c.Next()

		// Log exit with response info
		duration := time.Since(start).Milliseconds()
		ctx.ExitWithValues(map[string]interface{}{
			"status":   c.Writer.Status(),
			"size":     c.Writer.Size(),
			"duration": duration,
			"errors":   c.Errors.String(),
		})
	}
}

// GinMiddlewareWithConfig creates middleware with custom configuration
func GinMiddlewareWithConfig(config GinConfig) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Skip if path matches skip patterns
		if config.Skip != nil && config.Skip(c) {
			c.Next()
			return
		}

		start := time.Now()
		path := c.Request.URL.Path

		// Build args with custom extractors
		args := map[string]interface{}{
			"method": c.Request.Method,
			"path":   c.FullPath(),
			"remote": c.ClientIP(),
		}

		// Add custom fields
		if config.ExtraFields != nil {
			for key, extractor := range config.ExtraFields {
				args[key] = extractor(c)
			}
		}

		ctx := flowtrace.Enter("gin", path, args)

		defer func() {
			if err := recover(); err != nil {
				ctx.ExceptionString(fmt.Sprintf("panic: %v", err))
				panic(err)
			}
		}()

		c.Next()

		// Build result
		result := map[string]interface{}{
			"status":   c.Writer.Status(),
			"duration": time.Since(start).Milliseconds(),
		}

		// Add custom result fields
		if config.ExtraResultFields != nil {
			for key, extractor := range config.ExtraResultFields {
				result[key] = extractor(c)
			}
		}

		ctx.ExitWithValues(result)
	}
}

// GinConfig holds configuration for Gin middleware
type GinConfig struct {
	// Skip allows skipping certain routes
	Skip func(*gin.Context) bool

	// ExtraFields adds custom fields to trace entry
	ExtraFields map[string]func(*gin.Context) interface{}

	// ExtraResultFields adds custom fields to trace exit
	ExtraResultFields map[string]func(*gin.Context) interface{}
}

// DefaultGinConfig returns default Gin middleware configuration
func DefaultGinConfig() GinConfig {
	return GinConfig{
		Skip: func(c *gin.Context) bool {
			// Skip health check endpoints by default
			path := c.Request.URL.Path
			return path == "/health" || path == "/ping" || path == "/metrics"
		},
	}
}
