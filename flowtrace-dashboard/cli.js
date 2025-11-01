#!/usr/bin/env node

/**
 * FlowTrace Dashboard CLI
 * Command-line interface for opening files in dashboard
 */

const tools = require('./mcp-tools');
const path = require('path');

const command = process.argv[2];
const filePath = process.argv[3];

if (!command) {
  console.log(`
FlowTrace Dashboard CLI

Usage:
  node cli.js open <file>        Open file in dashboard
  node cli.js analyze <file>     Analyze file and show summary
  node cli.js slow <file> [n]    Show top N slow methods
  node cli.js bottlenecks <file> [n]  Show top N bottlenecks
  node cli.js errors <file>      Show error hotspots
  node cli.js start              Start dashboard server

Examples:
  node cli.js open flowtrace.jsonl
  node cli.js analyze flowtrace.jsonl
  node cli.js slow flowtrace.jsonl 20
  node cli.js bottlenecks flowtrace.jsonl 15
  `);
  process.exit(0);
}

async function main() {
  try {
    switch (command) {
      case 'start':
        const serverStatus = await tools.startDashboard();
        console.log(`✅ ${serverStatus.message}`);
        console.log(`📊 Dashboard URL: ${serverStatus.url}`);
        break;

      case 'open':
        if (!filePath) {
          console.error('❌ Error: File path required');
          process.exit(1);
        }

        const absolutePath = path.resolve(filePath);
        console.log(`🔍 Analyzing ${absolutePath}...`);

        const result = await tools.openInDashboard(absolutePath);

        if (result.success) {
          console.log('\n' + result.message);
          console.log('\n📊 Summary:');
          console.log(`   Total Calls: ${result.summary.totalCalls.toLocaleString()}`);
          console.log(`   Avg Duration: ${result.summary.avgDuration.toFixed(2)}ms`);
          console.log(`   Total Methods: ${result.summary.totalMethods}`);
          console.log(`   Exceptions: ${result.summary.totalExceptions}`);

          console.log('\n🐌 Top 5 Slow Methods:');
          result.slowMethods.forEach((method, i) => {
            console.log(`   ${i + 1}. ${method.method} - ${method.avgDuration.toFixed(2)}ms avg`);
          });

          console.log('\n🔴 Top 5 Bottlenecks:');
          result.bottlenecks.forEach((bottleneck, i) => {
            console.log(`   ${i + 1}. ${bottleneck.method} - Impact: ${bottleneck.impactScore.toFixed(0)}`);
          });

        } else {
          console.error(`❌ ${result.message}`);
          process.exit(1);
        }
        break;

      case 'analyze':
        if (!filePath) {
          console.error('❌ Error: File path required');
          process.exit(1);
        }

        const analysis = await tools.analyzeFile(path.resolve(filePath));

        if (analysis.success) {
          console.log('\n📊 Performance Summary:');
          const summary = analysis.performance.summary;
          console.log(`   Total Calls: ${summary.totalCalls.toLocaleString()}`);
          console.log(`   Average Duration: ${summary.avgDuration.toFixed(2)}ms`);
          console.log(`   Total Methods: ${summary.totalMethods}`);
          console.log(`   Total Exceptions: ${summary.totalExceptions}`);
          console.log(`   Total Time: ${summary.totalTime.toFixed(2)}ms`);
        } else {
          console.error(`❌ Error: ${analysis.error}`);
          process.exit(1);
        }
        break;

      case 'slow':
        if (!filePath) {
          console.error('❌ Error: File path required');
          process.exit(1);
        }

        const top = parseInt(process.argv[4]) || 10;
        const slowMethods = await tools.getSlowMethods(path.resolve(filePath), top);

        console.log(`\n🐌 Top ${top} Slow Methods:\n`);
        slowMethods.forEach((method, i) => {
          console.log(`${i + 1}. ${method.method}`);
          console.log(`   Calls: ${method.callCount.toLocaleString()}`);
          console.log(`   Avg: ${method.avgDuration.toFixed(2)}ms`);
          console.log(`   P95: ${method.p95.toFixed(2)}ms`);
          console.log(`   P99: ${method.p99.toFixed(2)}ms`);
          console.log(`   Total: ${method.totalTime.toFixed(2)}ms\n`);
        });
        break;

      case 'bottlenecks':
        if (!filePath) {
          console.error('❌ Error: File path required');
          process.exit(1);
        }

        const topBottlenecks = parseInt(process.argv[4]) || 10;
        const bottlenecks = await tools.getBottlenecks(path.resolve(filePath), topBottlenecks);

        console.log(`\n🔴 Top ${topBottlenecks} Bottlenecks:\n`);
        bottlenecks.forEach((bottleneck, i) => {
          console.log(`${i + 1}. ${bottleneck.method}`);
          console.log(`   Call Count: ${bottleneck.callCount.toLocaleString()}`);
          console.log(`   Avg Duration: ${bottleneck.avgDuration.toFixed(2)}ms`);
          console.log(`   Total Time: ${bottleneck.totalTime.toFixed(2)}ms`);
          console.log(`   Impact Score: ${bottleneck.impactScore.toFixed(0)}\n`);
        });
        break;

      case 'errors':
        if (!filePath) {
          console.error('❌ Error: File path required');
          process.exit(1);
        }

        const errors = await tools.getErrorHotspots(path.resolve(filePath));

        if (errors.length === 0) {
          console.log('\n✅ No errors found!');
        } else {
          console.log(`\n❌ Error Hotspots (${errors.length} methods):\n`);
          errors.forEach((error, i) => {
            const errorRate = (error.exceptionCount / error.callCount) * 100;
            console.log(`${i + 1}. ${error.method}`);
            console.log(`   Total Calls: ${error.callCount.toLocaleString()}`);
            console.log(`   Exceptions: ${error.exceptionCount}`);
            console.log(`   Error Rate: ${errorRate.toFixed(2)}%\n`);
          });
        }
        break;

      default:
        console.error(`❌ Unknown command: ${command}`);
        process.exit(1);
    }

  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

main();
