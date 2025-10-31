package frameworks

import (
	"net/http"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func TestFiberMiddleware(t *testing.T) {
	app := fiber.New()
	app.Use(FiberMiddleware())
	app.Get("/test", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"message": "ok"})
	})

	req, _ := http.NewRequest("GET", "/test", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("Test request failed: %v", err)
	}

	if resp.StatusCode != 200 {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}
}

func TestFiberMiddlewareWithConfig(t *testing.T) {
	config := DefaultFiberConfig()
	app := fiber.New()
	app.Use(FiberMiddlewareWithConfig(config))
	app.Get("/test", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"message": "ok"})
	})
	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "healthy"})
	})

	// Test normal endpoint
	req, _ := http.NewRequest("GET", "/test", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("Test request failed: %v", err)
	}

	if resp.StatusCode != 200 {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}

	// Test skipped endpoint
	req, _ = http.NewRequest("GET", "/health", nil)
	resp, err = app.Test(req)
	if err != nil {
		t.Fatalf("Test request failed: %v", err)
	}

	if resp.StatusCode != 200 {
		t.Errorf("Expected status 200 for health, got %d", resp.StatusCode)
	}
}

func TestFiberMiddlewareExtraFields(t *testing.T) {
	config := FiberConfig{
		Skip: nil,
		ExtraFields: map[string]func(*fiber.Ctx) interface{}{
			"custom_header": func(c *fiber.Ctx) interface{} {
				return string(c.Request().Header.Peek("X-Custom"))
			},
		},
	}

	app := fiber.New()
	app.Use(FiberMiddlewareWithConfig(config))
	app.Get("/test", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"message": "ok"})
	})

	req, _ := http.NewRequest("GET", "/test", nil)
	req.Header.Set("X-Custom", "test-value")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("Test request failed: %v", err)
	}

	if resp.StatusCode != 200 {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}
}

func TestFiberMiddlewareExtraResultFields(t *testing.T) {
	config := FiberConfig{
		Skip: nil,
		ExtraResultFields: map[string]func(*fiber.Ctx) interface{}{
			"response_length": func(c *fiber.Ctx) interface{} {
				return len(c.Response().Body())
			},
		},
	}

	app := fiber.New()
	app.Use(FiberMiddlewareWithConfig(config))
	app.Get("/test", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"message": "ok"})
	})

	req, _ := http.NewRequest("GET", "/test", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("Test request failed: %v", err)
	}

	if resp.StatusCode != 200 {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}
}

func TestFiberMiddlewareSkipFunction(t *testing.T) {
	skipCount := 0
	config := FiberConfig{
		Skip: func(c *fiber.Ctx) bool {
			skipCount++
			return c.Path() == "/skip"
		},
	}

	app := fiber.New()
	app.Use(FiberMiddlewareWithConfig(config))
	app.Get("/skip", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"message": "skipped"})
	})
	app.Get("/track", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"message": "tracked"})
	})

	// Request to skipped endpoint
	req, _ := http.NewRequest("GET", "/skip", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("Test request failed: %v", err)
	}

	if resp.StatusCode != 200 {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}

	// Request to tracked endpoint
	req, _ = http.NewRequest("GET", "/track", nil)
	resp, err = app.Test(req)
	if err != nil {
		t.Fatalf("Test request failed: %v", err)
	}

	if resp.StatusCode != 200 {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}

	if skipCount != 2 {
		t.Errorf("Expected skip function to be called 2 times, got %d", skipCount)
	}
}

func TestFiberDefaultConfig(t *testing.T) {
	config := DefaultFiberConfig()

	if config.Skip == nil {
		t.Error("Expected default skip function to be set")
	}

	// Test default skip patterns
	app := fiber.New()

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
		app.Get(tc.path, func(c *fiber.Ctx) error {
			return c.SendString("ok")
		})

		req, _ := http.NewRequest("GET", tc.path, nil)
		resp, err := app.Test(req)
		if err != nil {
			t.Fatalf("Test request failed: %v", err)
		}

		if resp.StatusCode != 200 {
			t.Errorf("Path %s: expected status 200, got %d", tc.path, resp.StatusCode)
		}
	}
}

func TestFiberMiddlewareMethods(t *testing.T) {
	app := fiber.New()
	app.Use(FiberMiddleware())
	app.Get("/test", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"message": "get"})
	})
	app.Post("/test", func(c *fiber.Ctx) error {
		return c.Status(201).JSON(fiber.Map{"message": "post"})
	})
	app.Put("/test", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"message": "put"})
	})
	app.Delete("/test", func(c *fiber.Ctx) error {
		return c.SendStatus(204)
	})

	methods := []string{"GET", "POST", "PUT", "DELETE"}
	for _, method := range methods {
		req, _ := http.NewRequest(method, "/test", nil)
		resp, err := app.Test(req)
		if err != nil {
			t.Fatalf("Method %s: test request failed: %v", method, err)
		}

		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			t.Errorf("Method %s: expected 2xx status, got %d", method, resp.StatusCode)
		}
	}
}

func TestFiberMiddlewareError(t *testing.T) {
	app := fiber.New()
	app.Use(FiberMiddleware())
	app.Get("/error", func(c *fiber.Ctx) error {
		return c.Status(500).JSON(fiber.Map{"error": "internal error"})
	})

	req, _ := http.NewRequest("GET", "/error", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("Test request failed: %v", err)
	}

	if resp.StatusCode != 500 {
		t.Errorf("Expected status 500, got %d", resp.StatusCode)
	}
}

func TestFiberMiddlewareNotFound(t *testing.T) {
	app := fiber.New()
	app.Use(FiberMiddleware())

	req, _ := http.NewRequest("GET", "/nonexistent", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("Test request failed: %v", err)
	}

	if resp.StatusCode != 404 {
		t.Errorf("Expected status 404, got %d", resp.StatusCode)
	}
}

func TestFiberMiddlewareWithBody(t *testing.T) {
	app := fiber.New()
	app.Use(FiberMiddleware())
	app.Post("/test", func(c *fiber.Ctx) error {
		body := c.Body()
		return c.JSON(fiber.Map{"received": len(body)})
	})

	req, _ := http.NewRequest("POST", "/test", nil)
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("Test request failed: %v", err)
	}

	if resp.StatusCode != 200 {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}
}

func TestFiberMiddlewareClientIP(t *testing.T) {
	app := fiber.New()
	app.Use(FiberMiddleware())
	app.Get("/test", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"ip": c.IP()})
	})

	req, _ := http.NewRequest("GET", "/test", nil)
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("Test request failed: %v", err)
	}

	if resp.StatusCode != 200 {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}
}
