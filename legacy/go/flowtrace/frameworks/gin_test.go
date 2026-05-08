package frameworks

import (
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestGinMiddleware(t *testing.T) {
	gin.SetMode(gin.TestMode)

	router := gin.New()
	router.Use(GinMiddleware())
	router.GET("/test", func(c *gin.Context) {
		c.JSON(200, gin.H{"message": "ok"})
	})

	req := httptest.NewRequest("GET", "/test", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("Expected status 200, got %d", w.Code)
	}
}

func TestGinMiddlewareWithConfig(t *testing.T) {
	gin.SetMode(gin.TestMode)

	config := DefaultGinConfig()
	router := gin.New()
	router.Use(GinMiddlewareWithConfig(config))
	router.GET("/test", func(c *gin.Context) {
		c.JSON(200, gin.H{"message": "ok"})
	})
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "healthy"})
	})

	// Test normal endpoint
	req := httptest.NewRequest("GET", "/test", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	// Test skipped endpoint (health check)
	req = httptest.NewRequest("GET", "/health", nil)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("Expected status 200 for health, got %d", w.Code)
	}
}

func TestGinMiddlewareExtraFields(t *testing.T) {
	gin.SetMode(gin.TestMode)

	config := GinConfig{
		Skip: nil,
		ExtraFields: map[string]func(*gin.Context) interface{}{
			"custom_header": func(c *gin.Context) interface{} {
				return c.GetHeader("X-Custom")
			},
		},
	}

	router := gin.New()
	router.Use(GinMiddlewareWithConfig(config))
	router.GET("/test", func(c *gin.Context) {
		c.JSON(200, gin.H{"message": "ok"})
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("X-Custom", "test-value")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("Expected status 200, got %d", w.Code)
	}
}

func TestGinMiddlewareExtraResultFields(t *testing.T) {
	gin.SetMode(gin.TestMode)

	config := GinConfig{
		Skip: nil,
		ExtraResultFields: map[string]func(*gin.Context) interface{}{
			"response_header": func(c *gin.Context) interface{} {
				return c.Writer.Header().Get("X-Response")
			},
		},
	}

	router := gin.New()
	router.Use(GinMiddlewareWithConfig(config))
	router.GET("/test", func(c *gin.Context) {
		c.Header("X-Response", "custom-response")
		c.JSON(200, gin.H{"message": "ok"})
	})

	req := httptest.NewRequest("GET", "/test", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("Expected status 200, got %d", w.Code)
	}
}

func TestGinMiddlewareSkipFunction(t *testing.T) {
	gin.SetMode(gin.TestMode)

	skipCount := 0
	config := GinConfig{
		Skip: func(c *gin.Context) bool {
			skipCount++
			return c.Request.URL.Path == "/skip"
		},
	}

	router := gin.New()
	router.Use(GinMiddlewareWithConfig(config))
	router.GET("/skip", func(c *gin.Context) {
		c.JSON(200, gin.H{"message": "skipped"})
	})
	router.GET("/track", func(c *gin.Context) {
		c.JSON(200, gin.H{"message": "tracked"})
	})

	// Request to skipped endpoint
	req := httptest.NewRequest("GET", "/skip", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	// Request to tracked endpoint
	req = httptest.NewRequest("GET", "/track", nil)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	if skipCount != 2 {
		t.Errorf("Expected skip function to be called 2 times, got %d", skipCount)
	}
}

func TestGinDefaultConfig(t *testing.T) {
	config := DefaultGinConfig()

	if config.Skip == nil {
		t.Error("Expected default skip function to be set")
	}

	// Test default skip patterns
	gin.SetMode(gin.TestMode)

	testCases := []struct {
		path       string
		shouldSkip bool
	}{
		{"/health", true},
		{"/ping", true},
		{"/metrics", true},
		{"/api/users", false},
		{"/healthcheck", false}, // Only exact match
	}

	for _, tc := range testCases {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("GET", tc.path, nil)

		result := config.Skip(c)
		if result != tc.shouldSkip {
			t.Errorf("Path %s: expected skip=%v, got %v", tc.path, tc.shouldSkip, result)
		}
	}
}

func TestGinMiddlewareMethods(t *testing.T) {
	gin.SetMode(gin.TestMode)

	router := gin.New()
	router.Use(GinMiddleware())
	router.GET("/test", func(c *gin.Context) {
		c.JSON(200, gin.H{"message": "get"})
	})
	router.POST("/test", func(c *gin.Context) {
		c.JSON(201, gin.H{"message": "post"})
	})
	router.PUT("/test", func(c *gin.Context) {
		c.JSON(200, gin.H{"message": "put"})
	})
	router.DELETE("/test", func(c *gin.Context) {
		c.Status(204)
	})

	methods := []string{"GET", "POST", "PUT", "DELETE"}
	for _, method := range methods {
		req := httptest.NewRequest(method, "/test", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code < 200 || w.Code >= 300 {
			t.Errorf("Method %s: expected 2xx status, got %d", method, w.Code)
		}
	}
}

func TestGinMiddlewareErrorResponse(t *testing.T) {
	gin.SetMode(gin.TestMode)

	router := gin.New()
	router.Use(GinMiddleware())
	router.GET("/error", func(c *gin.Context) {
		c.JSON(500, gin.H{"error": "internal error"})
	})

	req := httptest.NewRequest("GET", "/error", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 500 {
		t.Errorf("Expected status 500, got %d", w.Code)
	}
}

func TestGinMiddlewareNotFound(t *testing.T) {
	gin.SetMode(gin.TestMode)

	router := gin.New()
	router.Use(GinMiddleware())

	req := httptest.NewRequest("GET", "/nonexistent", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 404 {
		t.Errorf("Expected status 404, got %d", w.Code)
	}
}
