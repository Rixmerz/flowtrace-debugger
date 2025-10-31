"""
Django Microservice Example - Production-Grade Service Architecture
Demonstrates: Service layer pattern, caching, sampling, production patterns
"""

import os
import sys
import time
import random
from typing import Optional, List, Dict, Any

# Django setup
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'settings')

import django
from django.conf import settings
from django.http import JsonResponse
from django.urls import path
from django.core.wsgi import get_wsgi_application

# Configure Django inline
if not settings.configured:
    settings.configure(
        DEBUG=False,
        SECRET_KEY='flowtrace-django-example-secret-key',
        ROOT_URLCONF=__name__,
        ALLOWED_HOSTS=['*'],
        MIDDLEWARE=[
            'django.middleware.security.SecurityMiddleware',
            'django.middleware.common.CommonMiddleware',
            'flowtrace_agent.frameworks.django.FlowTraceMiddleware',  # FlowTrace
        ],
        INSTALLED_APPS=[
            'django.contrib.contenttypes',
        ],
    )
    django.setup()

# FlowTrace configuration
from flowtrace_agent import Config, trace, init_decorator_logger

config = Config(
    package_prefix='__main__',
    logfile='flowtrace-django.jsonl',
    stdout=True,
    max_arg_length=500
)

init_decorator_logger(config)


# Service Layer Architecture

class CacheService:
    """Simple in-memory cache with TTL"""

    def __init__(self):
        self._cache: Dict[str, tuple[Any, float]] = {}
        self._ttl = 60  # seconds

    @trace
    def get(self, key: str) -> Optional[Any]:
        """Get value from cache"""
        if key in self._cache:
            value, expire_time = self._cache[key]
            if time.time() < expire_time:
                return value
            else:
                del self._cache[key]
        return None

    @trace
    def set(self, key: str, value: Any, ttl: Optional[int] = None):
        """Set value in cache"""
        expire_time = time.time() + (ttl or self._ttl)
        self._cache[key] = (value, expire_time)

    @trace
    def delete(self, key: str):
        """Delete key from cache"""
        if key in self._cache:
            del self._cache[key]

    @trace
    def clear(self):
        """Clear all cache"""
        self._cache.clear()

    @trace
    def stats(self) -> dict:
        """Get cache statistics"""
        return {
            'size': len(self._cache),
            'keys': list(self._cache.keys())
        }


class DatabaseService:
    """Simulated database with query tracking"""

    def __init__(self):
        self.products = {
            1: {'id': 1, 'name': 'Laptop', 'price': 999.99, 'stock': 50},
            2: {'id': 2, 'name': 'Mouse', 'price': 29.99, 'stock': 200},
            3: {'id': 3, 'name': 'Keyboard', 'price': 79.99, 'stock': 150},
            4: {'id': 4, 'name': 'Monitor', 'price': 299.99, 'stock': 75},
        }
        self.query_count = 0

    @trace
    def get_product(self, product_id: int) -> Optional[dict]:
        """Get product by ID"""
        self.query_count += 1
        time.sleep(random.uniform(0.01, 0.03))
        return self.products.get(product_id)

    @trace
    def list_products(self, limit: int = 100) -> List[dict]:
        """List all products"""
        self.query_count += 1
        time.sleep(random.uniform(0.02, 0.05))
        return list(self.products.values())[:limit]

    @trace
    def search_products(self, query: str) -> List[dict]:
        """Search products"""
        self.query_count += 1
        time.sleep(random.uniform(0.03, 0.08))

        query_lower = query.lower()
        results = []

        for product in self.products.values():
            if query_lower in product['name'].lower():
                results.append(product)

        return results

    @trace
    def update_stock(self, product_id: int, quantity: int) -> bool:
        """Update product stock"""
        self.query_count += 1
        time.sleep(random.uniform(0.01, 0.04))

        if product_id in self.products:
            self.products[product_id]['stock'] += quantity
            return True

        return False

    @trace
    def get_stats(self) -> dict:
        """Get database statistics"""
        return {
            'total_products': len(self.products),
            'total_queries': self.query_count
        }


class LoggerService:
    """Centralized logging service"""

    @trace
    def info(self, message: str, **context):
        """Log info message"""
        print(f"[INFO] {message}", context)

    @trace
    def error(self, message: str, **context):
        """Log error message"""
        print(f"[ERROR] {message}", context)

    @trace
    def warning(self, message: str, **context):
        """Log warning message"""
        print(f"[WARNING] {message}", context)


