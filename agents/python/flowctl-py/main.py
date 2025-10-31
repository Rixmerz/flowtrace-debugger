#!/usr/bin/env python3
"""
flowctl-py - CLI tool for FlowTrace Python agent
Analyze and instrument Python code for tracing
"""

import argparse
import sys
from pathlib import Path

from analyzer import Analyzer
from instrumenter import Instrumenter

__version__ = "1.0.0"


def print_header(text: str):
    """Print colored header"""
    print(f"\n\033[1;36m{text}\033[0m")


def print_success(text: str):
    """Print success message"""
    print(f"\033[1;32m{text}\033[0m")


def print_error(text: str):
    """Print error message"""
    print(f"\033[1;31m{text}\033[0m", file=sys.stderr)


def print_warning(text: str):
    """Print warning message"""
    print(f"\033[1;33m{text}\033[0m")


def analyze_command(args):
    """Handle analyze command"""
    print_header("🔍 Analyzing Python project...")

    path = Path(args.path)

    if not path.exists():
        print_error(f"❌ Error: Path not found: {path}")
        sys.exit(1)

    analyzer = Analyzer()

    try:
        stats = analyzer.analyze_path(path)

        print_header("📊 Analysis Results:")
        print(f"  {stats['total_files']} files analyzed")
        print(f"  {stats['total_functions']} total functions found")
        print(f"  \033[32m{stats['instrumentable_functions']}\033[0m instrumentable functions")
        print(f"  \033[34m{stats['instrumented_functions']}\033[0m already instrumented")
        print(f"  {stats['total_lines']} lines of code")

        if args.verbose:
            print_header("📝 Detailed Statistics:")
            print(f"  Async functions: {stats['async_functions']}")
            print(f"  Sync functions: {stats['sync_functions']}")
            print(f"  Class methods: {stats['class_methods']}")
            print(f"  Module functions: {stats['module_functions']}")

        if stats['instrumentable_functions'] > 0:
            print_success("\n💡 Tip: Run 'flowctl-py instrument <file>' to add tracing")

    except Exception as e:
        print_error(f"❌ Error: {e}")
        sys.exit(1)


def instrument_command(args):
    """Handle instrument command"""
    if args.dry_run:
        print_warning("🔍 Dry run - no files will be modified")
    else:
        print_header("🔧 Instrumenting Python code...")

    path = Path(args.path)

    if not path.exists():
        print_error(f"❌ Error: Path not found: {path}")
        sys.exit(1)

    if not path.is_file():
        print_error(f"❌ Error: Path must be a file: {path}")
        sys.exit(1)

    instrumenter = Instrumenter(create_backup=args.backup)

    try:
        result = instrumenter.instrument_file(path, dry_run=args.dry_run)

        if args.dry_run:
            print_header("📝 Functions that would be instrumented:")
            if result['functions']:
                for func_name in result['functions']:
                    print(f"  • \033[34mdef\033[0m \033[33m{func_name}\033[0m")
                print(f"\n  Total: \033[32m{result['count']}\033[0m functions")
            else:
                print("  No functions to instrument")

        else:
            if result['count'] > 0:
                print_success("✅ Instrumentation complete!")
                print(f"\n  \033[32m{result['count']}\033[0m functions instrumented")

                if args.backup and result.get('backup_path'):
                    print(f"  Backup created: {result['backup_path']}")

                print_header("💡 Next steps:")
                print("  1. Configure FlowTrace (see README)")
                print("  2. Run your application")
                print("  3. Check flowtrace.jsonl for traces")
            else:
                print_warning("⚠️ No functions were instrumented")
                print("  All functions are already traced or not eligible")

    except Exception as e:
        print_error(f"❌ Error: {e}")
        sys.exit(1)


def validate_command(args):
    """Handle validate command"""
    print_header("🔍 Validating FlowTrace setup...")

    all_ok = True

    # Check if flowtrace_agent is installed
    try:
        import flowtrace_agent
        print_success("✅ flowtrace_agent package found")
        print(f"   Version: {flowtrace_agent.__version__}")
    except ImportError:
        print_error("❌ flowtrace_agent package not found")
        print("   Install with: pip install flowtrace-agent")
        all_ok = False

    # Check for Python files
    py_files = list(Path.cwd().rglob("*.py"))
    if py_files:
        print_success(f"✅ Found {len(py_files)} Python files")
    else:
        print_warning("⚠️ No Python files found in current directory")

    # Check for requirements.txt or pyproject.toml
    if Path("requirements.txt").exists() or Path("pyproject.toml").exists():
        print_success("✅ Project configuration found")
    else:
        print_warning("⚠️ No requirements.txt or pyproject.toml found")

    # Check for common frameworks
    frameworks = []
    try:
        import flask
        frameworks.append("Flask")
    except ImportError:
        pass

    try:
        import fastapi
        frameworks.append("FastAPI")
    except ImportError:
        pass

    try:
        import django
        frameworks.append("Django")
    except ImportError:
        pass

    if frameworks:
        print_success(f"✅ Frameworks detected: {', '.join(frameworks)}")

    print()
    if all_ok:
        print_success("✅ FlowTrace setup looks good!")
    else:
        print_warning("⚠️ FlowTrace setup needs attention")
        sys.exit(1)


def version_command(args):
    """Handle version command"""
    print(f"\033[1;36mflowctl-py\033[0m {__version__}")
    print("FlowTrace CLI tool for Python")
    print()
    print("Features:")
    print("  • Analyze Python projects")
    print("  • Instrument code with @trace")
    print("  • Validate FlowTrace setup")


def main():
    """Main CLI entry point"""
    parser = argparse.ArgumentParser(
        prog='flowctl-py',
        description='FlowTrace CLI tool for Python - Analyze and instrument Python code',
    )

    subparsers = parser.add_subparsers(dest='command', help='Available commands')

    # Analyze command
    analyze_parser = subparsers.add_parser('analyze', help='Analyze Python project for instrumentable functions')
    analyze_parser.add_argument('path', type=str, help='Path to Python file or directory')
    analyze_parser.add_argument('-v', '--verbose', action='store_true', help='Show detailed statistics')
    analyze_parser.set_defaults(func=analyze_command)

    # Instrument command
    instrument_parser = subparsers.add_parser('instrument', help='Add @trace decorators to functions')
    instrument_parser.add_argument('path', type=str, help='Path to Python file')
    instrument_parser.add_argument('-n', '--dry-run', action='store_true',
                                    help='Preview changes without modifying files')
    instrument_parser.add_argument('-b', '--backup', action='store_true', default=True,
                                    help='Create backup before modifying (default: true)')
    instrument_parser.add_argument('--no-backup', dest='backup', action='store_false',
                                    help='Do not create backup')
    instrument_parser.set_defaults(func=instrument_command)

    # Validate command
    validate_parser = subparsers.add_parser('validate', help='Validate FlowTrace setup')
    validate_parser.set_defaults(func=validate_command)

    # Version command
    version_parser = subparsers.add_parser('version', help='Show version information')
    version_parser.set_defaults(func=version_command)

    # Parse arguments
    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(0)

    # Execute command
    args.func(args)


if __name__ == '__main__':
    main()
