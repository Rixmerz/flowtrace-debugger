/**
 * Simple test for truncation - tests the logger directly
 */

const logger = require('../flowtrace-agent-js/src/logger');
const config = require('../flowtrace-agent-js/src/config');

console.log('FlowTrace Truncation Test');
console.log('=========================');
console.log(`Truncate Threshold: ${config.truncateThreshold}`);
console.log(`Enable Segmentation: ${config.enableSegmentation}`);
console.log(`Segment Directory: ${config.segmentDirectory}`);
console.log('');

// Generate large data
function generateLargeString(size) {
  return 'X'.repeat(size);
}

function generateLargeObject(itemCount) {
  const items = [];
  for (let i = 0; i < itemCount; i++) {
    items.push({
      id: i,
      name: `Item ${i}`,
      description: `This is a detailed description with lots of text for item ${i}`,
      data: generateLargeString(50)
    });
  }
  return items;
}

// Test 1: Small args, small result (no truncation)
console.log('Test 1: Small args and result (no truncation)');
logger.logEnter('TestClass', 'smallMethod', ['arg1', 'arg2']);
logger.logExit('TestClass', 'smallMethod', ['arg1', 'arg2'], 'small');
console.log('✓ Completed\n');

// Test 2: Large args (should truncate)
console.log('Test 2: Large args (should truncate)');
const largeArgs = generateLargeObject(20); // Large arguments
logger.logEnter('TestClass', 'processLargeArgs', [largeArgs]);
logger.logExit('TestClass', 'processLargeArgs', [largeArgs], {processed: true});
console.log('✓ Completed\n');

// Test 3: Large result (should truncate)
console.log('Test 3: Large result (should truncate)');
const largeResult = generateLargeObject(30); // Large result
logger.logEnter('TestClass', 'getLargeResult', []);
logger.logExit('TestClass', 'getLargeResult', [], largeResult);
console.log('✓ Completed\n');

// Test 4: Both large args AND large result (both should truncate)
console.log('Test 4: Both large args AND result (both should truncate)');
const largeInput = generateLargeObject(25);
const largeOutput = generateLargeObject(25);
logger.logEnter('TestClass', 'transformLargeData', [largeInput]);
logger.logExit('TestClass', 'transformLargeData', [largeInput], largeOutput);
console.log('✓ Completed\n');

// Close logger
logger.close();

console.log('=========================');
console.log('All Tests Completed!');
console.log('Check flowtrace.jsonl and flowtrace-jsonsl/ directory');
console.log('');
