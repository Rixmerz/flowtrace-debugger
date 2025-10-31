"""
FlowTrace Python Instrumenter
Automatically add @trace decorators to Python functions
"""

import ast
import astor
from pathlib import Path
from typing import List, Dict
import shutil


class TraceInstrumenter(ast.NodeTransformer):
    """AST transformer to add @trace decorators"""

    def __init__(self):
        self.instrumented_functions: List[str] = []

    def visit_FunctionDef(self, node: ast.FunctionDef):
        """Visit function definition"""
        if self._should_instrument(node):
            # Add @trace decorator
            trace_decorator = ast.Name(id='trace', ctx=ast.Load())
            node.decorator_list.insert(0, trace_decorator)
            self.instrumented_functions.append(node.name)

        self.generic_visit(node)
        return node

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef):
        """Visit async function definition"""
        if self._should_instrument(node):
            # Add @trace decorator
            trace_decorator = ast.Name(id='trace', ctx=ast.Load())
            node.decorator_list.insert(0, trace_decorator)
            self.instrumented_functions.append(f"{node.name} (async)")

        self.generic_visit(node)
        return node

    def _should_instrument(self, node) -> bool:
        """Check if function should be instrumented"""
        # Don't instrument if already has @trace
        if self._has_trace_decorator(node):
            return False

        # Don't instrument if empty
        if not node.body:
            return False

        # Don't instrument if only contains 'pass' or docstring
        if len(node.body) == 1:
            stmt = node.body[0]
            if isinstance(stmt, ast.Pass):
                return False
            if isinstance(stmt, ast.Expr) and isinstance(stmt.value, (ast.Str, ast.Constant)):
                return False

        # Don't instrument special methods (except __init__)
        name = node.name
        if name.startswith('__') and name.endswith('__') and name != '__init__':
            return False

        # Don't instrument test functions
        if name.startswith('test_'):
            return False

        # Check for test decorators
        for decorator in node.decorator_list:
            if isinstance(decorator, ast.Name):
                if decorator.id in ('pytest', 'unittest', 'mock', 'patch'):
                    return False
            elif isinstance(decorator, ast.Attribute):
                if decorator.attr in ('fixture', 'mark', 'patch', 'mock'):
                    return False

        return True

    def _has_trace_decorator(self, node) -> bool:
        """Check if function already has @trace decorator"""
        for decorator in node.decorator_list:
            if isinstance(decorator, ast.Name) and decorator.id == 'trace':
                return True
            elif isinstance(decorator, ast.Attribute) and decorator.attr == 'trace':
                return True
        return False


class Instrumenter:
    """Instrument Python code with @trace decorators"""

    def __init__(self, create_backup: bool = True):
        self.create_backup = create_backup

    def instrument_file(self, file_path: Path, dry_run: bool = False) -> Dict:
        """Instrument a Python file"""
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        if not file_path.is_file():
            raise ValueError(f"Path is not a file: {file_path}")

        # Read file
        content = file_path.read_text(encoding='utf-8')

        # Parse AST
        try:
            tree = ast.parse(content, filename=str(file_path))
        except SyntaxError as e:
            raise ValueError(f"Syntax error in {file_path}: {e}")

        # Transform AST
        instrumenter = TraceInstrumenter()
        new_tree = instrumenter.visit(tree)
        ast.fix_missing_locations(new_tree)

        # Get instrumented function names
        functions = instrumenter.instrumented_functions
        count = len(functions)

        result = {
            'count': count,
            'functions': functions,
            'backup_path': None
        }

        # If dry run, don't modify file
        if dry_run:
            return result

        # If no functions instrumented, don't modify file
        if count == 0:
            return result

        # Create backup if requested
        backup_path = None
        if self.create_backup:
            backup_path = file_path.with_suffix('.py.bak')
            shutil.copy2(file_path, backup_path)
            result['backup_path'] = str(backup_path)

        # Check if 'trace' import exists
        has_trace_import = self._check_trace_import(tree)

        # Generate new code
        try:
            new_code = astor.to_source(new_tree)
        except Exception:
            # Fallback: use ast.unparse (Python 3.9+)
            try:
                new_code = ast.unparse(new_tree)
            except AttributeError:
                raise RuntimeError("Failed to generate code. Install 'astor' package: pip install astor")

        # Add import if needed
        if not has_trace_import:
            new_code = "from flowtrace_agent import trace\n\n" + new_code

        # Write modified file
        file_path.write_text(new_code, encoding='utf-8')

        return result

    def _check_trace_import(self, tree: ast.AST) -> bool:
        """Check if 'trace' is imported"""
        for node in ast.walk(tree):
            # from flowtrace_agent import trace
            if isinstance(node, ast.ImportFrom):
                if node.module == 'flowtrace_agent':
                    for alias in node.names:
                        if alias.name == 'trace':
                            return True

            # import flowtrace_agent (with trace used as flowtrace_agent.trace)
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name == 'flowtrace_agent':
                        return True

        return False


if __name__ == '__main__':
    # Test instrumenter
    import sys

    if len(sys.argv) > 1:
        path = Path(sys.argv[1])
        instrumenter = Instrumenter(create_backup=True)

        result = instrumenter.instrument_file(path, dry_run=False)

        print("Instrumentation Results:")
        print(f"  Functions instrumented: {result['count']}")
        print(f"  Functions: {', '.join(result['functions'])}")
        if result['backup_path']:
            print(f"  Backup: {result['backup_path']}")
