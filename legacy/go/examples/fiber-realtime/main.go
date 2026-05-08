package main

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/websocket/v2"
	"github.com/flowtrace/flowtrace-go/flowtrace"
)

// Message represents a chat message
type Message struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Username  string    `json:"username"`
	Content   string    `json:"content"`
	Timestamp time.Time `json:"timestamp"`
}

// Room represents a chat room
type Room struct {
	ID      string
	Name    string
	Clients map[*websocket.Conn]string // conn -> userID
	mu      sync.RWMutex
	ft      *flowtrace.FlowTrace
}

func NewRoom(id, name string, ft *flowtrace.FlowTrace) *Room {
	return &Room{
		ID:      id,
		Name:    name,
		Clients: make(map[*websocket.Conn]string),
		ft:      ft,
	}
}

func (r *Room) AddClient(conn *websocket.Conn, userID string) {
	span := r.ft.StartSpan("room_add_client")
	defer span.End()

	r.mu.Lock()
	defer r.mu.Unlock()

	r.Clients[conn] = userID
	span.SetTag("room_id", r.ID)
	span.SetTag("user_id", userID)
	span.SetTag("total_clients", len(r.Clients))

	log.Printf("Client %s joined room %s (total: %d)", userID, r.ID, len(r.Clients))
}

func (r *Room) RemoveClient(conn *websocket.Conn) {
	span := r.ft.StartSpan("room_remove_client")
	defer span.End()

	r.mu.Lock()
	defer r.mu.Unlock()

	if userID, ok := r.Clients[conn]; ok {
		delete(r.Clients, conn)
		span.SetTag("room_id", r.ID)
		span.SetTag("user_id", userID)
		span.SetTag("total_clients", len(r.Clients))

		log.Printf("Client %s left room %s (total: %d)", userID, r.ID, len(r.Clients))
	}
}

func (r *Room) Broadcast(message *Message, excludeConn *websocket.Conn) {
	span := r.ft.StartSpan("room_broadcast")
	defer span.End()

	r.mu.RLock()
	defer r.mu.RUnlock()

	data, err := json.Marshal(message)
	if err != nil {
		span.SetError(err)
		log.Printf("Failed to marshal message: %v", err)
		return
	}

	successCount := 0
	failCount := 0

	for conn := range r.Clients {
		if conn == excludeConn {
			continue
		}

		if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
			failCount++
			log.Printf("Failed to send message to client: %v", err)
		} else {
			successCount++
		}
	}

	span.SetTag("room_id", r.ID)
	span.SetTag("message_id", message.ID)
	span.SetTag("success_count", successCount)
	span.SetTag("fail_count", failCount)
	span.SetTag("total_recipients", len(r.Clients)-1)
}

// RoomManager manages all chat rooms
type RoomManager struct {
	rooms map[string]*Room
	mu    sync.RWMutex
	ft    *flowtrace.FlowTrace
}

func NewRoomManager(ft *flowtrace.FlowTrace) *RoomManager {
	return &RoomManager{
		rooms: make(map[string]*Room),
		ft:    ft,
	}
}

func (rm *RoomManager) GetOrCreateRoom(roomID, roomName string) *Room {
	span := rm.ft.StartSpan("room_manager_get_or_create")
	defer span.End()

	rm.mu.Lock()
	defer rm.mu.Unlock()

	room, exists := rm.rooms[roomID]
	if !exists {
		room = NewRoom(roomID, roomName, rm.ft)
		rm.rooms[roomID] = room
		span.SetTag("room_created", true)
	} else {
		span.SetTag("room_created", false)
	}

	span.SetTag("room_id", roomID)
	span.SetTag("room_name", roomName)
	span.SetTag("total_rooms", len(rm.rooms))

	return room
}

func (rm *RoomManager) GetRoom(roomID string) (*Room, bool) {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	room, exists := rm.rooms[roomID]
	return room, exists
}

func main() {
	// Initialize FlowTrace
	ft := flowtrace.New(flowtrace.Config{
		ServiceName:    "fiber-realtime-chat",
		ServiceVersion: "1.0.0",
		Environment:    "development",
		OutputFile:     "flowtrace.jsonl",
		BufferSize:     1000,
		SampleRate:     1.0,
	})
	defer ft.Close()

	// Initialize Fiber
	app := fiber.New(fiber.Config{
		ServerHeader: "Fiber",
		AppName:      "FlowTrace Realtime Chat",
	})

	// Add FlowTrace middleware
	app.Use(flowtrace.FiberMiddleware(ft))

	// Initialize room manager
	roomManager := NewRoomManager(ft)

	// REST API endpoints
	app.Get("/api/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "ok"})
	})

	app.Get("/api/rooms", getRoomsHandler(ft, roomManager))
	app.Post("/api/rooms", createRoomHandler(ft, roomManager))

	// WebSocket upgrade middleware
	app.Use("/ws", func(c *fiber.Ctx) error {
		if websocket.IsWebSocketUpgrade(c) {
			return c.Next()
		}
		return fiber.ErrUpgradeRequired
	})

	// WebSocket endpoint
	app.Get("/ws/:roomID", websocket.New(websocketHandler(ft, roomManager)))

	log.Println("Starting Fiber server on :8080")
	if err := app.Listen(":8080"); err != nil {
		log.Fatal(err)
	}
}

