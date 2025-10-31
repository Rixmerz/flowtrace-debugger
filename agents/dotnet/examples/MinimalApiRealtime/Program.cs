using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Flowtrace.Agent;

var builder = WebApplication.CreateBuilder(args);

// Configure FlowTrace
var flowtraceConfig = new FlowtraceConfig
{
    LogFile = "flowtrace.jsonl",
    WriteToConsole = true
};
FlowtraceTracer.Configure(flowtraceConfig);

// Add services
builder.Services.AddSingleton<ChatRoomManager>();
builder.Services.AddSingleton<ChatService>();

var app = builder.Build();

// WebSocket options
var webSocketOptions = new WebSocketOptions
{
    KeepAliveInterval = TimeSpan.FromMinutes(2)
};
app.UseWebSockets(webSocketOptions);

// Home endpoint
app.MapGet("/", () => new
{
    message = "FlowTrace .NET Agent - Minimal API Realtime WebSocket Chat",
    version = "1.0.0",
    endpoints = new[]
    {
        "GET /rooms - List all chat rooms",
        "POST /rooms - Create new chat room",
        "WS /ws/{roomId}/{username} - Join chat room via WebSocket"
    }
});

// List rooms
app.MapGet("/rooms", (ChatRoomManager manager) =>
{
    var rooms = manager.GetAllRoomsTraced();
    return Results.Ok(rooms);
});

// Create room
app.MapPost("/rooms", (CreateRoomRequest request, ChatRoomManager manager) =>
{
    var validation = manager.ValidateRoomNameTraced(request.Name);
    if (validation.Any())
    {
        return Results.BadRequest(new { errors = validation });
    }

    var room = manager.CreateRoomTraced(request.Name);
    return Results.Created($"/rooms/{room.Id}", room);
});

// WebSocket endpoint
app.Map("/ws/{roomId}/{username}", async (HttpContext context, string roomId, string username, ChatService service) =>
{
    if (!context.WebSockets.IsWebSocketRequest)
    {
        context.Response.StatusCode = 400;
        return;
    }

    var webSocket = await context.WebSockets.AcceptWebSocketAsync();
    await service.HandleWebSocketConnectionTraced(webSocket, roomId, username);
});

Console.WriteLine("🚀 Minimal API Realtime WebSocket Chat - Running on http://localhost:5001");
Console.WriteLine("📊 FlowTrace logging to: flowtrace.jsonl");
Console.WriteLine("\nTest with wscat:");
Console.WriteLine("  wscat -c ws://localhost:5001/ws/general/Alice");
Console.WriteLine("  wscat -c ws://localhost:5001/ws/general/Bob");

app.Run("http://localhost:5001");

// ==================== Models ====================

public record ChatRoom(string Id, string Name, DateTime CreatedAt, int ActiveUsers);

public record ChatMessage(string Type, string RoomId, string Username, string Content, DateTime Timestamp);

public record CreateRoomRequest(string Name);

public record ConnectedClient(string Id, string Username, WebSocket WebSocket, string RoomId, DateTime ConnectedAt);

// ==================== Chat Room Manager ====================

public partial class ChatRoomManager
{
    private readonly ConcurrentDictionary<string, ChatRoom> _rooms = new();
    private readonly ConcurrentDictionary<string, int> _userCounts = new();

    public ChatRoomManager()
    {
        // Create default room
        _rooms["general"] = new ChatRoom("general", "General Chat", DateTime.UtcNow, 0);
        _userCounts["general"] = 0;
    }

    [Trace]
    public ChatRoom CreateRoom(string name)
    {
        var id = Guid.NewGuid().ToString("N")[..8];
        var room = new ChatRoom(id, name, DateTime.UtcNow, 0);
        _rooms[id] = room;
        _userCounts[id] = 0;
        return room;
    }

    [Trace]
    public ChatRoom? GetRoom(string roomId)
    {
        return _rooms.TryGetValue(roomId, out var room) ? room : null;
    }

    [Trace]
    public List<ChatRoom> GetAllRooms()
    {
        return _rooms.Values
            .Select(r => r with { ActiveUsers = _userCounts.GetValueOrDefault(r.Id, 0) })
            .OrderBy(r => r.Name)
            .ToList();
    }

    [Trace]
    public void IncrementUserCount(string roomId)
    {
        _userCounts.AddOrUpdate(roomId, 1, (_, count) => count + 1);
    }

    [Trace]
    public void DecrementUserCount(string roomId)
    {
        _userCounts.AddOrUpdate(roomId, 0, (_, count) => Math.Max(0, count - 1));
    }

