"""
Tests for FlowTrace decorator module
"""

import pytest
import time
import json
import tempfile
from flowtrace_agent import Config, trace, init_decorator_logger


def test_decorator_basic():
    """Test basic decorator functionality"""
    with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.jsonl') as f:
        logfile = f.name

    config = Config(
        package_prefix='__main__',
        logfile=logfile,
        stdout=False
    )

    init_decorator_logger(config)

    @trace
    def add_numbers(a, b):
        return a + b

    result = add_numbers(5, 3)
    assert result == 8

    # Read logs
    with open(logfile, 'r') as f:
        lines = f.readlines()

    assert len(lines) >= 2

    enter_event = json.loads(lines[0])
    exit_event = json.loads(lines[1])

    assert enter_event['event'] == 'ENTER'
    assert enter_event['function'] == 'add_numbers'
    assert exit_event['event'] == 'EXIT'
    assert exit_event['result'] == '8'


def test_decorator_with_exception():
    """Test decorator with exception"""
    with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.jsonl') as f:
        logfile = f.name

    config = Config(
        package_prefix='__main__',
        logfile=logfile,
        stdout=False
    )

    init_decorator_logger(config)

    @trace
    def failing_function():
        raise ValueError("Test error")

    with pytest.raises(ValueError):
        failing_function()

    # Read logs
    with open(logfile, 'r') as f:
        lines = f.readlines()

    events = [json.loads(line) for line in lines]
    event_types = [e['event'] for e in events]

    assert 'ENTER' in event_types
    assert 'EXCEPTION' in event_types

    exception_event = [e for e in events if e['event'] == 'EXCEPTION'][0]
    assert exception_event['exception']['type'] == 'ValueError'


def test_decorator_with_args_and_kwargs():
    """Test decorator with positional and keyword arguments"""
    with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.jsonl') as f:
        logfile = f.name

    config = Config(logfile=logfile, stdout=False)
    init_decorator_logger(config)

    @trace
    def complex_function(a, b, c=None, d=None):
        return f"{a}-{b}-{c}-{d}"

    result = complex_function(1, 2, c=3, d=4)
    assert result == "1-2-3-4"

    # Read logs
    with open(logfile, 'r') as f:
        lines = f.readlines()

    enter_event = json.loads(lines[0])
    args_str = enter_event['args']

    # Check arguments are captured
    assert '"a": 1' in args_str or '"a": "1"' in args_str
    assert '"c": 3' in args_str or '"c": "3"' in args_str


def test_decorator_preserves_function_metadata():
    """Test that decorator preserves function metadata"""
    @trace
    def documented_function():
        """This is a docstring"""
        pass

    assert documented_function.__name__ == 'documented_function'
    assert documented_function.__doc__ == "This is a docstring"


def test_decorator_with_return_value():
    """Test decorator captures return values"""
    with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.jsonl') as f:
        logfile = f.name

    config = Config(logfile=logfile, stdout=False)
    init_decorator_logger(config)

    @trace
    def return_dict():
        return {'key': 'value', 'count': 42}

    result = return_dict()
    assert result == {'key': 'value', 'count': 42}

    # Read logs
    with open(logfile, 'r') as f:
        lines = f.readlines()

    exit_event = json.loads(lines[1])
    assert 'key' in exit_event['result']
    assert 'value' in exit_event['result']


def test_decorator_timing():
    """Test decorator measures execution time"""
    with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.jsonl') as f:
        logfile = f.name

    config = Config(logfile=logfile, stdout=False)
    init_decorator_logger(config)

    @trace
    def slow_function():
        time.sleep(0.1)
        return "done"

    result = slow_function()
    assert result == "done"

    # Read logs
    with open(logfile, 'r') as f:
        lines = f.readlines()

    exit_event = json.loads(lines[1])

    # Should have duration > 100ms (100,000 microseconds)
    assert exit_event['durationMicros'] >= 100000
    assert exit_event['durationMillis'] >= 100


def test_decorator_nested_calls():
    """Test decorator with nested function calls"""
    with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.jsonl') as f:
        logfile = f.name

    config = Config(logfile=logfile, stdout=False)
    init_decorator_logger(config)

    @trace
    def inner_function(x):
        return x * 2

    @trace
    def outer_function(x):
        return inner_function(x) + 1

    result = outer_function(5)
    assert result == 11

    # Read logs
    with open(logfile, 'r') as f:
        lines = f.readlines()

    # Should have events for both functions
    events = [json.loads(line) for line in lines]
    functions = [e['function'] for e in events if e['event'] == 'ENTER']

    assert 'outer_function' in functions
    assert 'inner_function' in functions


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
