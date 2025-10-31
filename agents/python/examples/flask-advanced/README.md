# Flask Advanced Example

Complete REST API with CRUD operations demonstrating FlowTrace capabilities.

## Features

- ✅ Complete REST API with 7 endpoints
- ✅ Database simulation with latency
- ✅ Custom `@trace` decorators
- ✅ Validation with error handling
- ✅ Search functionality
- ✅ JSONL trace output

## Installation

```bash
pip install flask flowtrace-agent
```

## Running

```bash
python app.py
```

Server will start on `http://localhost:5000`

## Endpoints

### Health Check
```bash
curl http://localhost:5000/health
```

### List Users
```bash
curl http://localhost:5000/users
curl http://localhost:5000/users?limit=2
```

### Get User
```bash
curl http://localhost:5000/users/1
```

### Create User
```bash
curl -X POST http://localhost:5000/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Diana","email":"diana@example.com","age":28}'
```

### Update User
```bash
curl -X PUT http://localhost:5000/users/1 \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice Updated","age":31}'
```

### Delete User
```bash
curl -X DELETE http://localhost:5000/users/1
```

### Search Users
```bash
curl "http://localhost:5000/users/search?q=alice"
```

## Trace Output

All operations are traced to `flowtrace-flask.jsonl`:

```json
{"timestamp":1635789012345,"event":"ENTER","thread":"Thread-1","module":"__main__","function":"list_users","args":"{}"}
{"timestamp":1635789012350,"event":"ENTER","thread":"Thread-1","module":"__main__","function":"list_users","args":"{\"limit\":100}"}
{"timestamp":1635789012420,"event":"EXIT","thread":"Thread-1","module":"__main__","function":"list_users","result":"[{...}]","durationMicros":70000,"durationMillis":70}
```

## What Gets Traced

- HTTP request handlers
- Database operations (with simulated latency)
- Validation functions
- All function calls in `__main__` module
