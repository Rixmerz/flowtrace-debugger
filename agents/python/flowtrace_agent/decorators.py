"""
FlowTrace Decorators
Decorator-based tracing for explicit function instrumentation
"""

import functools
import time
import threading
import json
from typing import Callable, Any
from .config import Config
from .logger import Logger


# Global logger instance for decorator usage
_decorator_logger: Logger = None


def init_decorator_logger(config: Config = None):
    """Initialize global logger for decorators"""
    global _decorator_logger
    if _decorator_logger is None:
        _decorator_logger = Logger(config or Config())


def trace(func: Callable) -> Callable:
    """
    Decorator to trace function execution

    Usage:
        @trace
        def my_function(arg1, arg2):
            return result

    Args:
        func: Function to trace

    Returns:
        Wrapped function with tracing
    """
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        # Initialize logger if not already done
        if _decorator_logger is None:
            init_decorator_logger()

        # Get function/module information
        module_name = func.__module__
        function_name = func.__name__
        thread_name = threading.current_thread().name

        # Record ENTER event
        enter_timestamp = int(time.time() * 1_000_000)

        # Serialize arguments
        args_dict = {}
        try:
            # Positional arguments
            if hasattr(func, '__code__'):
                arg_names = func.__code__.co_varnames[:func.__code__.co_argcount]
                for i, arg_name in enumerate(arg_names):
                    if i < len(args):
                        args_dict[arg_name] = _serialize_value(args[i])

            # Keyword arguments
            for key, value in kwargs.items():
                args_dict[key] = _serialize_value(value)

        except Exception:
            args_dict = {'<serialization_error>': True}

        enter_entry = {
            'timestamp': enter_timestamp,
            'event': 'ENTER',
            'thread': thread_name,
            'module': module_name,
            'function': function_name,
            'args': json.dumps(args_dict) if args_dict else '{}',
        }

        _decorator_logger.log(enter_entry)

        # Execute function
        try:
            result = func(*args, **kwargs)

            # Record EXIT event
            exit_timestamp = int(time.time() * 1_000_000)
            duration_micros = exit_timestamp - enter_timestamp

            exit_entry = {
                'timestamp': exit_timestamp,
                'event': 'EXIT',
                'thread': thread_name,
                'module': module_name,
                'function': function_name,
                'result': _serialize_value(result),
                'durationMicros': duration_micros,
                'durationMillis': duration_micros // 1000,
            }

            _decorator_logger.log(exit_entry)

            return result

        except Exception as e:
            # Record EXCEPTION event
            exception_timestamp = int(time.time() * 1_000_000)

            exception_entry = {
                'timestamp': exception_timestamp,
                'event': 'EXCEPTION',
                'thread': thread_name,
                'module': module_name,
                'function': function_name,
                'exception': {
                    'type': type(e).__name__,
                    'message': str(e),
                }
            }

            _decorator_logger.log(exception_entry)

            # Re-raise the exception
            raise

    return wrapper


def _serialize_value(value: Any, max_length: int = 1000) -> str:
    """
    Serialize a value to string for logging

    Args:
        value: Value to serialize
        max_length: Maximum length of serialized string

    Returns:
        String representation of value
    """
    try:
        # Try JSON serialization first
        serialized = json.dumps(value, default=str)

        # Truncate if needed
        if len(serialized) > max_length:
            serialized = serialized[:max_length] + '...'

        return serialized
    except (TypeError, ValueError):
        # Fallback to string representation
        try:
            result = str(value)
            if len(result) > max_length:
                result = result[:max_length] + '...'
            return result
        except:
            return '<unserializable>'
