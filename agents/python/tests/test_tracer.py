"""
Tests for FlowTrace tracer module
"""

import pytest
import time
import threading
from flowtrace_agent import Config, FlowTraceTracer


def test_tracer_initialization():
    """Test tracer initialization"""
    config = Config(package_prefix='test_module')
    tracer = FlowTraceTracer(config)

    assert tracer.config is not None
    assert tracer.config.package_prefix == 'test_module'
    assert tracer.active is False


def test_tracer_start_stop():
    """Test starting and stopping tracer"""
    tracer = FlowTraceTracer()

    # Start tracing
    tracer.start()
    assert tracer.active is True

    # Stop tracing
    tracer.stop()
    assert tracer.active is False


def test_tracer_function_call():
    """Test tracing a simple function call"""
    import tempfile
    import json

    # Create temp file for output
    with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.jsonl') as f:
        logfile = f.name

    config = Config(
        package_prefix='__main__',
        logfile=logfile,
        stdout=False
    )

    tracer = FlowTraceTracer(config)
    tracer.start()

    # Call a function
    def sample_function(x, y):
        return x + y

    result = sample_function(5, 3)
    assert result == 8

    tracer.stop()

    # Read and verify logs
    with open(logfile, 'r') as f:
        lines = f.readlines()

    assert len(lines) >= 2  # At least ENTER and EXIT

    # Parse first line (ENTER event)
    enter_event = json.loads(lines[0])
    assert enter_event['event'] == 'ENTER'
    assert enter_event['function'] == 'sample_function'
    assert '"x": 5' in enter_event['args']
    assert '"y": 3' in enter_event['args']

    # Parse second line (EXIT event)
    exit_event = json.loads(lines[1])
    assert exit_event['event'] == 'EXIT'
    assert exit_event['function'] == 'sample_function'
    assert exit_event['result'] == '8'
    assert 'durationMicros' in exit_event


def test_tracer_exception_handling():
    """Test tracing function that raises exception"""
    import tempfile
    import json

    with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.jsonl') as f:
        logfile = f.name

    config = Config(
        package_prefix='__main__',
        logfile=logfile,
        stdout=False
    )

    tracer = FlowTraceTracer(config)
    tracer.start()

    def failing_function():
        raise ValueError("Test error")

    try:
        failing_function()
    except ValueError:
        pass

    tracer.stop()

    # Read logs
    with open(logfile, 'r') as f:
        lines = f.readlines()

    # Should have ENTER and EXCEPTION events
    events = [json.loads(line) for line in lines]
    event_types = [e['event'] for e in events]

    assert 'ENTER' in event_types
    assert 'EXCEPTION' in event_types

    # Check exception details
    exception_event = [e for e in events if e['event'] == 'EXCEPTION'][0]
    assert exception_event['exception']['type'] == 'ValueError'
    assert 'Test error' in exception_event['exception']['message']


def test_tracer_filtering():
    """Test module filtering"""
    import tempfile

    with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.jsonl') as f:
        logfile = f.name

    config = Config(
        package_prefix='nonexistent_module',
        logfile=logfile,
        stdout=False
    )

    tracer = FlowTraceTracer(config)
    tracer.start()

    def my_function():
        return 42

    result = my_function()
    assert result == 42

    tracer.stop()

    # Read logs - should be empty due to filtering
    with open(logfile, 'r') as f:
        lines = f.readlines()

    # No events should be logged because module doesn't match filter
    assert len(lines) == 0


def test_tracer_thread_safety():
    """Test tracer with multiple threads"""
    import tempfile
    import json

    with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.jsonl') as f:
        logfile = f.name

    config = Config(
        package_prefix='__main__',
        logfile=logfile,
        stdout=False
    )

    tracer = FlowTraceTracer(config)
    tracer.start()

    def worker_function(n):
        time.sleep(0.01)
        return n * 2

    # Create multiple threads
    threads = []
    for i in range(5):
        t = threading.Thread(target=worker_function, args=(i,))
        threads.append(t)
        t.start()

    # Wait for all threads
    for t in threads:
        t.join()

    tracer.stop()

    # Read logs
    with open(logfile, 'r') as f:
        lines = f.readlines()

    # Should have events from multiple threads
    events = [json.loads(line) for line in lines]
    threads_seen = set(e['thread'] for e in events)

    assert len(threads_seen) >= 2  # At least 2 different threads


def test_tracer_argument_serialization():
    """Test serialization of complex arguments"""
    import tempfile
    import json

    with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.jsonl') as f:
        logfile = f.name

    config = Config(
        package_prefix='__main__',
        logfile=logfile,
        stdout=False,
        max_arg_length=100
    )

    tracer = FlowTraceTracer(config)
    tracer.start()

    def complex_function(data_dict, data_list):
        return len(data_dict) + len(data_list)

    result = complex_function({'a': 1, 'b': 2}, [1, 2, 3])
    assert result == 5

    tracer.stop()

    # Read logs
    with open(logfile, 'r') as f:
        lines = f.readlines()

    enter_event = json.loads(lines[0])
    args_str = enter_event['args']

    # Should contain serialized dict and list
    assert 'data_dict' in args_str
    assert 'data_list' in args_str


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
