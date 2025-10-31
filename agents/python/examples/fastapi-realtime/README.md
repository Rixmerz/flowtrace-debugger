# FastAPI Realtime Example

WebSocket chat application with room management demonstrating real-time tracing.

## Features

- ✅ WebSocket chat with multiple rooms
- ✅ Real-time message broadcasting
- ✅ Room management (create, list, delete)
- ✅ Message history (last 100 per room)
- ✅ User join/leave notifications
- ✅ Complete trace logging

## Installation

```bash
pip install fastapi uvicorn websockets flowtrace-agent
```

## Running

```bash
python app.py
```

Or with uvicorn directly:

```bash
uvicorn app:app --host 0.0.0.0 --port 8000
```

Server will start on `http://localhost:8000`

## HTTP Endpoints

### Home (Web Client)
```bash
open http://localhost:8000
```

### Health Check
```bash
curl http://localhost:8000/health
```

### List Rooms
```bash
curl http://localhost:8000/rooms
```

### Create Room
```bash
curl -X POST "http://localhost:8000/rooms?room_id=test&name=Test%20Room"
```

### Get Room Info
```bash
curl http://localhost:8000/rooms/general
```

### Delete Room
```bash
curl -X DELETE http://localhost:8000/rooms/test
```

## WebSocket Usage

Connect to a room:
```javascript
const ws = new WebSocket('ws://localhost:8000/ws/general/user123');

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('Received:', data);
};

// Send message
ws.send(JSON.stringify({
    type: 'message',
    text: 'Hello, World!'
}));

// Send typing indicator
ws.send(JSON.stringify({
    type: 'typing'
}));
```

## Message Types

### Outgoing (Client → Server)
```json
{
  "type": "message",
  "text": "Hello!"
}
```

```json
{
  "type": "typing"
}
```

### Incoming (Server → Client)
```json
{
  "type": "message",
  "client_id": "user123",
  "text": "Hello!",
  "room_id": "general",
  "timestamp": 1635789012345
}
```

```json
{
  "type": "user_joined",
  "client_id": "user456",
  "room_id": "general",
  "participant_count": 5
}
```

```json
{
  "type": "user_left",
  "client_id": "user456",
  "room_id": "general",
  "participant_count": 4
}
```

## Trace Output

All WebSocket operations are traced:

```json
{"timestamp":1635789012345,"event":"ENTER","thread":"MainThread","module":"__main__","function":"handle_websocket","args":"{\"room_id\":\"general\",\"client_id\":\"user123\"}"}
{"timestamp":1635789012350,"event":"ENTER","thread":"MainThread","module":"__main__","function":"add_client","args":"{\"client_id\":\"user123\"}"}
{"timestamp":1635789012420,"event":"EXIT","thread":"MainThread","module":"__main__","function":"broadcast","durationMicros":70000}
```

## What Gets Traced

- WebSocket connection lifecycle
- Room creation and management
- Message broadcasting
- Client join/leave events
- All async operations
