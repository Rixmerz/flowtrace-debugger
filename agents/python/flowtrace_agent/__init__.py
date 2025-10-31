"""
FlowTrace Python Agent
Intelligent tracing for Python applications with AI-powered analysis
"""

__version__ = "1.0.0"

from .config import Config
from .tracer import FlowTraceTracer, start_tracing, stop_tracing
from .decorators import trace, init_decorator_logger
from .logger import Logger

__all__ = [
    'Config',
    'FlowTraceTracer',
    'start_tracing',
    'stop_tracing',
    'trace',
    'init_decorator_logger',
    'Logger',
]
