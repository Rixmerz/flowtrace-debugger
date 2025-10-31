"""
FlowTrace Filters
Module and package filtering logic
"""

from typing import List


def should_trace_module(module_name: str, package_prefix: str = '', exclude_patterns: List[str] = None) -> bool:
    """
    Determine if a module should be traced based on filtering rules

    Args:
        module_name: Full module name (e.g., 'myapp.services.user')
        package_prefix: Package prefix to include (e.g., 'myapp', 'src')
        exclude_patterns: List of patterns to exclude

    Returns:
        True if module should be traced, False otherwise
    """
    if exclude_patterns is None:
        exclude_patterns = []

    # Exclude standard library and builtins
    if _is_stdlib_or_builtin(module_name):
        return False

    # Exclude common third-party frameworks/libraries
    if _is_common_library(module_name):
        return False

    # Apply exclude patterns
    for pattern in exclude_patterns:
        if pattern and module_name.startswith(pattern.strip()):
            return False

    # If package prefix is specified, only trace matching modules
    if package_prefix:
        prefixes = [p.strip() for p in package_prefix.split(',') if p.strip()]
        return any(module_name.startswith(prefix) for prefix in prefixes)

    # If no prefix specified, trace all non-excluded modules
    return True


def _is_stdlib_or_builtin(module_name: str) -> bool:
    """Check if module is part of Python standard library or builtins"""
    # Special case: __main__ should NOT be excluded (it's the user's script)
    if module_name == '__main__':
        return False

    stdlib_prefixes = [
        '__',  # Builtins like __builtin__, __future__, etc.
        '_',   # Internal modules
        'abc', 'aifc', 'argparse', 'array', 'ast', 'asyncio', 'atexit',
        'base64', 'bdb', 'binascii', 'bisect', 'builtins',
        'calendar', 'cgi', 'chunk', 'cmd', 'code', 'codecs', 'collections',
        'colorsys', 'compileall', 'concurrent', 'configparser', 'contextlib',
        'copy', 'copyreg', 'cProfile', 'csv', 'ctypes',
        'dataclasses', 'datetime', 'dbm', 'decimal', 'difflib', 'dis', 'doctest',
        'email', 'encodings', 'enum', 'errno',
        'faulthandler', 'fcntl', 'filecmp', 'fileinput', 'fnmatch', 'fractions', 'functools',
        'gc', 'getopt', 'getpass', 'gettext', 'glob', 'grp', 'gzip',
        'hashlib', 'heapq', 'hmac', 'html', 'http',
        'imaplib', 'imghdr', 'importlib', 'inspect', 'io', 'ipaddress', 'itertools',
        'json',
        'keyword',
        'lib2to3', 'linecache', 'locale', 'logging',
        'mailbox', 'mailcap', 'marshal', 'math', 'mimetypes', 'mmap', 'modulefinder', 'multiprocessing',
        'netrc', 'numbers',
        'operator', 'optparse', 'os',
        'pathlib', 'pdb', 'pickle', 'pickletools', 'pipes', 'pkgutil', 'platform',
        'plistlib', 'poplib', 'posix', 'posixpath', 'pprint', 'profile', 'pstats', 'pty', 'pwd', 'py_compile', 'pyclbr', 'pydoc',
        'queue', 'quopri',
        'random', 're', 'readline', 'reprlib', 'resource', 'rlcompleter', 'runpy',
        'sched', 'secrets', 'select', 'selectors', 'shelve', 'shlex', 'shutil', 'signal',
        'site', 'smtpd', 'smtplib', 'sndhdr', 'socket', 'socketserver', 'sqlite3',
        'ssl', 'stat', 'statistics', 'string', 'stringprep', 'struct', 'subprocess',
        'sunau', 'symbol', 'symtable', 'sys', 'sysconfig', 'syslog',
        'tabnanny', 'tarfile', 'telnetlib', 'tempfile', 'termios', 'test', 'textwrap',
        'threading', 'time', 'timeit', 'tkinter', 'token', 'tokenize', 'trace', 'traceback',
        'tracemalloc', 'tty', 'turtle', 'types', 'typing',
        'unicodedata', 'unittest', 'urllib', 'uuid',
        'venv',
        'warnings', 'wave', 'weakref', 'webbrowser', 'winreg', 'winsound',
        'wsgiref',
        'xml', 'xmlrpc',
        'zipapp', 'zipfile', 'zipimport', 'zlib',
    ]

    for prefix in stdlib_prefixes:
        if module_name.startswith(prefix):
            return True

    return False


def _is_common_library(module_name: str) -> bool:
    """Check if module is a common third-party library"""
    common_libraries = [
        'pip', 'setuptools', 'wheel', 'pkg_resources',
        'numpy', 'pandas', 'scipy', 'matplotlib', 'sklearn',
        'requests', 'urllib3', 'certifi', 'chardet', 'idna',
        'django', 'flask', 'fastapi', 'starlette', 'uvicorn',
        'sqlalchemy', 'psycopg2', 'pymongo', 'redis',
        'celery', 'kombu', 'amqp',
        'pytest', 'unittest2', 'nose', 'coverage',
        'six', 'click', 'jinja2', 'werkzeug',
        'aiohttp', 'asyncpg', 'aiomysql',
        'pydantic', 'marshmallow', 'attrs',
        'cryptography', 'bcrypt', 'passlib',
        'pillow', 'opencv',
    ]

    for lib in common_libraries:
        if module_name.startswith(lib):
            return True

    return False
