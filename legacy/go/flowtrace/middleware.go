package flowtrace

import (
	"fmt"
	"net/http"
	"time"
)

// HTTPMiddleware creates middleware for tracing HTTP handlers
func HTTPMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		// Log request entry
		TraceEnter("http", r.URL.Path, map[string]interface{}{
			"method": r.Method,
			"url":    r.URL.String(),
			"remote": r.RemoteAddr,
		})

		// Create response writer wrapper to capture status code
		wrapped := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}

		// Call next handler
		defer func() {
			if rec := recover(); rec != nil {
				TraceException("http", r.URL.Path, fmt.Errorf("panic: %v", rec))
				panic(rec)
			}
		}()

		next.ServeHTTP(wrapped, r)

		// Log request exit
		TraceExit("http", r.URL.Path, map[string]interface{}{
			"status":   wrapped.statusCode,
			"duration": time.Since(start).Milliseconds(),
		})
	})
}

// responseWriter wraps http.ResponseWriter to capture status code
type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

// GinMiddleware creates middleware for Gin framework
func GinMiddleware() interface{} {
	// Placeholder for Gin middleware
	// Would require gin-gonic/gin import
	return func(c interface{}) {
		// Implementation would go here
	}
}

// EchoMiddleware creates middleware for Echo framework
func EchoMiddleware() interface{} {
	// Placeholder for Echo middleware
	// Would require labstack/echo import
	return func(c interface{}) error {
		// Implementation would go here
		return nil
	}
}
