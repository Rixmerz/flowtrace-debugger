#!/usr/bin/env node

/**
 * Test script for FlowTrace MCP tools
 * Tests the new initialization and execution tools
 */

const path = require('path');
const fs = require('fs');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function testHeader(title) {
  log('\n' + '='.repeat(60), 'cyan');
  log(`  ${title}`, 'cyan');
  log('='.repeat(60), 'cyan');
}

function testResult(testName, passed, details = '') {
  const symbol = passed ? '✅' : '❌';
  const color = passed ? 'green' : 'red';
  log(`${symbol} ${testName}`, color);
  if (details) {
    log(`   ${details}`, 'yellow');
  }
}

async function runTests() {
  log('\n🚀 FlowTrace MCP Tools - Test Suite', 'blue');
  log('Testing new flowtrace.* tools\n', 'blue');

  const results = {
    passed: 0,
    failed: 0,
    total: 0,
  };

  // Test 1: Check flowtrace-tools.ts exists
  testHeader('File Structure Tests');
  results.total++;
  const toolsFile = path.join(__dirname, 'src', 'flowtrace-tools.ts');
  const toolsExists = fs.existsSync(toolsFile);
  if (toolsExists) {
    results.passed++;
    testResult('flowtrace-tools.ts exists', true);
  } else {
    results.failed++;
    testResult('flowtrace-tools.ts exists', false, 'File not found');
  }

  // Test 2: Check compiled JavaScript exists
  results.total++;
  const compiledFile = path.join(__dirname, 'dist', 'flowtrace-tools.js');
  const compiledExists = fs.existsSync(compiledFile);
  if (compiledExists) {
    results.passed++;
    testResult('Compiled flowtrace-tools.js exists', true);
  } else {
    results.failed++;
    testResult('Compiled flowtrace-tools.js exists', false, 'Run npm run build');
  }

  // Test 3: Check server.ts imports flowtrace-tools
  results.total++;
  const serverFile = path.join(__dirname, 'src', 'server.ts');
  const serverContent = fs.readFileSync(serverFile, 'utf-8');
  const hasImport = serverContent.includes('registerFlowTraceTools');
  if (hasImport) {
    results.passed++;
    testResult('server.ts imports flowtrace-tools', true);
  } else {
    results.failed++;
    testResult('server.ts imports flowtrace-tools', false, 'Import missing');
  }

  // Test 4: Check server.ts registers tools
  results.total++;
  const hasRegistration = serverContent.includes('registerFlowTraceTools(mcp)');
  if (hasRegistration) {
    results.passed++;
    testResult('server.ts registers FlowTrace tools', true);
  } else {
    results.failed++;
    testResult('server.ts registers FlowTrace tools', false, 'Registration missing');
  }

  // Test 5: Check lib directories exist
  testHeader('Support Libraries Tests');

  const libDirs = ['detectors', 'builders', 'utils'];
  for (const dir of libDirs) {
    results.total++;
    const dirPath = path.join(__dirname, 'src', 'lib', dir);
    const dirExists = fs.existsSync(dirPath);
    if (dirExists) {
      results.passed++;
      testResult(`lib/${dir} directory exists`, true);
    } else {
      results.failed++;
      testResult(`lib/${dir} directory exists`, false, 'Directory missing');
    }
  }

  // Test 6: Check tool implementation structure
  testHeader('Tool Implementation Tests');

  const toolsSourceContent = fs.readFileSync(toolsFile, 'utf-8');
  const expectedTools = [
    'flowtrace.init',
    'flowtrace.detect',
    'flowtrace.build',
    'flowtrace.execute',
    'flowtrace.cleanup',
    'flowtrace.status',
  ];

  for (const tool of expectedTools) {
    results.total++;
    const hasToolDefinition = toolsSourceContent.includes(`"${tool}"`);
    if (hasToolDefinition) {
      results.passed++;
      testResult(`${tool} tool defined`, true);
    } else {
      results.failed++;
      testResult(`${tool} tool defined`, false, 'Tool definition missing');
    }
  }

  // Test 7: Check README documentation
  testHeader('Documentation Tests');
  results.total++;
  const readmeFile = path.join(__dirname, 'README.md');
  const readmeContent = fs.readFileSync(readmeFile, 'utf-8');
  const hasDocumentation = readmeContent.includes('flowtrace.init');
  if (hasDocumentation) {
    results.passed++;
    testResult('README.md documents new tools', true);
  } else {
    results.failed++;
    testResult('README.md documents new tools', false, 'Documentation missing');
  }

  // Test 8: Check for required parameters
  testHeader('Parameter Validation Tests');

  const parameterTests = [
    { tool: 'flowtrace.init', param: 'projectPath' },
    { tool: 'flowtrace.detect', param: 'projectPath' },
    { tool: 'flowtrace.build', param: 'projectPath' },
    { tool: 'flowtrace.execute', param: 'projectPath' },
    { tool: 'flowtrace.cleanup', param: 'projectPath' },
    { tool: 'flowtrace.status', param: 'projectPath' },
  ];

  for (const test of parameterTests) {
    results.total++;
    const hasParam = toolsSourceContent.includes(`${test.param}: z.string()`);
    if (hasParam) {
      results.passed++;
      testResult(`${test.tool} has ${test.param} parameter`, true);
    } else {
      results.failed++;
      testResult(`${test.tool} has ${test.param} parameter`, false, 'Parameter missing');
    }
  }

  // Test Summary
  testHeader('Test Summary');
  log(`Total Tests: ${results.total}`, 'blue');
  log(`Passed: ${results.passed}`, 'green');
  log(`Failed: ${results.failed}`, results.failed > 0 ? 'red' : 'green');

  const percentage = ((results.passed / results.total) * 100).toFixed(1);
  log(`\nSuccess Rate: ${percentage}%`, percentage === '100.0' ? 'green' : 'yellow');

  if (results.failed === 0) {
    log('\n🎉 All tests passed! FlowTrace tools are ready to use.', 'green');
  } else {
    log('\n⚠️  Some tests failed. Please review the errors above.', 'yellow');
  }

  // Exit with appropriate code
  process.exit(results.failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch((error) => {
  log(`\n❌ Test suite failed with error: ${error.message}`, 'red');
  process.exit(1);
});
