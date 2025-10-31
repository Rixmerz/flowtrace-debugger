# FlowTrace .NET Agent - Minimal API Realtime WebSocket Chat

Real-time WebSocket chat application demonstrating FlowTrace instrumentation for concurrent real-time communications.

## Features

- ✅ **Real-time WebSockets**: Bidirectional communication with multiple clients
- ✅ **Chat Rooms**: Multi-room support with room management
- ✅ **Concurrent Clients**: Handle multiple simultaneous connections
- ✅ **Message Broadcasting**: Efficient message distribution to room participants
- ✅ **Connection Lifecycle**: Join/leave notifications and cleanup
- ✅ **Method Tracing**: All chat operations traced with [Trace] attribute
- ✅ **Async WebSocket Handling**: Full async/await for WebSocket operations

## Architecture

```
WebSocket Client
    ↓
[WebSocket Handshake]
    ↓
[ChatService.HandleWebSocketConnection] → [Trace] ENTER
    ↓
[Welcome Message] → [Trace] SendMessageToClient
    ↓
[Broadcast Join] → [Trace] BroadcastToRoom
    ↓
[Message Loop] → [Trace] ReceiveMessages
    ↓    ↓
    |    [BroadcastToRoom] → [Trace] per message
    ↓
[Disconnect Cleanup]
    ↓
[Broadcast Leave] → [Trace] BroadcastToRoom
```

## Running the Example

```bash
cd examples/MinimalApiRealtime
dotnet build
dotnet run
```

The server will start on http://localhost:5001

## Testing with wscat

Install wscat (WebSocket client):
```bash
npm install -g wscat
```

### Connect Multiple Clients

**Terminal 1** (Alice):
```bash
wscat -c ws://localhost:5001/ws/general/Alice
```

**Terminal 2** (Bob):
```bash
wscat -c ws://localhost:5001/ws/general/Bob
```

**Terminal 3** (Charlie):
```bash
wscat -c ws://localhost:5001/ws/general/Charlie
```

### Example Chat Session

**Alice connects**:
```
Connected (press CTRL+C to quit)
< {"Type":"system","RoomId":"general","Username":"System","Content":"Welcome to General Chat, Alice!","Timestamp":"2024-01-15T10:30:00Z"}
```

**Bob connects**:
```
Connected (press CTRL+C to quit)
< {"Type":"system","RoomId":"general","Username":"System","Content":"Welcome to General Chat, Bob!","Timestamp":"2024-01-15T10:30:05Z"}
```

