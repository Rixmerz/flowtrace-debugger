"""FastAPI integration for FlowTrace"""

from fastapi import FastAPI, Request
from starlette.middleware.base import BaseHTTPMiddleware
from ..tracer import start_tracing, stop_tracing
from ..config import Config
from ..decorators import init_decorator_logger
import time
import uuid


class FlowTraceMiddleware(BaseHTTPMiddleware):
    """FastAPI middleware for HTTP request/response tracing"""

    def __init__(self, app, config):
        super().__init__(app)
        self.config = config

    async def dispatch(self, request: Request, call_next):
        """Process HTTP request and response"""
        from ..logger import Logger

        # Generate request ID
        request_id = str(uuid.uuid4())
        start_time = time.time()

        # Log HTTP request
        logger = Logger(self.config)
        logger.log({
            'timestamp': int(start_time * 1_000_000),
            'event': 'HTTP_REQUEST',
            'request_id': request_id,
            'method': request.method,
            'path': request.url.path,
            'client': request.client.host if request.client else None,
            'user_agent': request.headers.get('user-agent'),
        })

        # Process request
        response = await call_next(request)

        # Log HTTP response
        duration = time.time() - start_time
        logger.log({
            'timestamp': int(time.time() * 1_000_000),
            'event': 'HTTP_RESPONSE',
            'request_id': request_id,
            'method': request.method,
            'path': request.url.path,
            'status_code': response.status_code,
            'durationMicros': int(duration * 1_000_000),
            'durationMillis': int(duration * 1000),
        })

        return response


def init_flowtrace(app: FastAPI, config=None):
    """Initialize FlowTrace for FastAPI app with HTTP context"""
    cfg = config or Config.from_env()

    # Initialize logger
    init_decorator_logger(cfg)

    # Add middleware
    app.add_middleware(FlowTraceMiddleware, config=cfg)

    @app.on_event("startup")
    async def startup():
        start_tracing(cfg)

    @app.on_event("shutdown")
    async def shutdown():
        stop_tracing()
