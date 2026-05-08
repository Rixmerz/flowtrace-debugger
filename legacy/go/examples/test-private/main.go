package main

import (
	"fmt"
	"time"

	"github.com/rixmerz/flowtrace-agent-go/flowtrace"
)

// User represents a user entity
type User struct {
	ID    int
	Name  string
	Email string
}

// Order represents an order entity
type Order struct {
	ID     int
	Amount float64
	Status string
}

// UserService handles user operations
type UserService struct {
	users map[int]User
}

// NewUserService creates a new UserService
func NewUserService() *UserService {
	return &UserService{
		users: map[int]User{
			42:  {ID: 42, Name: "User42", Email: "user42@example.com"},
			999: {ID: 999, Name: "Invalid", Email: "not-an-email"},
		},
	}
}

// LoadUser loads a user by ID (EXPORTED - public)
func (s *UserService) LoadUser(userID int) (User, error) {
	flowtrace.TraceEnter("main.UserService", "LoadUser", map[string]interface{}{"userID": userID})
	defer flowtrace.TraceExit("main.UserService", "LoadUser", nil)

	fmt.Printf("\n[EXPORTED] LoadUser(%d)\n", userID)

	sleep(50)
	s.validateUserID(userID)
	return s.internalLoad(userID)
}

// SaveUser saves a user (EXPORTED - public)
func (s *UserService) SaveUser(user User) error {
	flowtrace.TraceEnter("main.UserService", "SaveUser", map[string]interface{}{"user": user})
	defer flowtrace.TraceExit("main.UserService", "SaveUser", nil)

	fmt.Printf("\n[EXPORTED] SaveUser(%s)\n", user.Name)

	sleep(30)

	if !s.isValidEmail(user.Email) {
		return fmt.Errorf("invalid email: %s", user.Email)
	}

	s.users[user.ID] = user
	return nil
}

// validateUserID validates a user ID (unexported - private)
func (s *UserService) validateUserID(userID int) {
	flowtrace.TraceEnter("main.UserService", "validateUserID", map[string]interface{}{"userID": userID})
	defer flowtrace.TraceExit("main.UserService", "validateUserID", nil)

	fmt.Printf("  [unexported] validateUserID(%d)\n", userID)

	if userID <= 0 {
		panic(fmt.Sprintf("invalid user ID: %d", userID))
	}
}

// isValidEmail checks if email is valid (unexported - private)
func (s *UserService) isValidEmail(email string) bool {
	flowtrace.TraceEnter("main.UserService", "isValidEmail", map[string]interface{}{"email": email})
	defer flowtrace.TraceExit("main.UserService", "isValidEmail", email != "" && len(email) > 3)

	fmt.Printf("  [unexported] isValidEmail(%s)\n", email)

	return email != "" && len(email) > 3 && contains(email, "@")
}

// internalLoad loads user from storage (unexported - private)
func (s *UserService) internalLoad(userID int) (User, error) {
	flowtrace.TraceEnter("main.UserService", "internalLoad", map[string]interface{}{"userID": userID})

	fmt.Printf("  [unexported] internalLoad(%d)\n", userID)

	user, exists := s.users[userID]
	if !exists {
		flowtrace.TraceExit("main.UserService", "internalLoad", nil)
		return User{}, fmt.Errorf("user not found: %d", userID)
	}

	flowtrace.TraceExit("main.UserService", "internalLoad", user)
	return user, nil
}

// OrderService handles order operations
type OrderService struct{}

// NewOrderService creates a new OrderService
func NewOrderService() *OrderService {
	return &OrderService{}
}

// ProcessOrder processes an order (EXPORTED - public)
func (s *OrderService) ProcessOrder(orderID int, amount float64) (Order, error) {
	flowtrace.TraceEnter("main.OrderService", "ProcessOrder", map[string]interface{}{
		"orderID": orderID,
		"amount":  amount,
	})

	fmt.Printf("\n[EXPORTED] ProcessOrder(%d, %.2f)\n", orderID, amount)

	s.validateAmount(amount)
	sleep(100)

	order := Order{
		ID:     orderID,
		Amount: amount,
		Status: "COMPLETED",
	}

	flowtrace.TraceExit("main.OrderService", "ProcessOrder", order)
	return order, nil
}

// CancelOrder cancels an order (EXPORTED - public)
func (s *OrderService) CancelOrder(orderID int) {
	flowtrace.TraceEnter("main.OrderService", "CancelOrder", map[string]interface{}{"orderID": orderID})
	defer flowtrace.TraceExit("main.OrderService", "CancelOrder", nil)

	fmt.Printf("\n[EXPORTED] CancelOrder(%d)\n", orderID)

	sleep(30)
	s.internalAudit(orderID)
}

// validateAmount validates order amount (unexported - private)
func (s *OrderService) validateAmount(amount float64) {
	flowtrace.TraceEnter("main.OrderService", "validateAmount", map[string]interface{}{"amount": amount})
	defer flowtrace.TraceExit("main.OrderService", "validateAmount", nil)

	fmt.Printf("  [unexported] validateAmount(%.2f)\n", amount)

	if amount <= 0 {
		panic(fmt.Sprintf("amount must be positive: %.2f", amount))
	}
}

