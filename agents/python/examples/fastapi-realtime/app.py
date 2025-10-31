"""
FastAPI Realtime Example - WebSocket Chat Application
Demonstrates: WebSocket support, room management, real-time tracing
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import HTMLResponse
from typing import Dict, Set, List
import json
import time
import asyncio
from flowtrace_agent import Config, trace, init_decorator_logger
from flowtrace_agent.frameworks.fastapi import init_flowtrace

# Initialize FastAPI
app = FastAPI(title="FlowTrace FastAPI Realtime Example")

# Configure FlowTrace
config = Config(
    package_prefix='__main__',
    logfile='flowtrace-fastapi.jsonl',
    stdout=True,
    max_arg_length=500
)

# Initialize decorator logger
init_decorator_logger(config)

# Initialize FlowTrace
init_flowtrace(app, config)


# Room and client management
class Room:
    """Chat room with participants"""

    def __init__(self, room_id: str, name: str):
        self.room_id = room_id
        self.name = name
        self.clients: Dict[str, WebSocket] = {}
        self.message_history: List[dict] = []
        self.created_at = time.time()

    @trace
    async def add_client(self, client_id: str, websocket: WebSocket):
        """Add client to room"""
        self.clients[client_id] = websocket
        await self.broadcast({
            'type': 'user_joined',
            'client_id': client_id,
            'room_id': self.room_id,
            'participant_count': len(self.clients)
        }, exclude=client_id)

    @trace
    async def remove_client(self, client_id: str):
        """Remove client from room"""
        if client_id in self.clients:
            del self.clients[client_id]
            await self.broadcast({
                'type': 'user_left',
                'client_id': client_id,
                'room_id': self.room_id,
                'participant_count': len(self.clients)
            })

    @trace
    async def broadcast(self, message: dict, exclude: str = None):
        """Broadcast message to all clients in room"""
        # Add to history
        self.message_history.append({
            **message,
            'timestamp': int(time.time() * 1000)
        })

        # Keep only last 100 messages
        if len(self.message_history) > 100:
            self.message_history = self.message_history[-100:]

        # Send to all clients
        disconnected = []
        for client_id, websocket in self.clients.items():
            if client_id == exclude:
                continue

            try:
                await websocket.send_json(message)
            except Exception:
                disconnected.append(client_id)

        # Clean up disconnected clients
        for client_id in disconnected:
            await self.remove_client(client_id)

    @trace
    def get_info(self) -> dict:
        """Get room information"""
        return {
            'room_id': self.room_id,
            'name': self.name,
            'participant_count': len(self.clients),
            'message_count': len(self.message_history),
            'created_at': self.created_at
        }


class RoomManager:
    """Manage multiple chat rooms"""

    def __init__(self):
        self.rooms: Dict[str, Room] = {}
        self._initialize_default_rooms()

    @trace
    def _initialize_default_rooms(self):
        """Create default rooms"""
        self.create_room('general', 'General Discussion')
        self.create_room('python', 'Python Programming')
        self.create_room('random', 'Random Chat')

    @trace
    def create_room(self, room_id: str, name: str) -> Room:
        """Create new room"""
        if room_id in self.rooms:
            return self.rooms[room_id]

        room = Room(room_id, name)
        self.rooms[room_id] = room
        return room

    @trace
    def get_room(self, room_id: str) -> Room:
        """Get room by ID"""
        return self.rooms.get(room_id)

    @trace
    def list_rooms(self) -> List[dict]:
        """List all rooms"""
        return [room.get_info() for room in self.rooms.values()]

    @trace
    def delete_room(self, room_id: str) -> bool:
        """Delete room"""
        if room_id in self.rooms:
            del self.rooms[room_id]
            return True
        return False


# Initialize room manager
room_manager = RoomManager()


# HTTP Endpoints
@app.get("/")
async def get_home():
    """Serve simple HTML client"""
    html = """
    <!DOCTYPE html>
    <html>
    <head>
        <title>FlowTrace Chat</title>
        <style>
            body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; }
            #messages { border: 1px solid #ccc; height: 400px; overflow-y: scroll; padding: 10px; }
            #input { width: 80%; padding: 10px; }
            #send { padding: 10px 20px; }
            .message { margin: 5px 0; padding: 5px; }
            .system { color: #666; font-style: italic; }
        </style>
    </head>
    <body>
        <h1>🔥 FlowTrace Chat Example</h1>
        <select id="room">
            <option value="general">General</option>
            <option value="python">Python</option>
            <option value="random">Random</option>
        </select>
        <button onclick="connect()">Connect</button>
        <div id="messages"></div>
        <input id="input" placeholder="Type a message..." />
        <button id="send" onclick="sendMessage()">Send</button>

        <script>
            let ws = null;
            let clientId = 'user_' + Math.random().toString(36).substr(2, 9);

            function connect() {
                const room = document.getElementById('room').value;
                ws = new WebSocket(`ws://localhost:8000/ws/${room}/${clientId}`);

                ws.onmessage = function(event) {
                    const data = JSON.parse(event.data);
                    const div = document.createElement('div');
                    div.className = 'message ' + data.type;
                    div.textContent = JSON.stringify(data);
                    document.getElementById('messages').appendChild(div);
                };
            }

            function sendMessage() {
                const input = document.getElementById('input');
                ws.send(JSON.stringify({type: 'message', text: input.value}));
                input.value = '';
            }
        </script>
    </body>
    </html>
    """
    return HTMLResponse(html)


@app.get("/health")
@trace
async def health_check():
    """Health check endpoint"""
    return {
        'status': 'healthy',
        'service': 'fastapi-realtime',
        'timestamp': int(time.time() * 1000)
    }


@app.get("/rooms")
@trace
async def list_rooms():
    """List all chat rooms"""
    rooms = room_manager.list_rooms()
    return {'rooms': rooms, 'count': len(rooms)}


@app.post("/rooms")
@trace
async def create_room(room_id: str, name: str):
    """Create new room"""
    room = room_manager.create_room(room_id, name)
    return room.get_info()


@app.get("/rooms/{room_id}")
@trace
async def get_room(room_id: str):
    """Get room information"""
    room = room_manager.get_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    return room.get_info()


@app.delete("/rooms/{room_id}")
@trace
async def delete_room(room_id: str):
    """Delete room"""
    success = room_manager.delete_room(room_id)
    if not success:
        raise HTTPException(status_code=404, detail="Room not found")
    return {'message': 'Room deleted successfully'}


# WebSocket endpoint
@app.websocket("/ws/{room_id}/{client_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, client_id: str):
    """WebSocket connection handler"""
    await handle_websocket(websocket, room_id, client_id)


@trace
async def handle_websocket(websocket: WebSocket, room_id: str, client_id: str):
    """Handle WebSocket connection lifecycle"""
    # Get or create room
    room = room_manager.get_room(room_id)
    if not room:
        room = room_manager.create_room(room_id, f"Room {room_id}")

    # Accept connection
    await websocket.accept()

    # Add client to room
    await room.add_client(client_id, websocket)

    try:
        # Send room history
        await send_room_history(websocket, room)

        # Message loop
        while True:
            data = await websocket.receive_text()
            await process_message(room, client_id, data)

    except WebSocketDisconnect:
        await room.remove_client(client_id)


@trace
async def send_room_history(websocket: WebSocket, room: Room):
    """Send room message history to new client"""
    if room.message_history:
        await websocket.send_json({
            'type': 'history',
            'messages': room.message_history[-20:]  # Last 20 messages
        })


@trace
async def process_message(room: Room, client_id: str, raw_data: str):
    """Process incoming message"""
    try:
        data = json.loads(raw_data)
        message_type = data.get('type', 'message')

        if message_type == 'message':
            await room.broadcast({
                'type': 'message',
                'client_id': client_id,
                'text': data.get('text', ''),
                'room_id': room.room_id
            })

        elif message_type == 'typing':
            await room.broadcast({
                'type': 'typing',
                'client_id': client_id,
                'room_id': room.room_id
            }, exclude=client_id)

    except json.JSONDecodeError:
        # Invalid JSON, ignore
        pass


if __name__ == "__main__":
    import uvicorn

    print("🚀 FastAPI Realtime Example - FlowTrace enabled")
    print("📊 Traces will be written to: flowtrace-fastapi.jsonl")
    print("🌐 Server running on http://localhost:8000")
    print("\n💡 Try these endpoints:")
    print("  GET    /")
    print("  GET    /health")
    print("  GET    /rooms")
    print("  POST   /rooms?room_id=test&name=Test Room")
    print("  GET    /rooms/general")
    print("  DELETE /rooms/test")
    print("  WS     /ws/{room_id}/{client_id}")

    uvicorn.run(app, host="0.0.0.0", port=8000)
