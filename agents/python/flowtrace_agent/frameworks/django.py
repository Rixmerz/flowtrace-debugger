"""Django integration for FlowTrace"""

from ..tracer import start_tracing, stop_tracing
from ..config import Config
from ..decorators import init_decorator_logger
import time
import uuid


class FlowTraceMiddleware:
    """Django middleware for automatic tracing with HTTP context"""

    def __init__(self, get_response):
        self.get_response = get_response
        self.config = Config.from_env()

        # Initialize logger
        init_decorator_logger(self.config)

        # Start tracing
        start_tracing(self.config)

    def __call__(self, request):
        """Process HTTP request and response"""
        from ..logger import Logger

        # Generate request ID
        request_id = str(uuid.uuid4())
        request.flowtrace_request_id = request_id
        start_time = time.time()

        # Log HTTP request
        logger = Logger(self.config)
        logger.log({
            'timestamp': int(start_time * 1_000_000),
            'event': 'HTTP_REQUEST',
            'request_id': request_id,
            'method': request.method,
            'path': request.path,
            'remote_addr': request.META.get('REMOTE_ADDR'),
            'user_agent': request.META.get('HTTP_USER_AGENT'),
        })

        # Process request
        response = self.get_response(request)

        # Log HTTP response
        duration = time.time() - start_time
        logger.log({
            'timestamp': int(time.time() * 1_000_000),
            'event': 'HTTP_RESPONSE',
            'request_id': request_id,
            'method': request.method,
            'path': request.path,
            'status_code': response.status_code,
            'durationMicros': int(duration * 1_000_000),
            'durationMillis': int(duration * 1000),
        })

        return response

    def __del__(self):
        stop_tracing()
