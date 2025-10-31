/**
 * Test script to verify truncation system for both args and result
 */

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
      metadata: {
        prop1: 'value1',
        prop2: 'value2',
        prop3: 'value3',
        data: generateLargeString(100)
      }
    });
  }
  return items;
}

// Function with large arguments
function processLargeArgs(largeData, config) {
  console.log('Processing large arguments...');
  return {
    processed: true,
    itemCount: largeData.length
  };
}

// Function returning large result
function getLargeResult() {
  console.log('Generating large result...');
  return generateLargeObject(50); // 50 items
}

// Function with both large args AND large result
function transformLargeData(inputData) {
  console.log('Transforming large data...');
  const output = inputData.map(item => ({
    ...item,
    transformed: true,
    timestamp: Date.now(),
    extra: generateLargeString(50)
  }));
  return output;
}

// Test 1: Large arguments
console.log('\n=== Test 1: Large Arguments ===');
const largeInput = generateLargeObject(30);
processLargeArgs(largeInput, { verbose: true });

// Test 2: Large result
console.log('\n=== Test 2: Large Result ===');
const largeOutput = getLargeResult();
console.log(`Generated ${largeOutput.length} items`);

// Test 3: Both large args and large result
console.log('\n=== Test 3: Large Args AND Large Result ===');
const transformedData = transformLargeData(largeInput);
console.log(`Transformed ${transformedData.length} items`);

// Test 4: Exception with large message
console.log('\n=== Test 4: Large Exception ===');
try {
  throw new Error('This is a large error message: ' + generateLargeString(2000));
} catch (err) {
  console.error('Caught error:', err.message.substring(0, 50) + '...');
}

console.log('\n=== All Tests Completed ===');
console.log('Check flowtrace.jsonl and flowtrace-jsonsl/ directory for results');
