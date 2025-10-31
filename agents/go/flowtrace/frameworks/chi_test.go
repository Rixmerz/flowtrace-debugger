package frameworks

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestChiMiddleware(t *testing.T) {
	r := chi.NewRouter()
	r.Use(ChiMiddleware())
	r.Get("/test", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"message":"ok"}`))
	})

	req := httptest.NewRequest("GET", "/test", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("Expected status 200, got %d", w.Code)
	}
}

func TestChiMiddlewareWithConfig(t *testing.T) {
	config := DefaultChiConfig()
	r := chi.NewRouter()
	r.Use(ChiMiddlewareWithConfig(config))
	r.Get("/test", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"message":"ok"}`))
	})
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"status":"healthy"}`))
	})

	// Test normal endpoint
	req := httptest.NewRequest("GET", "/test", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	// Test skipped endpoint
	req = httptest.NewRequest("GET", "/health", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("Expected status 200 for health, got %d", w.Code)
	}
}

func TestChiMiddlewareExtraFields(t *testing.T) {
	config := ChiConfig{
		Skip: nil,
		ExtraFields: map[string]func(*http.Request) interface{}{
			"custom_header": func(r *http.Request) interface{} {
				return r.Header.Get("X-Custom")
			},
		},
	}

	router := chi.NewRouter()
	router.Use(ChiMiddlewareWithConfig(config))
	router.Get("/test", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"message":"ok"}`))
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("X-Custom", "test-value")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("Expected status 200, got %d", w.Code)
	}
}

func TestChiMiddlewareExtraResultFields(t *testing.T) {
	config := ChiConfig{
		Skip: nil,
		ExtraResultFields: map[string]func(http.ResponseWriter, *http.Request) interface{}{
			"custom_metric": func(w http.ResponseWriter, r *http.Request) interface{} {
				return "test-metric"
			},
		},
	}

	router := chi.NewRouter()
	router.Use(ChiMiddlewareWithConfig(config))
	router.Get("/test", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"message":"ok"}`))
	})

	req := httptest.NewRequest("GET", "/test", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("Expected status 200, got %d", w.Code)
	}
}

func TestChiMiddlewareSkipFunction(t *testing.T) {
	skipCount := 0
	config := ChiConfig{
		Skip: func(r *http.Request) bool {
			skipCount++
			return r.URL.Path == "/skip"
		},
	}

	router := chi.NewRouter()
	router.Use(ChiMiddlewareWithConfig(config))
	router.Get("/skip", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"message":"skipped"}`))
	})
	router.Get("/track", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"message":"tracked"}`))
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

func TestChiDefaultConfig(t *testing.T) {
	config := DefaultChiConfig()

	if config.Skip == nil {
		t.Error("Expected default skip function to be set")
	}

	// Test default skip patterns
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
		result := config.Skip(req)
		if result != tc.shouldSkip {
			t.Errorf("Path %s: expected skip=%v, got %v", tc.path, tc.shouldSkip, result)
		}
	}
}

func TestChiMiddlewareMethods(t *testing.T) {
	router := chi.NewRouter()
	router.Use(ChiMiddleware())
	router.Get("/test", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"message":"get"}`))
	})
	router.Post("/test", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(201)
		w.Write([]byte(`{"message":"post"}`))
	})
	router.Put("/test", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"message":"put"}`))
	})
	router.Delete("/test", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(204)
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

func TestChiMiddlewareError(t *testing.T) {
	router := chi.NewRouter()
	router.Use(ChiMiddleware())
	router.Get("/error", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		w.Write([]byte(`{"error":"internal error"}`))
	})

	req := httptest.NewRequest("GET", "/error", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 500 {
		t.Errorf("Expected status 500, got %d", w.Code)
	}
}

func TestChiMiddlewareNotFound(t *testing.T) {
	router := chi.NewRouter()
	router.Use(ChiMiddleware())

	req := httptest.NewRequest("GET", "/nonexistent", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 404 {
		t.Errorf("Expected status 404, got %d", w.Code)
	}
}

func TestChiMiddlewareRoutePattern(t *testing.T) {
	router := chi.NewRouter()
	router.Use(ChiMiddleware())
	router.Get("/users/{id}", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"message":"ok"}`))
	})

	req := httptest.NewRequest("GET", "/users/123", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("Expected status 200, got %d", w.Code)
	}
}

func TestChiMiddlewareResponseWriter(t *testing.T) {
	router := chi.NewRouter()
	router.Use(ChiMiddleware())
	router.Get("/test", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"message":"test"}`))
	})

	req := httptest.NewRequest("GET", "/test", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	if w.Body.Len() == 0 {
		t.Error("Expected response body to have content")
	}
}

func TestChiMiddlewareRemoteAddr(t *testing.T) {
	router := chi.NewRouter()
	router.Use(ChiMiddleware())
	router.Get("/test", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"message":"ok"}`))
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.RemoteAddr = "1.2.3.4:1234"
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("Expected status 200, got %d", w.Code)
	}
}

func TestChiMiddlewareUserAgent(t *testing.T) {
	router := chi.NewRouter()
	router.Use(ChiMiddleware())
	router.Get("/test", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"message":"ok"}`))
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("User-Agent", "TestAgent/1.0")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("Expected status 200, got %d", w.Code)
	}
}
