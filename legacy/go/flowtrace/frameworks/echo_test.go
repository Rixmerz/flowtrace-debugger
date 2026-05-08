package frameworks

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
)

func TestEchoMiddleware(t *testing.T) {
	e := echo.New()
	e.Use(EchoMiddleware())
	e.GET("/test", func(c echo.Context) error {
		return c.JSON(200, map[string]string{"message": "ok"})
	})

	req := httptest.NewRequest("GET", "/test", nil)
	w := httptest.NewRecorder()
	e.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("Expected status 200, got %d", w.Code)
	}
}

func TestEchoMiddlewareWithConfig(t *testing.T) {
	config := DefaultEchoConfig()
	e := echo.New()
	e.Use(EchoMiddlewareWithConfig(config))
	e.GET("/test", func(c echo.Context) error {
		return c.JSON(200, map[string]string{"message": "ok"})
	})
	e.GET("/health", func(c echo.Context) error {
		return c.JSON(200, map[string]string{"status": "healthy"})
	})

	// Test normal endpoint
	req := httptest.NewRequest("GET", "/test", nil)
	w := httptest.NewRecorder()
	e.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	// Test skipped endpoint
	req = httptest.NewRequest("GET", "/health", nil)
	w = httptest.NewRecorder()
	e.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("Expected status 200 for health, got %d", w.Code)
	}
}

func TestEchoMiddlewareExtraFields(t *testing.T) {
	config := EchoConfig{
		Skip: nil,
		ExtraFields: map[string]func(echo.Context) interface{}{
			"custom_header": func(c echo.Context) interface{} {
				return c.Request().Header.Get("X-Custom")
			},
		},
	}

	e := echo.New()
	e.Use(EchoMiddlewareWithConfig(config))
	e.GET("/test", func(c echo.Context) error {
		return c.JSON(200, map[string]string{"message": "ok"})
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("X-Custom", "test-value")
	w := httptest.NewRecorder()
	e.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("Expected status 200, got %d", w.Code)
	}
}

func TestEchoMiddlewareExtraResultFields(t *testing.T) {
	config := EchoConfig{
		Skip: nil,
		ExtraResultFields: map[string]func(echo.Context) interface{}{
			"response_size": func(c echo.Context) interface{} {
				return c.Response().Size
			},
		},
	}

	e := echo.New()
	e.Use(EchoMiddlewareWithConfig(config))
	e.GET("/test", func(c echo.Context) error {
		return c.JSON(200, map[string]string{"message": "ok"})
	})

	req := httptest.NewRequest("GET", "/test", nil)
	w := httptest.NewRecorder()
	e.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("Expected status 200, got %d", w.Code)
	}
}

func TestEchoMiddlewareSkipFunction(t *testing.T) {
	skipCount := 0
	config := EchoConfig{
		Skip: func(c echo.Context) bool {
			skipCount++
			return c.Request().URL.Path == "/skip"
		},
	}

	e := echo.New()
	e.Use(EchoMiddlewareWithConfig(config))
	e.GET("/skip", func(c echo.Context) error {
		return c.JSON(200, map[string]string{"message": "skipped"})
	})
	e.GET("/track", func(c echo.Context) error {
		return c.JSON(200, map[string]string{"message": "tracked"})
	})

	// Request to skipped endpoint
	req := httptest.NewRequest("GET", "/skip", nil)
	w := httptest.NewRecorder()
	e.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	// Request to tracked endpoint
	req = httptest.NewRequest("GET", "/track", nil)
	w = httptest.NewRecorder()
	e.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	if skipCount != 2 {
		t.Errorf("Expected skip function to be called 2 times, got %d", skipCount)
	}
}

func TestEchoDefaultConfig(t *testing.T) {
	config := DefaultEchoConfig()

	if config.Skip == nil {
		t.Error("Expected default skip function to be set")
	}

	// Test default skip patterns
	e := echo.New()

	testCases := []struct {
		path       string
		shouldSkip bool
	}{
		{"/health", true},
		{"/ping", true},
		{"/metrics", true},
		{"/api/users", false},
		{"/healthcheck", false},
	}

	for _, tc := range testCases {
		req := httptest.NewRequest("GET", tc.path, nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)

		result := config.Skip(c)
		if result != tc.shouldSkip {
			t.Errorf("Path %s: expected skip=%v, got %v", tc.path, tc.shouldSkip, result)
		}
	}
}

func TestEchoMiddlewareMethods(t *testing.T) {
	e := echo.New()
	e.Use(EchoMiddleware())
	e.GET("/test", func(c echo.Context) error {
		return c.JSON(200, map[string]string{"message": "get"})
	})
	e.POST("/test", func(c echo.Context) error {
		return c.JSON(201, map[string]string{"message": "post"})
	})
	e.PUT("/test", func(c echo.Context) error {
		return c.JSON(200, map[string]string{"message": "put"})
	})
	e.DELETE("/test", func(c echo.Context) error {
		return c.NoContent(204)
	})

	methods := []string{"GET", "POST", "PUT", "DELETE"}
	for _, method := range methods {
		req := httptest.NewRequest(method, "/test", nil)
		w := httptest.NewRecorder()
		e.ServeHTTP(w, req)

		if w.Code < 200 || w.Code >= 300 {
			t.Errorf("Method %s: expected 2xx status, got %d", method, w.Code)
		}
	}
}

func TestEchoMiddlewareError(t *testing.T) {
	e := echo.New()
	e.Use(EchoMiddleware())
	e.GET("/error", func(c echo.Context) error {
		return echo.NewHTTPError(http.StatusInternalServerError, "internal error")
	})

	req := httptest.NewRequest("GET", "/error", nil)
	w := httptest.NewRecorder()
	e.ServeHTTP(w, req)

	if w.Code != 500 {
		t.Errorf("Expected status 500, got %d", w.Code)
	}
}

func TestEchoMiddlewareNotFound(t *testing.T) {
	e := echo.New()
	e.Use(EchoMiddleware())

	req := httptest.NewRequest("GET", "/nonexistent", nil)
	w := httptest.NewRecorder()
	e.ServeHTTP(w, req)

	if w.Code != 404 {
		t.Errorf("Expected status 404, got %d", w.Code)
	}
}

func TestEchoMiddlewareRealIP(t *testing.T) {
	e := echo.New()
	e.Use(EchoMiddleware())
	e.GET("/test", func(c echo.Context) error {
		return c.JSON(200, map[string]string{"message": "ok"})
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("X-Real-IP", "1.2.3.4")
	w := httptest.NewRecorder()
	e.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("Expected status 200, got %d", w.Code)
	}
}
