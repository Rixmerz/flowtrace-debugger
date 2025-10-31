# Django Microservice Example

Production-grade microservice with service layer architecture, caching, and comprehensive tracing.

## Features

- ✅ Service layer architecture (Database, Cache, Logger, Product services)
- ✅ In-memory caching with TTL
- ✅ Query tracking and statistics
- ✅ Centralized logging
- ✅ Purchase workflow with stock management
- ✅ Complete trace coverage

## Architecture

```
Views (HTTP Handlers)
    ↓
ProductService (Business Logic)
    ↓
├── DatabaseService (Data Access)
├── CacheService (Caching)
└── LoggerService (Logging)
```

## Installation

```bash
pip install django flowtrace-agent
```

## Running

```bash
python app.py
```

Or with Django directly:

```bash
python -c "import app" runserver 8000
```

Server will start on `http://localhost:8000`

## Endpoints

### Health Check
```bash
curl http://localhost:8000/health
```

### List Products
```bash
curl http://localhost:8000/products
```

### Get Product (with caching)
```bash
curl http://localhost:8000/products/1
```

### Search Products
```bash
curl "http://localhost:8000/products/search?q=laptop"
```

### Purchase Product
```bash
curl "http://localhost:8000/products/1/purchase?quantity=2"
```

### Get Statistics
```bash
curl http://localhost:8000/stats
```

## Caching Strategy

- **Product by ID**: 300 seconds TTL
- **All products**: 60 seconds TTL
- **Search results**: No caching (dynamic)
- **Cache invalidation**: On purchase (stock update)

## Trace Output

Complete service layer tracing:

```json
{"timestamp":1635789012345,"event":"ENTER","thread":"Thread-1","module":"__main__","function":"get_product","args":"{\"product_id\":1}"}
{"timestamp":1635789012346,"event":"ENTER","thread":"Thread-1","module":"__main__","function":"get","args":"{\"key\":\"product:1\"}"}
{"timestamp":1635789012347,"event":"EXIT","thread":"Thread-1","module":"__main__","function":"get","result":"null","durationMicros":1000}
{"timestamp":1635789012348,"event":"ENTER","thread":"Thread-1","module":"__main__","function":"get_product","args":"{\"product_id\":1}"}
{"timestamp":1635789012378,"event":"EXIT","thread":"Thread-1","module":"__main__","function":"get_product","result":"{...}","durationMicros":30000}
```

## What Gets Traced

- **HTTP layer**: All view functions
- **Service layer**: ProductService methods
- **Data access**: DatabaseService queries
- **Caching**: CacheService operations
- **Logging**: LoggerService calls
- **Complete call chains** from HTTP to database

## Production Patterns

- ✅ Service layer separation
- ✅ Dependency injection
- ✅ Caching strategy
- ✅ Centralized logging
- ✅ Error handling
- ✅ Statistics tracking
