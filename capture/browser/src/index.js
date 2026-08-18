/**
 * FlowTrace browser capture — framework-agnostic core.
 *
 * Angular bindings live in ./angular.js; everything here works with any
 * front-end, or none.
 */

export { newTraceId, newSpanId } from './ids.js';
export {
  getCurrent,
  startSpan,
  withSpan,
  seedFromRemote,
  resetContext,
  currentTraceId,
} from './context.js';
export { parseTraceparent, formatTraceparent } from './traceparent.js';
export {
  configure,
  emit,
  flush,
  installUnloadFlush,
  resetEmitter,
  queueDepth,
  droppedCount,
} from './emitter.js';
export {
  httpEnter,
  httpExit,
  routeEnter,
  routeExit,
  errorPair,
  toErrorObj,
  scrubUrl,
} from './events.js';
export { traceHttp, traceRoute, reportError, initFlowtrace } from './api.js';
