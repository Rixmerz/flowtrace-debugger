package main

import (
	"log"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/flowtrace/flowtrace-go/flowtrace"
)

// User represents a user in the system
type User struct {
	ID        int       `json:"id"`
	Name      string    `json:"name"`
	Email     string    `json:"email"`
	CreatedAt time.Time `json:"created_at"`
}

// Database simulates a database
type Database struct {
	users map[int]*User
}

func NewDatabase() *Database {
	return &Database{
		users: map[int]*User{
			1: {ID: 1, Name: "Alice", Email: "alice@example.com", CreatedAt: time.Now()},
			2: {ID: 2, Name: "Bob", Email: "bob@example.com", CreatedAt: time.Now()},
		},
	}
}

func (db *Database) GetUser(id int) (*User, error) {
	user, ok := db.users[id]
	if !ok {
		return nil, gin.Error{Err: ErrUserNotFound, Type: gin.ErrorTypePublic}
	}
	return user, nil
}

func (db *Database) CreateUser(user *User) error {
	user.ID = len(db.users) + 1
	user.CreatedAt = time.Now()
	db.users[user.ID] = user
	return nil
}

var ErrUserNotFound = gin.Error{Err: errors.New("user not found"), Type: gin.ErrorTypePublic}

func main() {
	// Initialize FlowTrace with advanced configuration
	ft := flowtrace.New(flowtrace.Config{
		ServiceName:    "gin-advanced-api",
		ServiceVersion: "1.0.0",
		Environment:    "development",
		OutputFile:     "flowtrace.jsonl",
		BufferSize:     500,
		SampleRate:     1.0,
		Rules: []flowtrace.SamplingRule{
			{Path: "/health", Rate: 0.1},
			{Path: "/metrics", Rate: 0.0},
		},
		Exclusions: flowtrace.Exclusions{
			Packages:  []string{"vendor/*"},
			Functions: []string{"init"},
		},
	})
	defer ft.Close()

	// Initialize Gin
	r := gin.Default()

	// Add FlowTrace middleware with custom configuration
	r.Use(flowtrace.GinMiddleware(ft))

	// Initialize database
	db := NewDatabase()

	// Health check endpoint (sampled at 10%)
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// Metrics endpoint (not sampled)
	r.GET("/metrics", func(c *gin.Context) {
		c.JSON(200, gin.H{"metrics": "data"})
	})

	// User endpoints with manual tracing
	r.GET("/users/:id", getUserHandler(ft, db))
	r.POST("/users", createUserHandler(ft, db))
	r.GET("/users/:id/profile", getUserProfileHandler(ft, db))

	log.Println("Starting Gin server on :8080")
	if err := r.Run(":8080"); err != nil {
		log.Fatal(err)
	}
}

func getUserHandler(ft *flowtrace.FlowTrace, db *Database) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Start a custom span for the handler
		span := ft.StartSpan("get_user_handler")
		defer span.End()

		id := c.Param("id")
		span.SetTag("user_id", id)

		// Parse user ID
		var userID int
		if _, err := fmt.Sscanf(id, "%d", &userID); err != nil {
			span.SetError(err)
			c.JSON(400, gin.H{"error": "invalid user ID"})
			return
		}

		// Database operation span
		dbSpan := ft.StartSpan("database_get_user")
		user, err := db.GetUser(userID)
		dbSpan.SetTag("user_id", userID)
		if err != nil {
			dbSpan.SetError(err)
		}
		dbSpan.End()

		if err != nil {
			span.SetError(err)
			c.JSON(404, gin.H{"error": "user not found"})
			return
		}

		span.SetTag("user_found", true)
		c.JSON(200, user)
	}
}

func createUserHandler(ft *flowtrace.FlowTrace, db *Database) gin.HandlerFunc {
	return func(c *gin.Context) {
		span := ft.StartSpan("create_user_handler")
		defer span.End()

		var user User
		if err := c.ShouldBindJSON(&user); err != nil {
			span.SetError(err)
			c.JSON(400, gin.H{"error": "invalid request body"})
			return
		}

		span.SetTag("user_name", user.Name)
		span.SetTag("user_email", user.Email)

		// Validate user
		validateSpan := ft.StartSpan("validate_user")
		if user.Name == "" || user.Email == "" {
			err := errors.New("name and email are required")
			validateSpan.SetError(err)
			validateSpan.End()
			span.SetError(err)
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}
		validateSpan.End()

		// Create user
		dbSpan := ft.StartSpan("database_create_user")
		if err := db.CreateUser(&user); err != nil {
			dbSpan.SetError(err)
			dbSpan.End()
			span.SetError(err)
			c.JSON(500, gin.H{"error": "failed to create user"})
			return
		}
		dbSpan.SetTag("user_id", user.ID)
		dbSpan.End()

		span.SetTag("user_created", true)
		span.SetTag("new_user_id", user.ID)

		c.JSON(201, user)
	}
}

func getUserProfileHandler(ft *flowtrace.FlowTrace, db *Database) gin.HandlerFunc {
	return func(c *gin.Context) {
		span := ft.StartSpan("get_user_profile_handler")
		defer span.End()

		id := c.Param("id")
		span.SetTag("user_id", id)

		var userID int
		if _, err := fmt.Sscanf(id, "%d", &userID); err != nil {
			span.SetError(err)
			c.JSON(400, gin.H{"error": "invalid user ID"})
			return
		}

		// Get user
		dbSpan := ft.StartSpan("database_get_user")
		user, err := db.GetUser(userID)
		dbSpan.SetTag("user_id", userID)
		if err != nil {
			dbSpan.SetError(err)
		}
		dbSpan.End()

		if err != nil {
			span.SetError(err)
			c.JSON(404, gin.H{"error": "user not found"})
			return
		}

		// Simulate external API call
		externalSpan := ft.StartSpan("external_api_call")
		externalSpan.SetTag("api", "profile_enrichment")
		time.Sleep(50 * time.Millisecond) // Simulate API latency
		externalSpan.End()

		// Build profile response
		profile := gin.H{
			"user":          user,
			"profile_views": 123,
			"last_active":   time.Now().Add(-2 * time.Hour),
		}

		span.SetTag("profile_enriched", true)
		c.JSON(200, profile)
	}
}
