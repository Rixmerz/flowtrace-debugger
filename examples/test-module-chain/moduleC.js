/**
 * Module C - Third level import (leaf node)
 * Provides functionC with no further imports
 */

function functionC() {
  console.log('[moduleC] Function C called - end of chain');
  return 'success from moduleC';
}

module.exports = { functionC };
