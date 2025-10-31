/**
 * Module B - Second level import
 * Imports moduleC and provides functionB
 */

const { functionC } = require('./moduleC');

function functionB() {
  console.log('[moduleB] Function B called');
  console.log('[moduleB] Calling functionC...');
  const result = functionC();
  console.log('[moduleB] Function B returning:', result);
  return result;
}

module.exports = { functionB };
