"""
FlowTrace Python Tracer
Core tracing engine using sys.settrace()
"""

import sys
import time
import threading
import json
from typing import Any, Optional, Callable
from .config import Config
from .logger import Logger
from .filters import should_trace_module


class FlowTraceTracer:
    """
    Core tracer using sys.settrace() for method-level tracing
    """

    def __init__(self, config: Optional[Config] = None):
        self.config = config or Config()
        self.logger = Logger(self.config)
        self.active = False
        self._trace_stack = threading.local()

    def start(self):
        """Start tracing"""
        if self.active:
            return

        self.active = True
        sys.settrace(self._trace_function)
        # Set trace for existing threads
        threading.settrace(self._trace_function)

    def stop(self):
        """Stop tracing"""
        if not self.active:
            return

        self.active = False
        sys.settrace(None)
        threading.settrace(None)
        self.logger.close()

    def _trace_function(self, frame, event, arg):
        """
        Main trace function called by sys.settrace()

        Args:
            frame: Current stack frame
            event: Event type ('call', 'return', 'exception', etc.)
            arg: Event-specific argument
        """
        if not self.active:
            return None

        # Get function/module information
        code = frame.f_code
        module_name = frame.f_globals.get('__name__', '')
        function_name = code.co_name
        filename = code.co_filename

        # Apply filters
        if not should_trace_module(module_name, self.config.package_prefix, self.config.exclude_patterns):
            return None

        # Handle events
        if event == 'call':
            self._handle_call(frame, module_name, function_name)
        elif event == 'return':
            self._handle_return(frame, module_name, function_name, arg)
        elif event == 'exception':
            self._handle_exception(frame, module_name, function_name, arg)

        return self._trace_function

    def _handle_call(self, frame, module_name: str, function_name: str):
        """Handle function call event (ENTER)"""
        timestamp_micros = int(time.time() * 1_000_000)

        # Extract arguments
        args_info = self._extract_arguments(frame)

        # Get thread information
        thread_name = threading.current_thread().name

        # Build log entry
        log_entry = {
            'timestamp': timestamp_micros,
            'event': 'ENTER',
            'thread': thread_name,
            'class': module_name,
            'method': function_name,
            'args': str(args_info) if args_info else '[]',
        }

        # Store entry time for duration calculation
        if not hasattr(self._trace_stack, 'stack'):
            self._trace_stack.stack = []
        self._trace_stack.stack.append({
            'timestamp': timestamp_micros,
            'class': module_name,
            'method': function_name,
        })

        self.logger.log(log_entry)

    def _handle_return(self, frame, module_name: str, function_name: str, return_value):
        """Handle function return event (EXIT)"""
        timestamp_micros = int(time.time() * 1_000_000)

        # Get thread information
        thread_name = threading.current_thread().name

        # Calculate duration
        duration_micros = 0
        if hasattr(self._trace_stack, 'stack') and self._trace_stack.stack:
            entry_info = self._trace_stack.stack.pop()
            duration_micros = timestamp_micros - entry_info['timestamp']

        # Serialize return value
        result_info = self._serialize_value(return_value)

        # Build log entry
        log_entry = {
            'timestamp': timestamp_micros,
            'event': 'EXIT',
            'thread': thread_name,
            'class': module_name,
            'method': function_name,
            'result': str(result_info) if result_info is not None else '',
            'durationMicros': duration_micros,
            'durationMillis': duration_micros // 1000,
        }

        self.logger.log(log_entry)

    def _handle_exception(self, frame, module_name: str, function_name: str, exc_info):
        """Handle exception event"""
        timestamp_micros = int(time.time() * 1_000_000)
        thread_name = threading.current_thread().name

        exc_type, exc_value, exc_traceback = exc_info

        # Calculate duration if available
        duration_micros = 0
        if hasattr(self._trace_stack, 'stack') and self._trace_stack.stack:
            entry_info = self._trace_stack.stack.pop()
            duration_micros = timestamp_micros - entry_info['timestamp']

        exc_message = f"{exc_type.__name__}: {str(exc_value)}" if exc_type else str(exc_value)

        log_entry = {
            'timestamp': timestamp_micros,
            'event': 'EXCEPTION',
            'thread': thread_name,
            'class': module_name,
            'method': function_name,
            'exception': exc_message,
            'durationMicros': duration_micros,
            'durationMillis': duration_micros // 1000,
        }

        self.logger.log(log_entry)

    def _extract_arguments(self, frame) -> str:
        """
        Extract function arguments from frame

        Returns:
            JSON string representation of arguments
        """
        code = frame.f_code
        arg_count = code.co_argcount
        arg_names = code.co_varnames[:arg_count]

        args_dict = {}
        for name in arg_names:
            if name in frame.f_locals:
                value = frame.f_locals[name]
                args_dict[name] = self._serialize_value(value)

        return json.dumps(args_dict) if args_dict else '{}'

    def _serialize_value(self, value: Any, max_length: int = 1000) -> str:
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
            if self.config.max_arg_length > 0 and len(serialized) > self.config.max_arg_length:
                serialized = serialized[:self.config.max_arg_length] + '...'

            return serialized
        except (TypeError, ValueError):
            # Fallback to string representation
            try:
                result = str(value)
                if self.config.max_arg_length > 0 and len(result) > self.config.max_arg_length:
                    result = result[:self.config.max_arg_length] + '...'
                return result
            except:
                return '<unserializable>'


# Global tracer instance
_global_tracer: Optional[FlowTraceTracer] = None


def start_tracing(config: Optional[Config] = None):
    """Start global tracing"""
    global _global_tracer
    if _global_tracer is None:
        _global_tracer = FlowTraceTracer(config)
    _global_tracer.start()


def stop_tracing():
    """Stop global tracing"""
    global _global_tracer
    if _global_tracer is not None:
        _global_tracer.stop()