class ProductService:
    """Product business logic service"""

    def __init__(self, db: DatabaseService, cache: CacheService, logger: LoggerService):
        self.db = db
        self.cache = cache
        self.logger = logger

    @trace
    def get_product(self, product_id: int) -> Optional[dict]:
        """Get product with caching"""
        # Try cache first
        cache_key = f"product:{product_id}"
        cached = self.cache.get(cache_key)

        if cached:
            self.logger.info("Cache hit", product_id=product_id)
            return cached

        # Query database
        self.logger.info("Cache miss", product_id=product_id)
        product = self.db.get_product(product_id)

        if product:
            self.cache.set(cache_key, product, ttl=300)

        return product

    @trace
    def list_products(self) -> List[dict]:
        """List all products"""
        # Check cache
        cache_key = "products:all"
        cached = self.cache.get(cache_key)

        if cached:
            return cached

        # Query database
        products = self.db.list_products()
        self.cache.set(cache_key, products, ttl=60)

        return products

    @trace
    def search_products(self, query: str) -> List[dict]:
        """Search products (no caching for dynamic queries)"""
        results = self.db.search_products(query)
        self.logger.info("Product search", query=query, results=len(results))
        return results

    @trace
    def purchase_product(self, product_id: int, quantity: int) -> dict:
        """Purchase product (updates stock)"""
        product = self.get_product(product_id)

        if not product:
            self.logger.error("Product not found", product_id=product_id)
            return {'error': 'Product not found'}

        if product['stock'] < quantity:
            self.logger.warning("Insufficient stock", product_id=product_id, requested=quantity, available=product['stock'])
            return {'error': 'Insufficient stock', 'available': product['stock']}

        # Update stock
        self.db.update_stock(product_id, -quantity)

        # Invalidate cache
        cache_key = f"product:{product_id}"
        self.cache.delete(cache_key)
        self.cache.delete("products:all")

        self.logger.info("Purchase successful", product_id=product_id, quantity=quantity)

        return {
            'success': True,
            'product': product,
            'quantity': quantity,
            'total': product['price'] * quantity
        }


# Initialize services
cache_service = CacheService()
db_service = DatabaseService()
logger_service = LoggerService()
product_service = ProductService(db_service, cache_service, logger_service)


# Views (Django request handlers)

@trace
def health_check(request):
    """Health check endpoint"""
    return JsonResponse({
        'status': 'healthy',
        'service': 'django-microservice',
        'timestamp': int(time.time() * 1000)
    })


@trace
def list_products_view(request):
    """List all products"""
    try:
        products = product_service.list_products()
        return JsonResponse({
            'products': products,
            'count': len(products)
        })
    except Exception as e:
        logger_service.error("Failed to list products", error=str(e))
        return JsonResponse({'error': str(e)}, status=500)


@trace
def get_product_view(request, product_id):
    """Get single product"""
    try:
        product = product_service.get_product(product_id)

        if not product:
            return JsonResponse({'error': 'Product not found'}, status=404)

        return JsonResponse(product)

    except Exception as e:
        logger_service.error("Failed to get product", product_id=product_id, error=str(e))
        return JsonResponse({'error': str(e)}, status=500)


@trace
def search_products_view(request):
    """Search products"""
    try:
        query = request.GET.get('q', '')

        if not query:
            return JsonResponse({'error': 'Query parameter "q" is required'}, status=400)

        results = product_service.search_products(query)

        return JsonResponse({
            'results': results,
            'count': len(results),
            'query': query
        })

    except Exception as e:
        logger_service.error("Failed to search products", query=query, error=str(e))
        return JsonResponse({'error': str(e)}, status=500)


@trace
def purchase_product_view(request, product_id):
    """Purchase product"""
    try:
        quantity = int(request.GET.get('quantity', 1))

        result = product_service.purchase_product(product_id, quantity)

        if 'error' in result:
            status = 404 if result['error'] == 'Product not found' else 400
            return JsonResponse(result, status=status)

        return JsonResponse(result)

    except ValueError:
        return JsonResponse({'error': 'Invalid quantity'}, status=400)
    except Exception as e:
        logger_service.error("Failed to purchase product", product_id=product_id, error=str(e))
        return JsonResponse({'error': str(e)}, status=500)


@trace
def stats_view(request):
    """Get service statistics"""
    try:
        return JsonResponse({
            'database': db_service.get_stats(),
            'cache': cache_service.stats()
        })
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


# URL Configuration
urlpatterns = [
    path('health', health_check),
    path('products', list_products_view),
    path('products/<int:product_id>', get_product_view),
    path('products/search', search_products_view),
    path('products/<int:product_id>/purchase', purchase_product_view),
    path('stats', stats_view),
]

# WSGI Application
application = get_wsgi_application()

if __name__ == '__main__':
    from django.core.management import execute_from_command_line

    print("🚀 Django Microservice Example - FlowTrace enabled")
    print("📊 Traces will be written to: flowtrace-django.jsonl")
    print("🌐 Server running on http://localhost:8000")
    print("\n💡 Try these endpoints:")
    print("  GET  /health")
    print("  GET  /products")
    print("  GET  /products/1")
    print("  GET  /products/search?q=laptop")
    print("  GET  /products/1/purchase?quantity=2")
    print("  GET  /stats")

    execute_from_command_line(['manage.py', 'runserver', '8000'])
