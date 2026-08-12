/**
 * AST transform: Option B (Babel) implementation.
 *
 * DEVIATION from architecture doc: The architect spec listed swc as the
 * visitor engine, but swc's JS API does not expose a pluggable visitor for
 * Node.js code.  We use @babel/parser + @babel/traverse + @babel/generator
 * for AST manipulation, and @swc/core only for TypeScript stripping when the
 * input file has TS syntax.  This is documented as "Option B (MVP-acceptable)"
 * in the sprint brief.
 */

import { createRequire } from 'node:module';
import { basename, extname } from 'node:path';

// Use createRequire so this ESM file can load the CJS Babel packages.
const require = createRequire(import.meta.url);

const parser   = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t        = require('@babel/types');

// Lazy-load swc only when needed (TS stripping).
let _swc = null;
function getSwc() {
  if (!_swc) _swc = require('@swc/core'); // pnpm dep
  return _swc;
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/**
 * Derive a short module identifier from a file path.
 * e.g. "/project/src/calculator.ts" -> "calculator"
 */
function moduleId(filename) {
  return basename(filename, extname(filename));
}

/**
 * Build the CJS prologue require statement node.
 * const {__ft_enter,__ft_exit,__ft_exit_error,__ft_run} = require('...');
 */
function buildCjsImport(runtimePath) {
  return t.variableDeclaration('const', [
    t.variableDeclarator(
      t.objectPattern([
        t.objectProperty(t.identifier('__ft_enter'), t.identifier('__ft_enter'), false, true),
        t.objectProperty(t.identifier('__ft_exit'), t.identifier('__ft_exit'), false, true),
        t.objectProperty(t.identifier('__ft_exit_error'), t.identifier('__ft_exit_error'), false, true),
        t.objectProperty(t.identifier('__ft_run'), t.identifier('__ft_run'), false, true),
      ]),
      t.callExpression(t.identifier('require'), [t.stringLiteral(runtimePath)])
    ),
  ]);
}

/**
 * Build the ESM import declaration node.
 * import {__ft_enter,...} from '...';
 */
function buildEsmImport(runtimePath) {
  return t.importDeclaration(
    [
      t.importSpecifier(t.identifier('__ft_enter'), t.identifier('__ft_enter')),
      t.importSpecifier(t.identifier('__ft_exit'), t.identifier('__ft_exit')),
      t.importSpecifier(t.identifier('__ft_exit_error'), t.identifier('__ft_exit_error')),
      t.importSpecifier(t.identifier('__ft_run'), t.identifier('__ft_run')),
    ],
    t.stringLiteral(runtimePath)
  );
}

/**
 * Collect formal parameter names from a function node.
 * Destructured params fall back to positional arg0, arg1, …
 * @param {import('@babel/types').Function} node
 * @returns {string[]}
 */
function collectParamNames(node) {
  return node.params.map((p, i) => {
    if (t.isIdentifier(p)) return p.name;
    if (t.isAssignmentPattern(p) && t.isIdentifier(p.left)) return p.left.name;
    if (t.isRestElement(p) && t.isIdentifier(p.argument)) return p.argument.name;
    return `arg${i}`;
  });
}

/**
 * Determine visibility from method key + private flag.
 * @param {import('@babel/types').ClassMethod|import('@babel/types').ClassPrivateMethod} node
 * @returns {'public'|'private'}
 */
function methodVisibility(node) {
  if (t.isClassPrivateMethod(node)) return 'private';
  if (node.accessibility === 'private') return 'private';
  return 'public';
}

/**
 * Get method name string from a ClassMethod or ClassPrivateMethod key.
 * Private methods (#foo) include the hash prefix.
 */
function methodName(node) {
  if (t.isClassPrivateMethod(node)) {
    return `#${node.key.id.name}`;
  }
  if (t.isIdentifier(node.key)) return node.key.name;
  if (t.isStringLiteral(node.key)) return node.key.value;
  return '<anonymous>';
}

/**
 * Build the instrumented block for a function body.
 *
 * Wraps the original body in:
 *
 *   const __ft_ctx = __ft_enter(module, class, method, visibility, [...params], arguments);
 *   let __ft_result;
 *   try {
 *     __ft_result = __ft_run(__ft_ctx, () => { <original body> });
 *   } catch (__ft_err) {
 *     __ft_exit_error(__ft_ctx, module, class, method, visibility, [...params], arguments, __ft_err);
 *     throw __ft_err;
 *   }
 *   __ft_exit(__ft_ctx, module, class, method, visibility, [...params], arguments, __ft_result);
 *   return __ft_result;
 *
 * For async functions, __ft_run wraps an async IIFE (preserving await).
 * For generator functions we skip instrumentation (MVP).
 *
 * @param {import('@babel/types').BlockStatement} originalBody
 * @param {string} mod
 * @param {string|null} cls
 * @param {string} method
 * @param {'public'|'private'} visibility
 * @param {string[]} paramNames
 * @param {boolean} isAsync
 * @param {boolean} isArrow - arrows have no `arguments`; use rest param capture
 * @returns {import('@babel/types').BlockStatement}
 */
function buildInstrumentedBody(originalBody, mod, cls, method, visibility, paramNames, isAsync, isArrow) {
  const modLit    = t.stringLiteral(mod);
  const clsLit    = cls ? t.stringLiteral(cls) : t.nullLiteral();
  const methodLit = t.stringLiteral(method);
  const visLit    = t.stringLiteral(visibility);
  const paramsArr = t.arrayExpression(paramNames.map(n => t.stringLiteral(n)));

  // For arrow functions, `arguments` is not available; use a captured array
  // __ft_args that we inject via a rest parameter trick at call sites.
  // Simpler approach: build an array from the param identifiers directly.
  const argsExpr = isArrow
    ? t.arrayExpression(paramNames.map(n => t.identifier(n)))
    : t.identifier('arguments');

  // const __ft_ctx = __ft_enter(...)
  const ctxDecl = t.variableDeclaration('const', [
    t.variableDeclarator(
      t.identifier('__ft_ctx'),
      t.callExpression(t.identifier('__ft_enter'), [modLit, clsLit, methodLit, visLit, paramsArr, argsExpr])
    ),
  ]);

  // let __ft_result;
  const resultDecl = t.variableDeclaration('let', [
    t.variableDeclarator(t.identifier('__ft_result')),
  ]);

  // Build the inner function for __ft_run.
  // We wrap originalBody statements in a block that returns the last expression.
  // Strategy: replace each `return X` in the original body with
  //   return (__ft_result = X);
  // Then after the try/catch we emit exit and `return __ft_result`.

  // Clone original body statements, rewriting return statements.
  const rewrittenStatements = rewriteReturns(originalBody.body);

  let innerFn;
  if (isAsync) {
    innerFn = t.arrowFunctionExpression([], t.blockStatement(rewrittenStatements), true);
  } else {
    innerFn = t.arrowFunctionExpression([], t.blockStatement(rewrittenStatements));
  }

  // __ft_run(__ft_ctx, innerFn) — possibly awaited for async
  let runCall = t.callExpression(t.identifier('__ft_run'), [t.identifier('__ft_ctx'), innerFn]);
  if (isAsync) {
    runCall = t.awaitExpression(runCall);
  }

  // __ft_result = <runCall>
  const tryBody = t.blockStatement([
    t.expressionStatement(
      t.assignmentExpression('=', t.identifier('__ft_result'), runCall)
    ),
  ]);

  // catch (__ft_err)
  const catchBody = t.blockStatement([
    t.expressionStatement(
      t.callExpression(t.identifier('__ft_exit_error'), [
        t.identifier('__ft_ctx'), modLit, clsLit, methodLit, visLit, paramsArr, argsExpr,
        t.identifier('__ft_err'),
      ])
    ),
    t.throwStatement(t.identifier('__ft_err')),
  ]);

  const tryCatch = t.tryStatement(
    tryBody,
    t.catchClause(t.identifier('__ft_err'), catchBody)
  );

  // __ft_exit(...)
  const exitCall = t.expressionStatement(
    t.callExpression(t.identifier('__ft_exit'), [
      t.identifier('__ft_ctx'), modLit, clsLit, methodLit, visLit, paramsArr, argsExpr,
      t.identifier('__ft_result'),
    ])
  );

  // return __ft_result;
  const returnResult = t.returnStatement(t.identifier('__ft_result'));

  return t.blockStatement([ctxDecl, resultDecl, tryCatch, exitCall, returnResult]);
}

/**
 * Recursively rewrite `return X` statements to `return (__ft_result = X)`.
 * Skips nested function bodies (they have their own scope).
 */
function rewriteReturns(statements) {
  // We do a simple recursive clone using Babel types traversal.
  // To avoid modifying the original AST nodes we rebuild.
  return statements.map(stmt => rewriteStmt(stmt));
}

function rewriteStmt(node) {
  if (!node) return node;
  if (t.isReturnStatement(node)) {
    const arg = node.argument
      ? t.assignmentExpression('=', t.identifier('__ft_result'), node.argument)
      : t.identifier('__ft_result');
    return t.returnStatement(arg);
  }
  if (t.isBlockStatement(node)) {
    return t.blockStatement(node.body.map(rewriteStmt));
  }
  if (t.isIfStatement(node)) {
    return t.ifStatement(
      node.test,
      rewriteStmt(node.consequent),
      node.alternate ? rewriteStmt(node.alternate) : null
    );
  }
  if (t.isTryStatement(node)) {
    return t.tryStatement(
      rewriteStmt(node.block),
      node.handler ? t.catchClause(node.handler.param, rewriteStmt(node.handler.body)) : null,
      node.finalizer ? rewriteStmt(node.finalizer) : null
    );
  }
  // For other statement types, leave as-is (loops, switch, etc.).
  // A full production implementation would recurse into all statement types.
  return node;
}

// ────────────────────────────────────────────────────────────
// Main transform entry point
// ────────────────────────────────────────────────────────────

/**
 * @typedef {Object} TransformOptions
 * @property {string} filename - Absolute path of the source file.
 * @property {'cjs'|'esm'} [moduleType] - Override module type detection.
 * @property {string} [runtimePath] - Path/specifier for the runtime helpers import.
 */

/**
 * Transform source code: strip TS if needed, then inject FlowTrace instrumentation.
 *
 * @param {string} source
 * @param {TransformOptions} opts
 * @returns {{ code: string, map: object|null }}
 */
export function transform(source, opts = {}) {
  const filename = opts.filename ?? '<unknown>';
  const ext = extname(filename).toLowerCase();
  const isTs = ext === '.ts' || ext === '.tsx' || ext === '.mts' || ext === '.cts';
  const runtimePath = opts.runtimePath ?? '@flowtrace/capture-node/runtime/instrument';

  let jsSource = source;

  // Step 1: Strip TypeScript via swc if needed.
  if (isTs) {
    try {
      const swc = getSwc();
      const stripped = swc.transformSync(source, {
        filename,
        jsc: {
          parser: {
            syntax: 'typescript',
            tsx: ext === '.tsx',
            dynamicImport: true,
          },
          target: 'es2022',
        },
        // Only downlevel modules on the CJS path. Hardcoding 'commonjs' here
        // rewrote ESM TypeScript into `exports.*` assignments, which then blew
        // up with "exports is not defined in ES module scope". Omitting the
        // option leaves the original import/export syntax untouched.
        ...(opts.moduleType === 'esm' ? {} : { module: { type: 'commonjs' } }),
        sourceMaps: false,
      });
      jsSource = stripped.code;
    } catch (e) {
      // Fall through — let Babel try to parse it (may fail, that's ok).
      process.stderr.write(`[flowtrace] swc TS strip failed for ${filename}: ${e.message}\n`);
    }
  }

  // Step 2: Parse with Babel.
  let ast;
  try {
    ast = parser.parse(jsSource, {
      sourceType: 'unambiguous',
      plugins: [
        'classProperties',
        'classPrivateMethods',
        'classPrivateProperties',
        'asyncGenerators',
        'dynamicImport',
        'optionalChaining',
        'nullishCoalescingOperator',
      ],
    });
  } catch (e) {
    process.stderr.write(`[flowtrace] babel parse failed for ${filename}: ${e.message}\n`);
    return { code: source, map: null };
  }

  const mod = moduleId(filename);

  // Detect module type for the runtime import.
  let moduleType = opts.moduleType;
  if (!moduleType) {
    moduleType = ast.program.sourceType === 'module' ? 'esm' : 'cjs';
  }

  // Step 3: Traverse & instrument.
  let currentClass = null;

  traverse(ast, {
    ClassDeclaration: {
      enter(path) { currentClass = path.node.id ? path.node.id.name : '<anonymous>'; },
      exit()       { currentClass = null; },
    },
    ClassExpression: {
      enter(path) { currentClass = path.node.id ? path.node.id.name : '<anonymous>'; },
      exit()       { currentClass = null; },
    },

    ClassMethod(path) {
      // Skip constructors.
      if (path.node.kind === 'constructor') return;
      // Skip generators (MVP).
      if (path.node.generator) return;
      // Skip already-wrapped nodes to prevent infinite recursion.
      if (path.node._flowtraceWrapped) return;

      const name  = methodName(path.node);
      const vis   = methodVisibility(path.node);
      const params = collectParamNames(path.node);
      const isAsync = path.node.async;

      path.node._flowtraceWrapped = true;
      path.node.body = buildInstrumentedBody(
        path.node.body, mod, currentClass, name, vis, params, isAsync, false
      );
      path.skip();
    },

    ClassPrivateMethod(path) {
      if (path.node.generator) return;
      if (path.node._flowtraceWrapped) return;

      const name   = `#${path.node.key.id.name}`;
      const params = collectParamNames(path.node);
      const isAsync = path.node.async;

      path.node._flowtraceWrapped = true;
      path.node.body = buildInstrumentedBody(
        path.node.body, mod, currentClass, name, 'private', params, isAsync, false
      );
      path.skip();
    },

    FunctionDeclaration(path) {
      if (path.node.generator) return;
      // Skip if it's a method (parent is class) — handled above.
      if (path.parent && (t.isClassBody(path.parent) || t.isObjectExpression(path.parent))) return;
      if (path.node._flowtraceWrapped) return;

      const name   = path.node.id ? path.node.id.name : '<anonymous>';
      const params = collectParamNames(path.node);
      const isAsync = path.node.async;

      path.node._flowtraceWrapped = true;
      path.node.body = buildInstrumentedBody(
        path.node.body, mod, null, name, 'public', params, isAsync, false
      );
      path.skip();
    },

    FunctionExpression(path) {
      if (path.node.generator) return;
      if (path.node._flowtraceWrapped) return;

      // Skip object method shorthand (handled separately if needed).
      const name  = path.node.id ? path.node.id.name : (
        path.parent && t.isVariableDeclarator(path.parent) && t.isIdentifier(path.parent.id)
          ? path.parent.id.name
          : '<anonymous>'
      );
      const params = collectParamNames(path.node);
      const isAsync = path.node.async;

      path.node._flowtraceWrapped = true;
      path.node.body = buildInstrumentedBody(
        path.node.body, mod, null, name, 'public', params, isAsync, false
      );
      path.skip();
    },

    ArrowFunctionExpression(path) {
      if (path.node.generator) return;
      if (path.node._flowtraceWrapped) return;

      // Expand concise arrow body to block.
      if (!t.isBlockStatement(path.node.body)) {
        const conciseExpr = path.node.body;
        path.node.body = t.blockStatement([t.returnStatement(conciseExpr)]);
      }

      const name  = path.parent && t.isVariableDeclarator(path.parent) && t.isIdentifier(path.parent.id)
        ? path.parent.id.name
        : '<anonymous>';
      const params = collectParamNames(path.node);
      const isAsync = path.node.async;

      path.node._flowtraceWrapped = true;
      path.node.body = buildInstrumentedBody(
        path.node.body, mod, null, name, 'public', params, isAsync, true
      );
      path.skip();
    },
  });

  // Step 4: Prepend runtime import.
  const importNode = moduleType === 'esm'
    ? buildEsmImport(runtimePath)
    : buildCjsImport(runtimePath);

  ast.program.body.unshift(importNode);

  // Step 5: Generate code.
  try {
    const result = generate(ast, {
      sourceMaps: true,
      sourceFileName: filename,
      retainLines: false,
      compact: false,
    }, jsSource);
    return { code: result.code, map: result.map };
  } catch (e) {
    process.stderr.write(`[flowtrace] babel generate failed for ${filename}: ${e.message}\n`);
    return { code: source, map: null };
  }
}