    [Trace]
    public List<string> ValidateRoomName(string name)
    {
        var errors = new List<string>();

        if (string.IsNullOrWhiteSpace(name))
        {
            errors.Add("Room name is required");
        }
        else if (name.Length < 3)
        {
            errors.Add("Room name must be at least 3 characters");
        }
        else if (name.Length > 50)
        {
            errors.Add("Room name must not exceed 50 characters");
        }
        else if (_rooms.Values.Any(r => r.Name.Equals(name, StringComparison.OrdinalIgnoreCase)))
        {
            errors.Add("Room name already exists");
        }

        return errors;
    }

    [TraceIgnore]
    public int GetRoomCount() => _rooms.Count;
}

// ==================== Chat Service ====================

public partial class ChatService
{
    private readonly ChatRoomManager _roomManager;
    private readonly ConcurrentDictionary<string, ConnectedClient> _clients = new();

    public ChatService(ChatRoomManager roomManager)
    {
        _roomManager = roomManager;
    }

    [Trace]
    public async Task HandleWebSocketConnection(WebSocket webSocket, string roomId, string username)
    {
        var room = _roomManager.GetRoomTraced(roomId);
        if (room == null)
        {
            await SendMessageToClientTraced(webSocket, new ChatMessage(
                "error", roomId, "System", $"Room '{roomId}' not found", DateTime.UtcNow));
            await webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Room not found", CancellationToken.None);
            return;
        }

        var clientId = Guid.NewGuid().ToString();
        var client = new ConnectedClient(clientId, username, webSocket, roomId, DateTime.UtcNow);

        _clients[clientId] = client;
        _roomManager.IncrementUserCountTraced(roomId);

        // Send welcome message
        await SendMessageToClientTraced(webSocket, new ChatMessage(
            "system", roomId, "System", $"Welcome to {room.Name}, {username}!", DateTime.UtcNow));

        // Broadcast join message
        await BroadcastToRoomTraced(roomId, new ChatMessage(
            "join", roomId, username, $"{username} joined the room", DateTime.UtcNow), clientId);

        // Handle incoming messages
        await ReceiveMessagesTraced(client);

        // Cleanup on disconnect
        _clients.TryRemove(clientId, out _);
        _roomManager.DecrementUserCountTraced(roomId);

        // Broadcast leave message
        await BroadcastToRoomTraced(roomId, new ChatMessage(
            "leave", roomId, username, $"{username} left the room", DateTime.UtcNow), clientId);
    }

    [Trace]
    private async Task ReceiveMessages(ConnectedClient client)
    {
        var buffer = new byte[4096];
        var messageBuilder = new StringBuilder();

        while (client.WebSocket.State == WebSocketState.Open)
        {
            WebSocketReceiveResult result;
            try
            {
                result = await client.WebSocket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);
            }
            catch (WebSocketException)
            {
                break; // Connection closed
            }

            if (result.MessageType == WebSocketMessageType.Close)
            {
                await client.WebSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Client closed", CancellationToken.None);
                break;
            }

            var messageChunk = Encoding.UTF8.GetString(buffer, 0, result.Count);
            messageBuilder.Append(messageChunk);

            if (result.EndOfMessage)
            {
                var messageText = messageBuilder.ToString();
                messageBuilder.Clear();

                if (!string.IsNullOrWhiteSpace(messageText))
                {
                    var chatMessage = new ChatMessage(
                        "message", client.RoomId, client.Username, messageText, DateTime.UtcNow);

                    await BroadcastToRoomTraced(client.RoomId, chatMessage, client.Id);
                }
            }
        }
    }

    [Trace]
    private async Task BroadcastToRoom(string roomId, ChatMessage message, string? excludeClientId = null)
    {
        var roomClients = _clients.Values.Where(c => c.RoomId == roomId && c.Id != excludeClientId);

        var tasks = roomClients.Select(client => SendMessageToClientTraced(client.WebSocket, message));
        await Task.WhenAll(tasks);
    }

    [Trace]
    private async Task SendMessageToClient(WebSocket webSocket, ChatMessage message)
    {
        if (webSocket.State != WebSocketState.Open)
        {
            return;
        }

        var json = JsonSerializer.Serialize(message);
        var bytes = Encoding.UTF8.GetBytes(json);

        try
        {
            await webSocket.SendAsync(
                new ArraySegment<byte>(bytes),
                WebSocketMessageType.Text,
                endOfMessage: true,
                CancellationToken.None);
        }
        catch (WebSocketException)
        {
            // Connection closed
        }
    }

    [Trace]
    public int GetActiveConnectionCount()
    {
        return _clients.Count;
    }

    [Trace]
    public List<ConnectedClient> GetRoomClients(string roomId)
    {
        return _clients.Values.Where(c => c.RoomId == roomId).ToList();
    }

    [TraceIgnore]
    public int GetTotalMessagesSent()
    {
        // Internal metric - not traced
        return 0; // Would track this in real implementation
    }
}
