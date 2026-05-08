package frameworks

import (
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rixmerz/flowtrace-agent-go/flowtrace"
)

// ChiMiddleware creates middleware for Chi framework
func ChiMiddleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			path := r.URL.Path
			method := r.Method

			// Create response writer wrapper to capture status
			wrapped := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}

			// Create call context
			ctx := flowtrace.Enter("chi", path, map[string]interface{}{
				"method":     method,
				"path":       chi.RouteContext(r.Context()).RoutePattern(),
				"query":      r.URL.Query(),
				"remote":     r.RemoteAddr,
				"user-agent": r.UserAgent(),
			})

			// Setup panic recovery
			defer func() {
				if err := recover(); err != nil {
					ctx.ExceptionString(fmt.Sprintf("panic: %v", err))
					panic(err)
				}
			}()

			// Process request
			next.ServeHTTP(wrapped, r)

			// Log exit with response info
			duration := time.Since(start).Milliseconds()
			ctx.ExitWithValues(map[string]interface{}{
				"status":   wrapped.statusCode,
				"size":     wrapped.written,
				"duration": duration,
			})
		})
	}
}

// ChiMiddlewareWithConfig creates middleware with custom configuration
func ChiMiddlewareWithConfig(config ChiConfig) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Skip if configured
			if config.Skip != nil && config.Skip(r) {
				next.ServeHTTP(w, r)
				return
			}

			start := time.Now()
			path := r.URL.Path

			// Create response writer wrapper
			wrapped := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}

			// Build args
			args := map[string]interface{}{
				"method": r.Method,
				"path":   chi.RouteContext(r.Context()).RoutePattern(),
				"remote": r.RemoteAddr,
			}

			// Add custom fields
			if config.ExtraFields != nil {
				for key, extractor := range config.ExtraFields {
					args[key] = extractor(r)
				}
			}

			ctx := flowtrace.Enter("chi", path, args)

			defer func() {
				if err := recover(); err != nil {
					ctx.ExceptionString(fmt.Sprintf("panic: %v", err))
					panic(err)
				}
			}()

			next.ServeHTTP(wrapped, r)

			// Build result
			result := map[string]interface{}{
				"status":   wrapped.statusCode,
				"duration": time.Since(start).Milliseconds(),
			}

			// Add custom result fields
			if config.ExtraResultFields != nil {
				for key, extractor := range config.ExtraResultFields {
					result[key] = extractor(w, r)
				}
			}

			ctx.ExitWithValues(result)
		})
	}
}

// ChiConfig holds configuration for Chi middleware
type ChiConfig struct {
	// Skip allows skipping certain routes
	Skip func(*http.Request) bool

	// ExtraFields adds custom fields to trace entry
	ExtraFields map[string]func(*http.Request) interface{}

	// ExtraResultFields adds custom fields to trace exit
	ExtraResultFields map[string]func(http.ResponseWriter, *http.Request) interface{}
}

// DefaultChiConfig returns default Chi middleware configuration
func DefaultChiConfig() ChiConfig {
	return ChiConfig{
		Skip: func(r *http.Request) bool {
			// Skip health check endpoints by default
			path := r.URL.Path
			return path == "/health" || path == "/ping" || path == "/metrics"
		},
	}
}

// responseWriter wraps http.ResponseWriter to capture status code
type responseWriter struct {
	http.ResponseWriter
	statusCode int
	written    int64
}

func (rw *responseWriter) WriteHeader(statusCode int) {
	rw.statusCode = statusCode
	rw.ResponseWriter.WriteHeader(statusCode)
}

func (rw *responseWriter) Write(data []byte) (int, error) {
	n, err := rw.ResponseWriter.Write(data)
	rw.written += int64(n)
	return n, err
}
