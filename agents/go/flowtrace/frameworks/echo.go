package frameworks

import (
	"fmt"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/rixmerz/flowtrace-agent-go/flowtrace"
)

// EchoMiddleware creates middleware for Echo framework
func EchoMiddleware() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			start := time.Now()
			req := c.Request()
			path := req.URL.Path
			method := req.Method

			// Create call context
			ctx := flowtrace.Enter("echo", path, map[string]interface{}{
				"method":     method,
				"path":       c.Path(),
				"query":      req.URL.Query(),
				"remote":     c.RealIP(),
				"user-agent": req.UserAgent(),
			})

			// Setup panic recovery
			defer func() {
				if err := recover(); err != nil {
					ctx.ExceptionString(fmt.Sprintf("panic: %v", err))
					panic(err)
				}
			}()

			// Process request
			err := next(c)

			// Log exit with response info
			duration := time.Since(start).Milliseconds()
			res := c.Response()

			result := map[string]interface{}{
				"status":   res.Status,
				"size":     res.Size,
				"duration": duration,
			}

			if err != nil {
				result["error"] = err.Error()
				ctx.ExitWithValues(result)
				return err
			}

			ctx.ExitWithValues(result)
			return nil
		}
	}
}

// EchoMiddlewareWithConfig creates middleware with custom configuration
func EchoMiddlewareWithConfig(config EchoConfig) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			// Skip if configured
			if config.Skip != nil && config.Skip(c) {
				return next(c)
			}

			start := time.Now()
			req := c.Request()
			path := req.URL.Path

			// Build args
			args := map[string]interface{}{
				"method": req.Method,
				"path":   c.Path(),
				"remote": c.RealIP(),
			}

			// Add custom fields
			if config.ExtraFields != nil {
				for key, extractor := range config.ExtraFields {
					args[key] = extractor(c)
				}
			}

			ctx := flowtrace.Enter("echo", path, args)

			defer func() {
				if err := recover(); err != nil {
					ctx.ExceptionString(fmt.Sprintf("panic: %v", err))
					panic(err)
				}
			}()

			err := next(c)

			// Build result
			result := map[string]interface{}{
				"status":   c.Response().Status,
				"duration": time.Since(start).Milliseconds(),
			}

			if err != nil {
				result["error"] = err.Error()
			}

			// Add custom result fields
			if config.ExtraResultFields != nil {
				for key, extractor := range config.ExtraResultFields {
					result[key] = extractor(c)
				}
			}

			ctx.ExitWithValues(result)
			return err
		}
	}
}

// EchoConfig holds configuration for Echo middleware
type EchoConfig struct {
	// Skip allows skipping certain routes
	Skip func(echo.Context) bool

	// ExtraFields adds custom fields to trace entry
	ExtraFields map[string]func(echo.Context) interface{}

	// ExtraResultFields adds custom fields to trace exit
	ExtraResultFields map[string]func(echo.Context) interface{}
}

// DefaultEchoConfig returns default Echo middleware configuration
func DefaultEchoConfig() EchoConfig {
	return EchoConfig{
		Skip: func(c echo.Context) bool {
			// Skip health check endpoints by default
			path := c.Request().URL.Path
			return path == "/health" || path == "/ping" || path == "/metrics"
		},
	}
}
