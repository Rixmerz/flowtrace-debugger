package frameworks

import (
	"fmt"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/rixmerz/flowtrace-agent-go/flowtrace"
)

// FiberMiddleware creates middleware for Fiber framework
func FiberMiddleware() fiber.Handler {
	return func(c *fiber.Ctx) error {
		start := time.Now()
		path := string(c.Request().URI().Path())
		method := c.Method()

		// Create call context
		ctx := flowtrace.Enter("fiber", path, map[string]interface{}{
			"method":     method,
			"path":       c.Path(),
			"query":      c.Queries(),
			"remote":     c.IP(),
			"user-agent": string(c.Request().Header.UserAgent()),
		})

		// Setup panic recovery
		defer func() {
			if err := recover(); err != nil {
				ctx.ExceptionString(fmt.Sprintf("panic: %v", err))
				panic(err)
			}
		}()

		// Process request
		err := c.Next()

		// Log exit with response info
		duration := time.Since(start).Milliseconds()

		result := map[string]interface{}{
			"status":   c.Response().StatusCode(),
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

// FiberMiddlewareWithConfig creates middleware with custom configuration
func FiberMiddlewareWithConfig(config FiberConfig) fiber.Handler {
	return func(c *fiber.Ctx) error {
		// Skip if configured
		if config.Skip != nil && config.Skip(c) {
			return c.Next()
		}

		start := time.Now()
		path := string(c.Request().URI().Path())

		// Build args
		args := map[string]interface{}{
			"method": c.Method(),
			"path":   c.Path(),
			"remote": c.IP(),
		}

		// Add custom fields
		if config.ExtraFields != nil {
			for key, extractor := range config.ExtraFields {
				args[key] = extractor(c)
			}
		}

		ctx := flowtrace.Enter("fiber", path, args)

		defer func() {
			if err := recover(); err != nil {
				ctx.ExceptionString(fmt.Sprintf("panic: %v", err))
				panic(err)
			}
		}()

		err := c.Next()

		// Build result
		result := map[string]interface{}{
			"status":   c.Response().StatusCode(),
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

// FiberConfig holds configuration for Fiber middleware
type FiberConfig struct {
	// Skip allows skipping certain routes
	Skip func(*fiber.Ctx) bool

	// ExtraFields adds custom fields to trace entry
	ExtraFields map[string]func(*fiber.Ctx) interface{}

	// ExtraResultFields adds custom fields to trace exit
	ExtraResultFields map[string]func(*fiber.Ctx) interface{}
}

// DefaultFiberConfig returns default Fiber middleware configuration
func DefaultFiberConfig() FiberConfig {
	return FiberConfig{
		Skip: func(c *fiber.Ctx) bool {
			// Skip health check endpoints by default
			path := c.Path()
			return path == "/health" || path == "/ping" || path == "/metrics"
		},
	}
}
