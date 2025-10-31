/**
 * Test Module Chain - Entry Point
 * Purpose: Verify that FlowTrace instruments ALL modules in the require() chain
 *
 * Chain: main.js → moduleA.js → moduleB.js → moduleC.js
 *
 * Expected: flowtrace.jsonl should contain ENTER/EXIT events for functionA, functionB, functionC
 */

console.log('=== Testing Module Chain Instrumentation ===');
console.log('This test verifies that FlowTrace instruments ALL levels of imported modules');
console.log('');

const { functionA } = require('./moduleA');

console.log('Starting function call chain...');
const result = functionA();
console.log('Result:', result);
console.log('');
console.log('Check flowtrace.jsonl for ENTER/EXIT events for functionA, functionB, functionC');
