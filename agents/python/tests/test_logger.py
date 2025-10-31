"""
Tests for FlowTrace logger module
"""

import pytest
import json
import tempfile
from flowtrace_agent import Config
from flowtrace_agent.logger import Logger


def test_logger_file_output():
    """Test logger writes to file"""
    with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.jsonl') as f:
        logfile = f.name

    config = Config(logfile=logfile, stdout=False)
    logger = Logger(config)

    # Log event
    event = {
        'timestamp': 1635789012345,
        'event': 'ENTER',
        'module': 'test',
        'function': 'test_func'
    }

    logger.log(event)
    logger.close()

    # Read file
    with open(logfile, 'r') as f:
        line = f.readline()

    logged_event = json.loads(line)
    assert logged_event['event'] == 'ENTER'
    assert logged_event['function'] == 'test_func'


def test_logger_json_serialization():
    """Test logger handles serialization errors"""
    with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.jsonl') as f:
        logfile = f.name

    config = Config(logfile=logfile, stdout=False)
    logger = Logger(config)

    # Log event with unserializable object
    class UnserializableClass:
        pass

    event = {
        'timestamp': 1635789012345,
        'event': 'ENTER',
        'data': UnserializableClass()
    }

    # Should not raise exception
    logger.log(event)
    logger.close()

    # Should have written something (error event or fallback)
    with open(logfile, 'r') as f:
        line = f.readline()

    assert line  # File should not be empty


def test_logger_thread_safety():
    """Test logger is thread-safe"""
    import threading

    with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.jsonl') as f:
        logfile = f.name

    config = Config(logfile=logfile, stdout=False)
    logger = Logger(config)

    def worker(n):
        for i in range(10):
            logger.log({
                'timestamp': n * 1000 + i,
                'event': 'TEST',
                'thread': n
            })

    # Create threads
    threads = []
    for i in range(5):
        t = threading.Thread(target=worker, args=(i,))
        threads.append(t)
        t.start()

    # Wait for completion
    for t in threads:
        t.join()

    logger.close()

    # Count lines
    with open(logfile, 'r') as f:
        lines = f.readlines()

    # Should have 50 lines (5 threads * 10 logs each)
    assert len(lines) == 50


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
