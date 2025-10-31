"""
FlowTrace Configuration
Manages configuration from environment variables and config files
"""

import os
from typing import List, Optional
from dataclasses import dataclass, field


@dataclass
class Config:
    """FlowTrace configuration"""

    # Package/module prefix for filtering
    package_prefix: str = field(default_factory=lambda: os.getenv('FLOWTRACE_PACKAGE_PREFIX', ''))

    # Log file path
    logfile: str = field(default_factory=lambda: os.getenv('FLOWTRACE_LOGFILE', 'flowtrace.jsonl'))

    # Output to stdout
    stdout: bool = field(default_factory=lambda: os.getenv('FLOWTRACE_STDOUT', 'false').lower() == 'true')

    # Maximum argument/return value length (0 = no truncation)
    max_arg_length: int = field(default_factory=lambda: int(os.getenv('FLOWTRACE_MAX_ARG_LENGTH', '1000')))

    # Exclude patterns (comma-separated)
    exclude_patterns: List[str] = field(default_factory=lambda:
        os.getenv('FLOWTRACE_EXCLUDE', '').split(',') if os.getenv('FLOWTRACE_EXCLUDE') else []
    )

    # Enable async logging
    async_logging: bool = field(default_factory=lambda: os.getenv('FLOWTRACE_ASYNC', 'false').lower() == 'true')

    @classmethod
    def from_env(cls) -> 'Config':
        """Create configuration from environment variables"""
        return cls()

    @classmethod
    def from_dict(cls, config_dict: dict) -> 'Config':
        """Create configuration from dictionary"""
        return cls(
            package_prefix=config_dict.get('package_prefix', ''),
            logfile=config_dict.get('logfile', 'flowtrace.jsonl'),
            stdout=config_dict.get('stdout', False),
            max_arg_length=config_dict.get('max_arg_length', 1000),
            exclude_patterns=config_dict.get('exclude_patterns', []),
            async_logging=config_dict.get('async_logging', False),
        )

    def to_dict(self) -> dict:
        """Convert configuration to dictionary"""
        return {
            'package_prefix': self.package_prefix,
            'logfile': self.logfile,
            'stdout': self.stdout,
            'max_arg_length': self.max_arg_length,
            'exclude_patterns': self.exclude_patterns,
            'async_logging': self.async_logging,
        }
