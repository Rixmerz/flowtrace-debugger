package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/flowtrace/flowtrace-go/flowtrace"
)

// Service represents a microservice
type Service struct {
	ft     *flowtrace.FlowTrace
	db     *Database
	cache  *Cache
	logger *Logger
}

// Database simulates a database
type Database struct{}

func (db *Database) GetOrder(ctx context.Context, id string) (*Order, error) {
	// Simulate database latency
	time.Sleep(20 * time.Millisecond)
	return &Order{
		ID:         id,
		CustomerID: "cust-123",
		Total:      99.99,
		Status:     "pending",
		CreatedAt:  time.Now(),
	}, nil
}

func (db *Database) CreateOrder(ctx context.Context, order *Order) error {
	time.Sleep(30 * time.Millisecond)
	order.ID = "ord-" + generateID()
	order.CreatedAt = time.Now()
	return nil
}

// Cache simulates a cache layer
type Cache struct{}

func (c *Cache) Get(key string) (interface{}, bool) {
	// Simulate cache miss for demonstration
	return nil, false
}

func (c *Cache) Set(key string, value interface{}, ttl time.Duration) {
	// Cache set operation
}

// Logger provides structured logging
type Logger struct {
	ft *flowtrace.FlowTrace
}

func (l *Logger) Info(ctx context.Context, message string, fields map[string]interface{}) {
	span := l.ft.StartSpan("log_info")
	defer span.End()

	span.SetTag("level", "info")
	span.SetTag("message", message)
	for k, v := range fields {
		span.SetTag(k, v)
	}

	log.Printf("[INFO] %s: %v", message, fields)
}

func (l *Logger) Error(ctx context.Context, message string, err error) {
	span := l.ft.StartSpan("log_error")
	defer span.End()

	span.SetTag("level", "error")
	span.SetTag("message", message)
	span.SetError(err)

	log.Printf("[ERROR] %s: %v", message, err)
}

