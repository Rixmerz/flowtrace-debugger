"""
Tests for FlowTrace filtering module
"""

import pytest
from flowtrace_agent.filters import should_trace_module


def test_stdlib_filtering():
    """Test filtering of standard library modules"""
    assert should_trace_module('os') is False
    assert should_trace_module('sys') is False
    assert should_trace_module('json') is False
    assert should_trace_module('typing') is False


def test_common_library_filtering():
    """Test filtering of common third-party libraries"""
    assert should_trace_module('django') is False
    assert should_trace_module('flask') is False
    assert should_trace_module('fastapi') is False
    assert should_trace_module('requests') is False


def test_package_prefix_filtering():
    """Test filtering with package prefix"""
    # With prefix 'myapp', only myapp modules should be traced
    assert should_trace_module('myapp.services', package_prefix='myapp') is True
    assert should_trace_module('myapp.models', package_prefix='myapp') is True
    assert should_trace_module('other.module', package_prefix='myapp') is False
    assert should_trace_module('sys', package_prefix='myapp') is False


def test_exclude_patterns():
    """Test filtering with exclude patterns"""
    exclude = ['test', 'debug']

    assert should_trace_module('myapp.services', exclude_patterns=exclude) is True
    assert should_trace_module('test_module', exclude_patterns=exclude) is False
    assert should_trace_module('debug.helper', exclude_patterns=exclude) is False


def test_combined_filtering():
    """Test combined prefix and exclude filtering"""
    assert should_trace_module(
        'myapp.services',
        package_prefix='myapp',
        exclude_patterns=['test']
    ) is True

    assert should_trace_module(
        'myapp.test_utils',
        package_prefix='myapp',
        exclude_patterns=['myapp.test']
    ) is False


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