**Alice receives** (in Alice's terminal):
```
< {"Type":"join","RoomId":"general","Username":"Bob","Content":"Bob joined the room","Timestamp":"2024-01-15T10:30:05Z"}
```

**Alice sends a message**:
```
> Hello everyone!
```

**Bob receives**:
```
< {"Type":"message","RoomId":"general","Username":"Alice","Content":"Hello everyone!","Timestamp":"2024-01-15T10:30:10Z"}
```

**Bob replies**:
```
> Hi Alice!
```

**Alice receives**:
```
< {"Type":"message","RoomId":"general","Username":"Bob","Content":"Hi Alice!","Timestamp":"2024-01-15T10:30:12Z"}
```

**Charlie connects and everyone is notified**:
```
< {"Type":"join","RoomId":"general","Username":"Charlie","Content":"Charlie joined the room","Timestamp":"2024-01-15T10:30:15Z"}
```

## REST API Endpoints

### List Rooms
```bash
curl http://localhost:5001/rooms
```

**Response**:
```json
[
  {
    "id": "general",
    "name": "General Chat",
    "createdAt": "2024-01-15T10:00:00Z",
    "activeUsers": 3
  }
]
```

### Create Room
```bash
curl -X POST http://localhost:5001/rooms \
  -H 'Content-Type: application/json' \
  -d '{"name": "Tech Talk"}'
```

**Response** (201 Created):
```json
{
  "id": "a1b2c3d4",
  "name": "Tech Talk",
  "createdAt": "2024-01-15T10:30:00Z",
  "activeUsers": 0
}
```

## Message Types

### System Message
Sent when a user connects:
```json
{
  "Type": "system",
  "RoomId": "general",
  "Username": "System",
  "Content": "Welcome to General Chat, Alice!",
  "Timestamp": "2024-01-15T10:30:00Z"
}
```

### Join Message
Broadcast when a user joins:
```json
{
  "Type": "join",
  "RoomId": "general",
  "Username": "Bob",
  "Content": "Bob joined the room",
  "Timestamp": "2024-01-15T10:30:05Z"
}
```

### Chat Message
Normal user message:
```json
{
  "Type": "message",
  "RoomId": "general",
  "Username": "Alice",
  "Content": "Hello everyone!",
  "Timestamp": "2024-01-15T10:30:10Z"
}
```

### Leave Message
Broadcast when a user disconnects:
```json
{
  "Type": "leave",
  "RoomId": "general",
  "Username": "Alice",
  "Content": "Alice left the room",
  "Timestamp": "2024-01-15T10:35:00Z"
}
```

### Error Message
Sent on connection errors:
```json
{
  "Type": "error",
  "RoomId": "invalid-room",
  "Username": "System",
  "Content": "Room 'invalid-room' not found",
  "Timestamp": "2024-01-15T10:30:00Z"
}
```

## Trace Output

### WebSocket Connection - ENTER
```json
{
  "timestamp": 1705318200000,
  "event": "ENTER",
  "thread": "42",
  "class": "ChatService",
  "function": "HandleWebSocketConnection",
  "args": "{\"roomId\":\"general\",\"username\":\"Alice\"}"
}
```

### Send Welcome Message
```json
{
  "timestamp": 1705318200050,
  "event": "ENTER",
  "thread": "42",
  "class": "ChatService",
  "function": "SendMessageToClient",
  "args": "{\"message\":{\"Type\":\"system\",\"Content\":\"Welcome to General Chat, Alice!\"}}"
}
```

### Broadcast Join
```json
{
  "timestamp": 1705318200100,
  "event": "ENTER",
  "thread": "42",
  "class": "ChatService",
  "function": "BroadcastToRoom",
  "args": "{\"roomId\":\"general\",\"message\":{\"Type\":\"join\",\"Username\":\"Alice\"}}"
}
```

### Message Received
```json
{
  "timestamp": 1705318210000,
  "event": "ENTER",
  "thread": "43",
  "class": "ChatService",
  "function": "BroadcastToRoom",
  "args": "{\"roomId\":\"general\",\"message\":{\"Type\":\"message\",\"Username\":\"Alice\",\"Content\":\"Hello everyone!\"}}"
}
```

### Broadcast Complete
```json
{
  "timestamp": 1705318210025,
  "event": "EXIT",
  "thread": "43",
  "class": "ChatService",
  "function": "BroadcastToRoom",
  "result": "void",
  "durationMicros": 25000,
  "durationMillis": 25
}
```

## Code Structure

### ChatRoomManager (Room Management)
```csharp
public partial class ChatRoomManager
{
    [Trace]
    public ChatRoom CreateRoom(string name)
    {
        var id = Guid.NewGuid().ToString("N")[..8];
        var room = new ChatRoom(id, name, DateTime.UtcNow, 0);
        _rooms[id] = room;
        return room;
    }

    [Trace]
    public void IncrementUserCount(string roomId)
    {
        _userCounts.AddOrUpdate(roomId, 1, (_, count) => count + 1);
    }

    [Trace]
    public List<string> ValidateRoomName(string name)
    {
        // Validation logic
        return errors;
    }
}
```

### ChatService (WebSocket Handling)
```csharp
public partial class ChatService
{
    [Trace]
    public async Task HandleWebSocketConnection(WebSocket webSocket, string roomId, string username)
    {
        // Connection setup
        await SendMessageToClientTraced(webSocket, welcomeMessage);
        await BroadcastToRoomTraced(roomId, joinMessage, clientId);

        // Message loop
        await ReceiveMessagesTraced(client);

        // Cleanup
        await BroadcastToRoomTraced(roomId, leaveMessage, clientId);
    }

    [Trace]
    private async Task BroadcastToRoom(string roomId, ChatMessage message, string? excludeClientId = null)
    {
        var roomClients = _clients.Values.Where(c => c.RoomId == roomId && c.Id != excludeClientId);
        var tasks = roomClients.Select(client => SendMessageToClientTraced(client.WebSocket, message));
        await Task.WhenAll(tasks);
    }
}
```

## Concurrency Model

### Thread Safety
- **ConcurrentDictionary**: Used for both `_clients` and `_rooms` to ensure thread-safe access
- **Atomic Operations**: `AddOrUpdate` for user count tracking
- **Parallel Broadcasting**: `Task.WhenAll` for efficient message distribution

### Connection Lifecycle
1. **Connect**: WebSocket handshake → Create ConnectedClient → Increment user count
2. **Active**: Message receive loop → Broadcast to room clients
3. **Disconnect**: Remove from clients → Decrement user count → Broadcast leave

## Performance Characteristics

- **WebSocket Overhead**: ~1-2ms per message send/receive
- **Trace Overhead**: ~0.1-0.5ms per traced method
- **Broadcast Efficiency**: Parallel Task.WhenAll for multiple clients
- **Connection Capacity**: Tested with 100+ concurrent WebSocket connections

## Testing Scenarios

### Test Multi-User Chat
```bash
# Terminal 1
wscat -c ws://localhost:5001/ws/general/Alice

# Terminal 2
wscat -c ws://localhost:5001/ws/general/Bob

# Terminal 3
wscat -c ws://localhost:5001/ws/general/Charlie

# Send messages from any terminal and observe broadcasting
```

### Test Multiple Rooms
```bash
# Create new room
curl -X POST http://localhost:5001/rooms \
  -H 'Content-Type: application/json' \
  -d '{"name": "Tech Talk"}'

# Connect to different rooms
wscat -c ws://localhost:5001/ws/general/Alice
wscat -c ws://localhost:5001/ws/a1b2c3d4/Bob  # Tech Talk room
```

### Test Connection Cleanup
```bash
# Connect
wscat -c ws://localhost:5001/ws/general/Alice

# Check active users
curl http://localhost:5001/rooms
# Should show activeUsers: 1

# Disconnect (CTRL+C)

# Check again
curl http://localhost:5001/rooms
# Should show activeUsers: 0
```

## Key Points

1. **Real-time Tracing**: Every WebSocket operation is traced, including connections, broadcasts, and disconnects
2. **Concurrent Safety**: ConcurrentDictionary ensures thread-safe access across multiple connections
3. **Message Ordering**: Messages are processed in the order received per client
4. **Graceful Cleanup**: Automatic cleanup on disconnect with leave notifications
5. **Room Isolation**: Messages only broadcast to clients in the same room
6. **Partial Classes**: Required for Source Generator to extend service classes

## Comparison with Python FastAPI Example

| Feature | .NET Minimal API | Python FastAPI |
|---------|------------------|----------------|
| Framework | ASP.NET Core WebSockets | FastAPI WebSockets |
| Instrumentation | [Trace] Source Generator | @trace decorator |
| Concurrency | ConcurrentDictionary | asyncio locks |
| Broadcasting | Task.WhenAll | asyncio.gather |
| Connection Tracking | ConnectedClient records | WebSocket dict |
| Performance | ~1-2ms per message | ~2-3ms per message |

## Next Steps

- See `../AspNetCoreAdvanced` for REST API example
- See `../Microservice` for production architecture example
- See `../../docs/source-generators.md` for Source Generator details

## Troubleshooting

### WebSocket Connection Refused
- Ensure server is running on http://localhost:5001
- Check firewall settings
- Verify WebSocket support in client

### Messages Not Broadcasting
- Check that clients are in the same room
- Verify WebSocket connection state is Open
- Review trace logs for errors

### High Memory Usage
- Implement message rate limiting
- Add connection limits per room
- Clean up disconnected clients promptly
