/**
 * Simple Node.js test to demonstrate FlowTrace
 * Using direct function calls instead of decorators
 */

/**
 * Test service - FlowTrace will automatically instrument functions
 * that match the package prefix
 */
class TestService {
  constructor() {
    this.counter = 0;
    console.log('TestService initialized');
  }

  increment() {
    this.counter++;
    console.log(`Counter incremented to: ${this.counter}`);
    return this.counter;
  }

  processData(data) {
    console.log(`Processing ${data.length} items`);
    const result = data.map(item => item.toUpperCase());
    console.log(`Processed result: ${result.join(', ')}`);
    return { processed: result.length, items: result };
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async asyncOperation(value) {
    console.log(`Starting async operation with value: ${value}`);
    await this.delay(100);
    const result = value * 2;
    console.log(`Async operation completed: ${value} * 2 = ${result}`);
    return result;
  }

  calculateSum(a, b) {
    console.log(`Calculating sum of ${a} + ${b}`);
    const result = a + b;
    console.log(`Sum result: ${result}`);
    return result;
  }
}

/**
 * Main execution function
 */
async function main() {
  console.log('\n=== FlowTrace Node.js Test ===\n');

  const service = new TestService();

  // Test 1: Simple method calls
  console.log('Test 1: Increment counter');
  service.increment();
  service.increment();
  service.increment();
  console.log('');

  // Test 2: Data processing
  console.log('Test 2: Process data');
  const data = ['hello', 'world', 'flowtrace', 'test'];
  const result = service.processData(data);
  console.log('Result:', JSON.stringify(result));
  console.log('');

  // Test 3: Calculate sum
  console.log('Test 3: Calculate sums');
  service.calculateSum(5, 3);
  service.calculateSum(10, 20);
  service.calculateSum(100, 50);
  console.log('');

  // Test 4: Async operations
  console.log('Test 4: Async operations');
  await service.asyncOperation(5);
  await service.asyncOperation(10);
  await service.asyncOperation(15);
  console.log('');

  console.log('=== Test completed ===');
  console.log('✅ Check flowtrace.jsonl for execution logs\n');
}

// Run main function
main().catch(console.error);
