"""
Tests for FlowTrace configuration module
"""

import pytest
import os
from flowtrace_agent import Config


def test_config_defaults():
    """Test default configuration values"""
    config = Config()

    assert config.package_prefix == ''
    assert config.logfile == 'flowtrace.jsonl'
    assert config.stdout is False
    assert config.max_arg_length == 1000
    assert config.exclude_patterns == []


def test_config_from_dict():
    """Test creating config from dictionary"""
    config_dict = {
        'package_prefix': 'myapp',
        'logfile': 'custom.jsonl',
        'stdout': True,
        'max_arg_length': 500,
        'exclude_patterns': ['test', 'debug']
    }

    config = Config.from_dict(config_dict)

    assert config.package_prefix == 'myapp'
    assert config.logfile == 'custom.jsonl'
    assert config.stdout is True
    assert config.max_arg_length == 500
    assert config.exclude_patterns == ['test', 'debug']


def test_config_to_dict():
    """Test converting config to dictionary"""
    config = Config(
        package_prefix='myapp',
        logfile='test.jsonl',
        stdout=True
    )

    config_dict = config.to_dict()

    assert config_dict['package_prefix'] == 'myapp'
    assert config_dict['logfile'] == 'test.jsonl'
    assert config_dict['stdout'] is True


def test_config_from_env(monkeypatch):
    """Test creating config from environment variables"""
    monkeypatch.setenv('FLOWTRACE_PACKAGE_PREFIX', 'myapp')
    monkeypatch.setenv('FLOWTRACE_LOGFILE', 'env.jsonl')
    monkeypatch.setenv('FLOWTRACE_STDOUT', 'true')
    monkeypatch.setenv('FLOWTRACE_MAX_ARG_LENGTH', '2000')
    monkeypatch.setenv('FLOWTRACE_EXCLUDE', 'test,debug')

    config = Config.from_env()

    assert config.package_prefix == 'myapp'
    assert config.logfile == 'env.jsonl'
    assert config.stdout is True
    assert config.max_arg_length == 2000
    assert 'test' in config.exclude_patterns
    assert 'debug' in config.exclude_patterns


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