func getRoomsHandler(ft *flowtrace.FlowTrace, rm *RoomManager) fiber.Handler {
	return func(c *fiber.Ctx) error {
		span := ft.StartSpan("get_rooms_handler")
		defer span.End()

		rm.mu.RLock()
		defer rm.mu.RUnlock()

		rooms := make([]fiber.Map, 0, len(rm.rooms))
		for id, room := range rm.rooms {
			room.mu.RLock()
			clientCount := len(room.Clients)
			room.mu.RUnlock()

			rooms = append(rooms, fiber.Map{
				"id":           id,
				"name":         room.Name,
				"client_count": clientCount,
			})
		}

		span.SetTag("total_rooms", len(rooms))
		return c.JSON(rooms)
	}
}

func createRoomHandler(ft *flowtrace.FlowTrace, rm *RoomManager) fiber.Handler {
	return func(c *fiber.Ctx) error {
		span := ft.StartSpan("create_room_handler")
		defer span.End()

		var req struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		}

		if err := c.BodyParser(&req); err != nil {
			span.SetError(err)
			return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
		}

		if req.ID == "" || req.Name == "" {
			return c.Status(400).JSON(fiber.Map{"error": "id and name are required"})
		}

		room := rm.GetOrCreateRoom(req.ID, req.Name)

		span.SetTag("room_id", room.ID)
		span.SetTag("room_name", room.Name)

		return c.Status(201).JSON(fiber.Map{
			"id":   room.ID,
			"name": room.Name,
		})
	}
}

func websocketHandler(ft *flowtrace.FlowTrace, rm *RoomManager) func(*websocket.Conn) {
	return func(conn *websocket.Conn) {
		// Start connection span
		connSpan := ft.StartSpan("websocket_connection")
		defer func() {
			connSpan.End()
			conn.Close()
		}()

		roomID := conn.Params("roomID")
		userID := conn.Query("user_id", "anonymous")
		username := conn.Query("username", userID)

		connSpan.SetTag("room_id", roomID)
		connSpan.SetTag("user_id", userID)
		connSpan.SetTag("username", username)

		// Get or create room
		room := rm.GetOrCreateRoom(roomID, roomID)

		// Add client to room
		room.AddClient(conn, userID)
		defer room.RemoveClient(conn)

		// Send join message
		joinMsg := &Message{
			ID:        generateID(),
			UserID:    "system",
			Username:  "System",
			Content:   username + " joined the room",
			Timestamp: time.Now(),
		}
		room.Broadcast(joinMsg, nil)

		// Message handling loop
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		messageCount := 0
		errorCount := 0

		for {
			msgSpan := ft.StartSpan("websocket_message")

			_, msg, err := conn.ReadMessage()
			if err != nil {
				msgSpan.SetError(err)
				msgSpan.SetTag("message_count", messageCount)
				msgSpan.SetTag("error_count", errorCount)
				msgSpan.End()

				if websocket.IsCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
					log.Printf("Client %s disconnected normally", userID)
				} else {
					log.Printf("WebSocket error for client %s: %v", userID, err)
					errorCount++
				}
				break
			}

			messageCount++

			var receivedMsg Message
			if err := json.Unmarshal(msg, &receivedMsg); err != nil {
				msgSpan.SetError(err)
				errorCount++
			} else {
				receivedMsg.ID = generateID()
				receivedMsg.UserID = userID
				receivedMsg.Username = username
				receivedMsg.Timestamp = time.Now()

				msgSpan.SetTag("message_id", receivedMsg.ID)
				msgSpan.SetTag("user_id", userID)
				msgSpan.SetTag("content_length", len(receivedMsg.Content))

				// Broadcast to all clients in room
				broadcastSpan := ft.StartSpan("broadcast_message")
				room.Broadcast(&receivedMsg, conn)
				broadcastSpan.SetTag("room_id", roomID)
				broadcastSpan.SetTag("message_id", receivedMsg.ID)
				broadcastSpan.End()
			}

			msgSpan.End()

			// Check context cancellation
			select {
			case <-ctx.Done():
				return
			default:
			}
		}

		// Send leave message
		leaveMsg := &Message{
			ID:        generateID(),
			UserID:    "system",
			Username:  "System",
			Content:   username + " left the room",
			Timestamp: time.Now(),
		}
		room.Broadcast(leaveMsg, nil)

		connSpan.SetTag("total_messages", messageCount)
		connSpan.SetTag("total_errors", errorCount)
	}
}

func generateID() string {
	return time.Now().Format("20060102150405") + "-" + randomString(8)
}

func randomString(n int) string {
	const letters = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, n)
	for i := range b {
		b[i] = letters[time.Now().UnixNano()%int64(len(letters))]
	}
	return string(b)
}