// internalAudit performs internal audit (unexported - private)
func (s *OrderService) internalAudit(orderID int) {
	flowtrace.TraceEnter("main.OrderService", "internalAudit", map[string]interface{}{"orderID": orderID})
	defer flowtrace.TraceExit("main.OrderService", "internalAudit", nil)

	fmt.Printf("  [unexported] internalAudit(%d)\n", orderID)
	fmt.Printf("    Auditing order %d\n", orderID)
}

// Helper functions (unexported - private)

// sleep simulates delay (unexported - private)
func sleep(millis int) {
	flowtrace.TraceEnter("main", "sleep", map[string]interface{}{"millis": millis})
	defer flowtrace.TraceExit("main", "sleep", nil)

	fmt.Printf("  [unexported] sleep(%dms)\n", millis)
	time.Sleep(time.Duration(millis) * time.Millisecond)
}

// contains checks if string contains substring (unexported - private)
func contains(s, substr string) bool {
	flowtrace.TraceEnter("main", "contains", map[string]interface{}{"s": s, "substr": substr})
	defer flowtrace.TraceExit("main", "contains", len(s) > 0 && len(substr) > 0)

	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

// Test scenarios

func runUserScenario() {
	flowtrace.TraceEnter("main", "runUserScenario", map[string]interface{}{})
	defer flowtrace.TraceExit("main", "runUserScenario", nil)

	fmt.Println("\n" + "============================================================")
	fmt.Println("SCENARIO 1: User Service - Success Case")
	fmt.Println("============================================================")

	service := NewUserService()

	// Test 1: Load user (should call unexported functions)
	user, err := service.LoadUser(42)
	if err != nil {
		fmt.Printf("❌ Error: %v\n", err)
	} else {
		fmt.Printf("✅ Loaded user: %+v\n", user)
	}

	// Test 2: Save user (should call unexported functions)
	err = service.SaveUser(user)
	if err != nil {
		fmt.Printf("❌ Error: %v\n", err)
	} else {
		fmt.Printf("✅ Saved user: %s\n", user.Name)
	}
}

func runOrderScenario() {
	flowtrace.TraceEnter("main", "runOrderScenario", map[string]interface{}{})
	defer flowtrace.TraceExit("main", "runOrderScenario", nil)

	fmt.Println("\n" + "============================================================")
	fmt.Println("SCENARIO 2: Order Service")
	fmt.Println("============================================================")

	service := NewOrderService()

	// Test 3: Process order (should call validateAmount)
	order, err := service.ProcessOrder(101, 99.99)
	if err != nil {
		fmt.Printf("❌ Error: %v\n", err)
	} else {
		fmt.Printf("✅ Processed order: %+v\n", order)
	}

	// Test 4: Cancel order (should call internalAudit)
	service.CancelOrder(101)
	fmt.Println("✅ Cancelled order 101")
}

func runErrorScenario() {
	flowtrace.TraceEnter("main", "runErrorScenario", map[string]interface{}{})
	defer flowtrace.TraceExit("main", "runErrorScenario", nil)

	fmt.Println("\n" + "============================================================")
	fmt.Println("SCENARIO 3: Error Handling")
	fmt.Println("============================================================")

	service := NewUserService()

	// Test 5: Invalid email (should call isValidEmail and return error)
	invalidUser := User{ID: 999, Name: "Invalid", Email: "not-an-email"}
	err := service.SaveUser(invalidUser)
	if err != nil {
		fmt.Printf("❌ Expected error: %v\n", err)
	}

	// Test 6: Invalid user ID (should call validateUserID and panic)
	defer func() {
		if r := recover(); r != nil {
			fmt.Printf("❌ Expected panic: %v\n", r)
		}
	}()
	_, _ = service.LoadUser(-1)
}

func main() {
	fmt.Println("\n" + "============================================================")
	fmt.Println("FlowTrace Go Agent - Unexported Functions Test")
	fmt.Println("============================================================")

	// Configure FlowTrace
	config := flowtrace.Config{
		LogFile: "flowtrace-go-private.jsonl",
	}

	err := flowtrace.Start(config)
	if err != nil {
		fmt.Printf("❌ Failed to start FlowTrace: %v\n", err)
		return
	}
	defer flowtrace.Stop()

	fmt.Println("\n📊 FlowTrace Configuration:")
	fmt.Printf("  - Log file: %s\n", config.LogFile)
	fmt.Println("\n✅ FlowTrace agent started")

	// Run test scenarios
	runUserScenario()
	runOrderScenario()
	runErrorScenario()

	fmt.Println("\n" + "============================================================")
	fmt.Println("Test Execution Complete")
	fmt.Println("============================================================")
	fmt.Printf("\n📄 Trace logs written to: %s\n", config.LogFile)
	fmt.Println("\n💡 Analyze logs:")
	fmt.Printf("  cat %s | jq .\n", config.LogFile)
	fmt.Printf("  cat %s | jq -r '.method' | sort | uniq\n", config.LogFile)
}
