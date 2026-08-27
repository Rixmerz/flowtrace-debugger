"""AST transformer for FlowTrace v2 Python capture.

Rewrites FunctionDef and AsyncFunctionDef bodies in-place (not outer wrap)
to inject enter/exit tracing via injected _ft_* helpers.

Note: helper names use a single leading underscore (_ft_enter, _ft_exit,
_ft_exit_error) to avoid Python's double-underscore name-mangling which would
corrupt references inside class bodies.
"""

from __future__ import annotations

import ast
from typing import Union


def _visibility(name: str) -> str:
    """Derive visibility from Python name convention."""
    if name.startswith("__") and name.endswith("__"):
        return "internal"
    if name.startswith("_"):
        return "private"
    return "public"


def _has_yield(node: ast.AST) -> bool:
    """Return True if node directly contains a Yield/YieldFrom (not in nested func).

    ast.walk() flattens the whole subtree up front, so skipping a nested
    FunctionDef/AsyncFunctionDef/Lambda node there only skips that node
    itself -- it still yields the nested function's own children (including
    any Yield/YieldFrom inside it) later in the same walk. Prune manually
    instead of relying on ast.walk().
    """
    for child in ast.iter_child_nodes(node):
        if isinstance(child, (ast.Yield, ast.YieldFrom)):
            return True
        if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
            continue  # Don't descend into nested functions/lambdas.
        if _has_yield(child):
            return True
    return False


def _name(id_: str, ref: ast.AST) -> ast.Name:
    n = ast.Name(id=id_, ctx=ast.Load())
    ast.copy_location(n, ref)
    return n


def _store_name(id_: str, ref: ast.AST) -> ast.Name:
    n = ast.Name(id=id_, ctx=ast.Store())
    ast.copy_location(n, ref)
    return n


def _call(func_name: str, args: list[ast.expr], ref: ast.AST) -> ast.Call:
    c = ast.Call(
        func=_name(func_name, ref),
        args=args,
        keywords=[],
    )
    ast.copy_location(c, ref)
    return c


def _expr_stmt(expr: ast.expr, ref: ast.AST) -> ast.Expr:
    e = ast.Expr(value=expr)
    ast.copy_location(e, ref)
    return e


def _assign(target_id: str, value: ast.expr, ref: ast.AST) -> ast.Assign:
    a = ast.Assign(
        targets=[_store_name(target_id, ref)],
        value=value,
    )
    ast.copy_location(a, ref)
    return a


