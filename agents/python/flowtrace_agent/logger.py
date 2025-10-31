"""
FlowTrace JSONL Logger
Thread-safe JSONL logging with optional async I/O
"""

import json
import sys
import threading
from typing import Dict, Any, Optional
from pathlib import Path

try:
    import aiofiles
    AIOFILES_AVAILABLE = True
except ImportError:
    AIOFILES_AVAILABLE = False


class Logger:
    """
    Thread-safe JSONL logger for FlowTrace events
    """

    def __init__(self, config):
        self.config = config
        self.file_handle = None
        self.lock = threading.Lock()

        # Open log file
        if self.config.logfile:
            log_path = Path(self.config.logfile)
            log_path.parent.mkdir(parents=True, exist_ok=True)
            self.file_handle = open(log_path, 'a', encoding='utf-8')

    def log(self, entry: Dict[str, Any]):
        """
        Log a single event entry

        Args:
            entry: Event data dictionary
        """
        # Serialize to JSON
        try:
            json_line = json.dumps(entry, ensure_ascii=False)
        except (TypeError, ValueError) as e:
            # Fallback: log error
            json_line = json.dumps({
                'event': 'ERROR',
                'message': f'Failed to serialize log entry: {str(e)}',
                'timestamp': entry.get('timestamp', 0)
            })

        with self.lock:
            # Write to file
            if self.file_handle:
                self.file_handle.write(json_line + '\n')
                self.file_handle.flush()

            # Write to stdout if configured
            if self.config.stdout:
                sys.stdout.write(json_line + '\n')
                sys.stdout.flush()

    def close(self):
        """Close the log file"""
        with self.lock:
            if self.file_handle:
                self.file_handle.close()
                self.file_handle = None


class AsyncLogger(Logger):
    """
    Async JSONL logger with queue-based async writing
    """

    def __init__(self, config):
        if not AIOFILES_AVAILABLE:
            raise ImportError("aiofiles is required for async logging. Install with: pip install aiofiles")

        super().__init__(config)

        import asyncio
        import queue

        self.log_queue = queue.Queue()
        self.running = False
        self._loop = None
        self._task = None

    async def _async_writer(self):
        """Async task that writes logs from queue"""
        import aiofiles

        async with aiofiles.open(self.config.logfile, 'a', encoding='utf-8') as f:
            while self.running or not self.log_queue.empty():
                try:
                    entry = self.log_queue.get(timeout=0.1)
                    json_line = json.dumps(entry, ensure_ascii=False)
                    await f.write(json_line + '\n')
                    await f.flush()
                    self.log_queue.task_done()
                except:
                    pass

    def start_async(self):
        """Start async logging"""
        import asyncio

        self.running = True

        try:
            self._loop = asyncio.get_event_loop()
        except RuntimeError:
            self._loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self._loop)

        self._task = self._loop.create_task(self._async_writer())

    def log(self, entry: Dict[str, Any]):
        """Add log entry to queue"""
        self.log_queue.put(entry)

        # Also write to stdout if configured
        if self.config.stdout:
            try:
                json_line = json.dumps(entry, ensure_ascii=False)
                sys.stdout.write(json_line + '\n')
                sys.stdout.flush()
            except:
                pass

    def close(self):
        """Stop async logging and flush queue"""
        self.running = False

        if self._task:
            # Wait for task to complete
            self._loop.run_until_complete(self._task)
