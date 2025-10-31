/**
 * Module A - First level import
 * Imports moduleB and provides functionA
 */

const { functionB } = require('./moduleB');

function functionA() {
  console.log('[moduleA] Function A called');
  console.log('[moduleA] Calling functionB...');
  const result = functionB();
  console.log('[moduleA] Function A returning:', result);
  return result;
}

module.exports = { functionA };