class FlowtraceTransformer(ast.NodeTransformer):
    """Rewrite function bodies to emit FlowTrace enter/exit events."""

    def __init__(self, module_name: str) -> None:
        self._module_name = module_name
        self._class_stack: list[str] = []

    # ------------------------------------------------------------------
    # Class tracking
    # ------------------------------------------------------------------

    def visit_ClassDef(self, node: ast.ClassDef) -> ast.AST:
        self._class_stack.append(node.name)
        self.generic_visit(node)
        self._class_stack.pop()
        return node

    # ------------------------------------------------------------------
    # Function rewriting
    # ------------------------------------------------------------------

    def visit_FunctionDef(self, node: ast.FunctionDef) -> ast.AST:
        return self._rewrite(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> ast.AST:
        return self._rewrite(node)

    def _rewrite(
        self, node: Union[ast.FunctionDef, ast.AsyncFunctionDef]
    ) -> Union[ast.FunctionDef, ast.AsyncFunctionDef]:
        # First recurse into nested functions / classes.
        self.generic_visit(node)

        ref = node  # Use original node for location copying.
        func_name = node.name
        qualname = ".".join(self._class_stack + [func_name]) if self._class_stack else func_name
        visibility = _visibility(func_name)
        is_generator = _has_yield(node)

        # locals() call to capture args.
        locals_call = ast.Call(
            func=_name("locals", ref),
            args=[],
            keywords=[],
        )
        ast.copy_location(locals_call, ref)

        # _ft_enter call.
        enter_call = _call(
            "_ft_enter",
            [
                ast.Constant(value=self._module_name),
                ast.Constant(value=qualname),
                locals_call,
                ast.Constant(value=visibility),
            ],
            ref,
        )
        for arg in enter_call.args:
            ast.copy_location(arg, ref)

        ctx_assign = _assign("_ft_ctx", enter_call, ref)
        result_default = _assign("_ft_result", ast.copy_location(ast.Constant(value=None), ref), ref)

        # Rewrite Return nodes to capture result. Skip for async generators:
        # CPython only allows bare `return` inside `async def` + `yield`, and
        # the rewriter always produces `return <value>`, which is a
        # SyntaxError there regardless of what the original return contained.
        is_async_generator = isinstance(node, ast.AsyncFunctionDef) and is_generator
        if not is_async_generator:
            node.body = self._rewrite_returns(node.body, ref)
        original_body = node.body

        if is_generator:
            node.body = self._wrap_generator_body(ctx_assign, result_default, original_body, ref)
        else:
            node.body = self._wrap_normal_body(ctx_assign, result_default, original_body, ref)

        ast.fix_missing_locations(node)
        return node

    def _rewrite_returns(self, stmts: list[ast.stmt], ref: ast.AST) -> list[ast.stmt]:
        rewriter = _ReturnRewriter(ref)
        result = []
        for s in stmts:
            visited = rewriter.visit(s)
            if isinstance(visited, list):
                result.extend(visited)
            else:
                result.append(visited)
        return result

    def _wrap_normal_body(
        self,
        ctx_assign: ast.Assign,
        result_default: ast.Assign,
        original_body: list[ast.stmt],
        ref: ast.AST,
    ) -> list[ast.stmt]:
        """
        Emits:
            _ft_exc_raised = False
            try:
                <original body (with return rewritten)>
            except BaseException as _ft_exc:
                _ft_exc_raised = True
                _ft_exit_error(_ft_ctx, _ft_exc)
                raise
            finally:
                if not _ft_exc_raised:
                    _ft_exit(_ft_ctx, _ft_result)
        """
        exc_flag = _assign(
            "_ft_exc_raised",
            ast.copy_location(ast.Constant(value=False), ref),
            ref,
        )

        handler_body = [
            _assign("_ft_exc_raised", ast.copy_location(ast.Constant(value=True), ref), ref),
            _expr_stmt(
                _call("_ft_exit_error", [_name("_ft_ctx", ref), _name("_ft_exc", ref)], ref),
                ref,
            ),
            ast.copy_location(ast.Raise(), ref),
        ]

        handler = ast.ExceptHandler(
            type=_name("BaseException", ref),
            name="_ft_exc",
            body=handler_body,
        )
        ast.copy_location(handler, ref)

        # finally: if not _ft_exc_raised: _ft_exit(...)
        exit_call_stmt = _expr_stmt(
            _call("_ft_exit", [_name("_ft_ctx", ref), _name("_ft_result", ref)], ref),
            ref,
        )
        not_raised = ast.UnaryOp(
            op=ast.Not(),
            operand=_name("_ft_exc_raised", ref),
        )
        ast.copy_location(not_raised, ref)
        if_not_raised = ast.If(
            test=not_raised,
            body=[exit_call_stmt],
            orelse=[],
        )
        ast.copy_location(if_not_raised, ref)

        try_node = ast.Try(
            body=original_body,
            handlers=[handler],
            orelse=[],
            finalbody=[if_not_raised],
        )
        ast.copy_location(try_node, ref)

        return [ctx_assign, result_default, exc_flag, try_node]

    def _wrap_generator_body(
        self,
        ctx_assign: ast.Assign,
        result_default: ast.Assign,
        original_body: list[ast.stmt],
        ref: ast.AST,
    ) -> list[ast.stmt]:
        exc_flag = _assign(
            "_ft_exc_raised",
            ast.copy_location(ast.Constant(value=False), ref),
            ref,
        )

        def make_handler(exc_type_name: str) -> ast.ExceptHandler:
            h = ast.ExceptHandler(
                type=_name(exc_type_name, ref),
                name="_ft_exc",
                body=[
                    _assign("_ft_exc_raised", ast.copy_location(ast.Constant(value=True), ref), ref),
                    _expr_stmt(
                        _call("_ft_exit_error", [_name("_ft_ctx", ref), _name("_ft_exc", ref)], ref),
                        ref,
                    ),
                    ast.copy_location(ast.Raise(), ref),
                ],
            )
            ast.copy_location(h, ref)
            return h

        not_raised = ast.UnaryOp(op=ast.Not(), operand=_name("_ft_exc_raised", ref))
        ast.copy_location(not_raised, ref)
        if_not_raised = ast.If(
            test=not_raised,
            body=[_expr_stmt(_call("_ft_exit", [_name("_ft_ctx", ref), _name("_ft_result", ref)], ref), ref)],
            orelse=[],
        )
        ast.copy_location(if_not_raised, ref)

        # GeneratorExit is a normal generator lifecycle termination (not an error).
        # Catch it separately and route to _ft_exit with result=None.
        gen_exit_handler = ast.ExceptHandler(
            type=_name("GeneratorExit", ref),
            name="_ft_exc",
            body=[
                _assign("_ft_exc_raised", ast.copy_location(ast.Constant(value=True), ref), ref),
                _expr_stmt(
                    _call("_ft_exit", [_name("_ft_ctx", ref), ast.copy_location(ast.Constant(value=None), ref)], ref),
                    ref,
                ),
                ast.copy_location(ast.Raise(), ref),
            ],
        )
        ast.copy_location(gen_exit_handler, ref)

        try_node = ast.Try(
            body=original_body,
            handlers=[gen_exit_handler, make_handler("BaseException")],
            orelse=[],
            finalbody=[if_not_raised],
        )
        ast.copy_location(try_node, ref)

        return [ctx_assign, result_default, exc_flag, try_node]


class _ReturnRewriter(ast.NodeTransformer):
    """Rewrite `return <expr>` to `_ft_result = <expr>; return _ft_result`."""

    def __init__(self, ref: ast.AST) -> None:
        self._ref = ref

    def visit_FunctionDef(self, node: ast.FunctionDef) -> ast.AST:
        return node  # Don't recurse into nested functions.

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> ast.AST:
        return node

    def visit_Return(self, node: ast.Return) -> list[ast.stmt]:
        ref = node  # Use return node for location.
        value = node.value if node.value is not None else ast.copy_location(ast.Constant(value=None), ref)
        assign = ast.Assign(
            targets=[ast.copy_location(ast.Name(id="_ft_result", ctx=ast.Store()), ref)],
            value=value,
        )
        ast.copy_location(assign, ref)
        ret = ast.Return(value=ast.copy_location(ast.Name(id="_ft_result", ctx=ast.Load()), ref))
        ast.copy_location(ret, ref)
        return [assign, ret]
