/**
 * Simple Node.js test to demonstrate FlowTrace with decorators
 * This runs in Node.js so FlowTrace can instrument it
 */

const { Trace, TraceClass } = require('../../flowtrace-agent-js/src/decorators');

/**
 * Test service with automatic tracing using decorators
 */
@TraceClass()
class TestService {
  constructor() {
    this.counter = 0;
  }

  increment() {
    this.counter++;
    console.log(`Counter incremented to: ${this.counter}`);
    return this.counter;
  }

  @Trace({ methodName: 'process-data' })
  processData(data) {
    const result = data.map(item => item.toUpperCase());
    console.log(`Processed ${result.length} items`);
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
}

/**
 * Main execution function
 */
async function main() {
  console.log('=== FlowTrace Decorator Test ===\n');

  const service = new TestService();

  // Test 1: Simple method calls
  console.log('Test 1: Increment counter');
  service.increment();
  service.increment();
  service.increment();

  console.log('\n');

  // Test 2: Method with data processing
  console.log('Test 2: Process data');
  const data = ['hello', 'world', 'flowtrace', 'test'];
  const result = service.processData(data);
  console.log('Result:', result);

  console.log('\n');

  // Test 3: Async operations
  console.log('Test 3: Async operations');
  await service.asyncOperation(5);
  await service.asyncOperation(10);
  await service.asyncOperation(15);

  console.log('\n=== Test completed ===');
  console.log('✅ Check flowtrace.jsonl for execution logs');
}

// Run main function
main().catch(console.error);
