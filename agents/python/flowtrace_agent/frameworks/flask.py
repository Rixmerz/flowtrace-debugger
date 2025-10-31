"""Flask integration for FlowTrace"""

from flask import request, g
from ..tracer import start_tracing, stop_tracing
from ..config import Config
from ..decorators import init_decorator_logger
import time
import uuid


def init_flowtrace(app, config=None):
    """Initialize FlowTrace for Flask app with HTTP context"""
    cfg = config or Config.from_env()

    # Initialize logger
    init_decorator_logger(cfg)

    @app.before_first_request
    def _start_tracing():
        start_tracing(cfg)

    @app.before_request
    def _before_request():
        """Capture request start and add request_id"""
        g.flowtrace_start_time = time.time()
        g.flowtrace_request_id = str(uuid.uuid4())

        # Log HTTP request
        from ..logger import Logger
        logger = Logger(cfg)
        logger.log({
            'timestamp': int(g.flowtrace_start_time * 1_000_000),
            'event': 'HTTP_REQUEST',
            'request_id': g.flowtrace_request_id,
            'method': request.method,
            'path': request.path,
            'remote_addr': request.remote_addr,
            'user_agent': request.user_agent.string if request.user_agent else None,
        })

    @app.after_request
    def _after_request(response):
        """Log HTTP response"""
        if hasattr(g, 'flowtrace_start_time'):
            duration = time.time() - g.flowtrace_start_time

            from ..logger import Logger
            logger = Logger(cfg)
            logger.log({
                'timestamp': int(time.time() * 1_000_000),
                'event': 'HTTP_RESPONSE',
                'request_id': getattr(g, 'flowtrace_request_id', 'unknown'),
                'method': request.method,
                'path': request.path,
                'status_code': response.status_code,
                'durationMicros': int(duration * 1_000_000),
                'durationMillis': int(duration * 1000),
            })

        return response

    @app.teardown_appcontext
    def _stop_tracing(exception=None):
        stop_tracing()
