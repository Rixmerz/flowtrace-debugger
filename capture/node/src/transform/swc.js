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
 * Arrow functions have no `arguments` object, so the captured args are built
 * from the parameter bindings themselves. A destructured parameter has no
 * single binding to reference — `({a, b}) => …` used to be captured as
 * `[arg0]`, an identifier nobody declared, and the traced app died with
 * `ReferenceError: arg0 is not defined` on the first call.
 *
 * The fix rewrites each pattern parameter into a plain identifier and moves
 * the destructuring to the top of the body:
 *
 *   ({a, b} = {}, ...[c]) => body
 *   ⇒ (__ft_p0 = {}, ...__ft_p1) => { var {a, b} = __ft_p0; var [c] = __ft_p1; body }
 *
 * `var`, not `const`: parameter bindings are function-scoped, so a body that
 * later re-declares one with `var` must keep working. Defaults stay on the
 * parameter, so they apply exactly when they did before (argument undefined),
 * and earlier parameters remain visible to later defaults.
 *
 * Returns the identifiers to capture, in parameter order, plus the prologue
 * statements to prepend to the body. Mutates node.params.
 *
 * @param {import('@babel/types').ArrowFunctionExpression} node
 * @returns {{ argExprs: import('@babel/types').Expression[], prologue: import('@babel/types').Statement[] }}
 */
function bindArrowParams(node) {
  const argExprs = [];
  const prologue = [];
  node.params = node.params.map((p, i) => {
    if (t.isIdentifier(p)) {
      argExprs.push(t.identifier(p.name));
      return p;
    }
    if (t.isAssignmentPattern(p) && t.isIdentifier(p.left)) {
      argExprs.push(t.identifier(p.left.name));
      return p;
    }
    if (t.isRestElement(p) && t.isIdentifier(p.argument)) {
      argExprs.push(t.identifier(p.argument.name));
      return p;
    }
    const synthetic = t.identifier(`__ft_p${i}`);
    argExprs.push(t.identifier(synthetic.name));
    if (t.isAssignmentPattern(p)) {
      prologue.push(t.variableDeclaration('var', [t.variableDeclarator(p.left, t.identifier(synthetic.name))]));
      return t.assignmentPattern(synthetic, p.right);
    }
    if (t.isRestElement(p)) {
      prologue.push(t.variableDeclaration('var', [t.variableDeclarator(p.argument, t.identifier(synthetic.name))]));
      return t.restElement(synthetic);
    }
    // ObjectPattern / ArrayPattern (TS parameter properties never reach an arrow).
    prologue.push(t.variableDeclaration('var', [t.variableDeclarator(p, t.identifier(synthetic.name))]));
    return synthetic;
  });
  return { argExprs, prologue };
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
 * @param {import('@babel/types').Expression[]|null} arrowArgs - arrows have no
 *   `arguments`; the identifiers to capture instead (see bindArrowParams)
 * @param {string} lang - "node" or "ts", baked into every event of this file
 * @returns {import('@babel/types').BlockStatement}
 */
function buildInstrumentedBody(originalBody, mod, cls, method, visibility, paramNames, isAsync, arrowArgs, lang) {
  const modLit    = t.stringLiteral(mod);
  const clsLit    = cls ? t.stringLiteral(cls) : t.nullLiteral();
  const methodLit = t.stringLiteral(method);
  const visLit    = t.stringLiteral(visibility);
  const langLit   = t.stringLiteral(lang);
  const paramsArr = t.arrayExpression(paramNames.map(n => t.stringLiteral(n)));

  const argsExpr = arrowArgs
    ? t.arrayExpression(arrowArgs)
    : t.identifier('arguments');

  // const __ft_ctx = __ft_enter(...)
  const ctxDecl = t.variableDeclaration('const', [
    t.variableDeclarator(
      t.identifier('__ft_ctx'),
      t.callExpression(t.identifier('__ft_enter'), [modLit, clsLit, methodLit, visLit, paramsArr, argsExpr, langLit])
    ),
  ]);

  // let __ft_result;
  const resultDecl = t.variableDeclaration('let', [
    t.variableDeclarator(t.identifier('__ft_result')),
  ]);

  // The original body becomes the body of an inner arrow handed to __ft_run,
  // whose return value is the function's return value: `return X` anywhere in
  // the body — inside loops, switch, try/finally, labeled blocks — surfaces as
  // __ft_run's result. (An earlier version also rewrote `return X` into
  // `return (__ft_result = X)`, but only for the statement kinds it knew about;
  // the capture never depended on it.)
  const innerFn = t.arrowFunctionExpression([], t.blockStatement(originalBody.body), isAsync);

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
        t.identifier('__ft_err'), langLit,
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
      t.identifier('__ft_result'), langLit,
    ])
  );

  // return __ft_result;
  const returnResult = t.returnStatement(t.identifier('__ft_result'));

  return t.blockStatement([ctxDecl, resultDecl, tryCatch, exitCall, returnResult]);
}

/**
 * `lang` for the events of a file: TypeScript sources are transformed on the
 * same path as JavaScript, but the schema distinguishes them and the
 * `flowtrace://runtimes` resource lists `ts` as its own row.
 */
const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);
export function langForFile(filename) {
  return TS_EXTENSIONS.has(extname(filename).toLowerCase()) ? 'ts' : 'node';
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
  const lang = langForFile(filename);
  const isTs = lang === 'ts';
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
        path.node.body, mod, currentClass, name, vis, params, isAsync, null, lang
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
        path.node.body, mod, currentClass, name, 'private', params, isAsync, null, lang
      );
      path.skip();
    },

    // `{ foo() {} }` — an object-literal method. Not a ClassMethod and not a
    // FunctionExpression, so it used to be invisible to the trace entirely.
    ObjectMethod(path) {
      if (path.node.kind !== 'method') return; // getters/setters stay untouched
      if (path.node.generator) return;
      if (path.node._flowtraceWrapped) return;

      const name = t.isIdentifier(path.node.key) ? path.node.key.name
        : t.isStringLiteral(path.node.key) ? path.node.key.value
        : '<anonymous>';
      const params = collectParamNames(path.node);
      const isAsync = path.node.async;

      path.node._flowtraceWrapped = true;
      path.node.body = buildInstrumentedBody(
        path.node.body, mod, null, name, 'public', params, isAsync, null, lang
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
        path.node.body, mod, null, name, 'public', params, isAsync, null, lang
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
        path.node.body, mod, null, name, 'public', params, isAsync, null, lang
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
      const { argExprs, prologue } = bindArrowParams(path.node);
      if (prologue.length) {
        path.node.body = t.blockStatement([...prologue, ...path.node.body.body]);
      }

      path.node._flowtraceWrapped = true;
      path.node.body = buildInstrumentedBody(
        path.node.body, mod, null, name, 'public', params, isAsync, argExprs, lang
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