// Order represents an order
type Order struct {
	ID         string    `json:"id"`
	CustomerID string    `json:"customer_id"`
	Total      float64   `json:"total"`
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"created_at"`
}

func main() {
	// Initialize FlowTrace
	ft := flowtrace.New(flowtrace.Config{
		ServiceName:    "chi-microservice",
		ServiceVersion: "1.0.0",
		Environment:    "production",
		OutputFile:     "flowtrace.jsonl",
		BufferSize:     1000,
		SampleRate:     0.1, // Sample 10% in production
		Rules: []flowtrace.SamplingRule{
			{Path: "/health", Rate: 0.01},
			{Path: "/metrics", Rate: 0.0},
		},
	})
	defer ft.Close()

	// Initialize service dependencies
	svc := &Service{
		ft:     ft,
		db:     &Database{},
		cache:  &Cache{},
		logger: &Logger{ft: ft},
	}

	// Create router
	r := chi.NewRouter()

	// Standard middleware
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(60 * time.Second))

	// FlowTrace middleware
	r.Use(flowtrace.ChiMiddleware(ft))

	// Custom tracing middleware
	r.Use(svc.tracingMiddleware)

	// Health and metrics (low sampling)
	r.Get("/health", svc.healthHandler)
	r.Get("/metrics", svc.metricsHandler)

	// API routes
	r.Route("/api/v1", func(r chi.Router) {
		// Orders
		r.Route("/orders", func(r chi.Router) {
			r.Post("/", svc.createOrderHandler)
			r.Get("/{orderID}", svc.getOrderHandler)
			r.Put("/{orderID}/status", svc.updateOrderStatusHandler)
		})

		// Customers
		r.Route("/customers", func(r chi.Router) {
			r.Get("/{customerID}/orders", svc.getCustomerOrdersHandler)
		})
	})

	log.Println("Starting Chi microservice on :8080")
	if err := http.ListenAndServe(":8080", r); err != nil {
		log.Fatal(err)
	}
}

// tracingMiddleware adds custom tracing context
func (s *Service) tracingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		span := s.ft.StartSpan("middleware_tracing")
		defer span.End()

		// Add request context tags
		span.SetTag("request_id", middleware.GetReqID(r.Context()))
		span.SetTag("real_ip", r.RemoteAddr)

		// Continue chain
		next.ServeHTTP(w, r)
	})
}

// healthHandler checks service health
func (s *Service) healthHandler(w http.ResponseWriter, r *http.Request) {
	span := s.ft.StartSpan("health_check")
	defer span.End()

	health := map[string]interface{}{
		"status":    "ok",
		"timestamp": time.Now().Unix(),
		"version":   "1.0.0",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(health)
}

// metricsHandler returns service metrics
func (s *Service) metricsHandler(w http.ResponseWriter, r *http.Request) {
	metrics := map[string]interface{}{
		"requests_total":   12345,
		"errors_total":     42,
		"avg_response_ms":  125,
		"cache_hit_rate":   0.85,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(metrics)
}

// createOrderHandler creates a new order
func (s *Service) createOrderHandler(w http.ResponseWriter, r *http.Request) {
	span := s.ft.StartSpan("create_order_handler")
	defer span.End()

	ctx := r.Context()

	// Parse request
	var order Order
	if err := json.NewDecoder(r.Body).Decode(&order); err != nil {
		span.SetError(err)
		s.logger.Error(ctx, "failed to parse request", err)
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	span.SetTag("customer_id", order.CustomerID)
	span.SetTag("total", order.Total)

	// Validate order
	validateSpan := s.ft.StartSpan("validate_order")
	if order.CustomerID == "" || order.Total <= 0 {
		err := http.ErrBodyNotAllowed
		validateSpan.SetError(err)
		validateSpan.End()
		span.SetError(err)
		http.Error(w, "invalid order data", http.StatusBadRequest)
		return
	}
	validateSpan.End()

	// Create order in database
	dbSpan := s.ft.StartSpan("database_create_order")
	if err := s.db.CreateOrder(ctx, &order); err != nil {
		dbSpan.SetError(err)
		dbSpan.End()
		span.SetError(err)
		s.logger.Error(ctx, "failed to create order", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	dbSpan.SetTag("order_id", order.ID)
	dbSpan.End()

	// Cache the order
	cacheSpan := s.ft.StartSpan("cache_set_order")
	s.cache.Set("order:"+order.ID, order, 5*time.Minute)
	cacheSpan.End()

	// Log success
	s.logger.Info(ctx, "order created", map[string]interface{}{
		"order_id":    order.ID,
		"customer_id": order.CustomerID,
		"total":       order.Total,
	})

	span.SetTag("order_created", true)
	span.SetTag("order_id", order.ID)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(order)
}

// getOrderHandler retrieves an order
func (s *Service) getOrderHandler(w http.ResponseWriter, r *http.Request) {
	span := s.ft.StartSpan("get_order_handler")
	defer span.End()

	ctx := r.Context()
	orderID := chi.URLParam(r, "orderID")

	span.SetTag("order_id", orderID)

	// Check cache first
	cacheSpan := s.ft.StartSpan("cache_get_order")
	if cached, ok := s.cache.Get("order:" + orderID); ok {
		cacheSpan.SetTag("cache_hit", true)
		cacheSpan.End()

		span.SetTag("from_cache", true)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(cached)
		return
	}
	cacheSpan.SetTag("cache_hit", false)
	cacheSpan.End()

	// Get from database
	dbSpan := s.ft.StartSpan("database_get_order")
	order, err := s.db.GetOrder(ctx, orderID)
	if err != nil {
		dbSpan.SetError(err)
		dbSpan.End()
		span.SetError(err)
		s.logger.Error(ctx, "failed to get order", err)
		http.Error(w, "order not found", http.StatusNotFound)
		return
	}
	dbSpan.End()

	// Cache for future requests
	cacheSetSpan := s.ft.StartSpan("cache_set_order")
	s.cache.Set("order:"+orderID, order, 5*time.Minute)
	cacheSetSpan.End()

	span.SetTag("from_database", true)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(order)
}

// updateOrderStatusHandler updates order status
func (s *Service) updateOrderStatusHandler(w http.ResponseWriter, r *http.Request) {
	span := s.ft.StartSpan("update_order_status_handler")
	defer span.End()

	ctx := r.Context()
	orderID := chi.URLParam(r, "orderID")

	span.SetTag("order_id", orderID)

	var req struct {
		Status string `json:"status"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		span.SetError(err)
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	span.SetTag("new_status", req.Status)

	// Simulate status update
	time.Sleep(25 * time.Millisecond)

	// Invalidate cache
	cacheSpan := s.ft.StartSpan("cache_invalidate")
	// s.cache.Delete("order:" + orderID)
	cacheSpan.End()

	s.logger.Info(ctx, "order status updated", map[string]interface{}{
		"order_id": orderID,
		"status":   req.Status,
	})

	w.WriteHeader(http.StatusNoContent)
}

// getCustomerOrdersHandler retrieves all orders for a customer
func (s *Service) getCustomerOrdersHandler(w http.ResponseWriter, r *http.Request) {
	span := s.ft.StartSpan("get_customer_orders_handler")
	defer span.End()

	customerID := chi.URLParam(r, "customerID")
	span.SetTag("customer_id", customerID)

	// Simulate fetching multiple orders
	dbSpan := s.ft.StartSpan("database_get_customer_orders")
	time.Sleep(50 * time.Millisecond)
	dbSpan.SetTag("customer_id", customerID)
	dbSpan.SetTag("orders_count", 3)
	dbSpan.End()

	orders := []Order{
		{ID: "ord-1", CustomerID: customerID, Total: 99.99, Status: "pending"},
		{ID: "ord-2", CustomerID: customerID, Total: 149.99, Status: "completed"},
		{ID: "ord-3", CustomerID: customerID, Total: 49.99, Status: "shipped"},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(orders)
}

func generateID() string {
	return time.Now().Format("20060102150405")
}
