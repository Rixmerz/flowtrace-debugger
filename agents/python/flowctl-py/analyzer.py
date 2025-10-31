"""
FlowTrace Python Analyzer
Analyze Python code for instrumentable functions using AST
"""

import ast
from pathlib import Path
from typing import Dict, List


class FunctionVisitor(ast.NodeVisitor):
    """AST visitor to collect function statistics"""

    def __init__(self):
        self.total_functions = 0
        self.async_functions = 0
        self.sync_functions = 0
        self.class_methods = 0
        self.module_functions = 0
        self.instrumented_functions = 0
        self.instrumentable_functions = 0

    def visit_FunctionDef(self, node: ast.FunctionDef):
        """Visit function definition"""
        self._process_function(node, is_async=False)
        self.generic_visit(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef):
        """Visit async function definition"""
        self._process_function(node, is_async=True)
        self.generic_visit(node)

    def _process_function(self, node, is_async: bool):
        """Process a function node"""
        self.total_functions += 1

        # Count async vs sync
        if is_async:
            self.async_functions += 1
        else:
            self.sync_functions += 1

        # Check if it's a class method or module function
        # (in AST, methods are inside ClassDef)
        # We'll track this at a higher level

        # Check if already has @trace decorator
        has_trace = self._has_trace_decorator(node)
        if has_trace:
            self.instrumented_functions += 1
        else:
            # Check if instrumentable
            if self._is_instrumentable(node):
                self.instrumentable_functions += 1

    def _has_trace_decorator(self, node) -> bool:
        """Check if function has @trace decorator"""
        for decorator in node.decorator_list:
            if isinstance(decorator, ast.Name) and decorator.id == 'trace':
                return True
            elif isinstance(decorator, ast.Attribute) and decorator.attr == 'trace':
                return True
        return False

    def _is_instrumentable(self, node) -> bool:
        """Check if function is instrumentable"""
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

        # Check for @pytest or @unittest decorators
        for decorator in node.decorator_list:
            if isinstance(decorator, ast.Name):
                if decorator.id in ('pytest', 'unittest', 'mock', 'patch'):
                    return False
            elif isinstance(decorator, ast.Attribute):
                if decorator.attr in ('fixture', 'mark', 'patch', 'mock'):
                    return False

        return True


class Analyzer:
    """Analyze Python code for tracing opportunities"""

    def __init__(self):
        pass

    def analyze_path(self, path: Path) -> Dict:
        """Analyze a file or directory"""
        if path.is_file():
            return self._analyze_file(path)
        elif path.is_dir():
            return self._analyze_directory(path)
        else:
            raise ValueError(f"Invalid path: {path}")

    def _analyze_directory(self, directory: Path) -> Dict:
        """Analyze all Python files in a directory"""
        total_stats = {
            'total_files': 0,
            'total_functions': 0,
            'instrumentable_functions': 0,
            'instrumented_functions': 0,
            'total_lines': 0,
            'async_functions': 0,
            'sync_functions': 0,
            'class_methods': 0,
            'module_functions': 0,
        }

        # Find all Python files
        py_files = list(directory.rglob("*.py"))

        for py_file in py_files:
            try:
                file_stats = self._analyze_file(py_file)

                # Aggregate stats
                total_stats['total_files'] += 1
                total_stats['total_functions'] += file_stats['total_functions']
                total_stats['instrumentable_functions'] += file_stats['instrumentable_functions']
                total_stats['instrumented_functions'] += file_stats['instrumented_functions']
                total_stats['total_lines'] += file_stats['total_lines']
                total_stats['async_functions'] += file_stats['async_functions']
                total_stats['sync_functions'] += file_stats['sync_functions']
                total_stats['class_methods'] += file_stats['class_methods']
                total_stats['module_functions'] += file_stats['module_functions']

            except (SyntaxError, UnicodeDecodeError):
                # Skip files with syntax errors or encoding issues
                continue

        return total_stats

    def _analyze_file(self, file_path: Path) -> Dict:
        """Analyze a single Python file"""
        # Read file
        content = file_path.read_text(encoding='utf-8')

        # Count lines
        total_lines = len(content.splitlines())

        # Parse AST
        try:
            tree = ast.parse(content, filename=str(file_path))
        except SyntaxError as e:
            raise ValueError(f"Syntax error in {file_path}: {e}")

        # Visit AST
        visitor = FunctionVisitor()
        visitor.visit(tree)

        # Classify functions (module-level vs class methods)
        class_methods, module_functions = self._classify_functions(tree)

        return {
            'total_files': 1,
            'total_functions': visitor.total_functions,
            'instrumentable_functions': visitor.instrumentable_functions,
            'instrumented_functions': visitor.instrumented_functions,
            'total_lines': total_lines,
            'async_functions': visitor.async_functions,
            'sync_functions': visitor.sync_functions,
            'class_methods': class_methods,
            'module_functions': module_functions,
        }

    def _classify_functions(self, tree: ast.AST) -> tuple[int, int]:
        """Classify functions as class methods or module functions"""
        class_methods = 0
        module_functions = 0

        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                # Count methods in this class
                for item in node.body:
                    if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        class_methods += 1

        # Count module-level functions
        if isinstance(tree, ast.Module):
            for node in tree.body:
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    module_functions += 1

        return class_methods, module_functions


if __name__ == '__main__':
    # Test analyzer
    import sys

    if len(sys.argv) > 1:
        path = Path(sys.argv[1])
        analyzer = Analyzer()
        stats = analyzer.analyze_path(path)

        print("Analysis Results:")
        for key, value in stats.items():
            print(f"  {key}: {value}")
