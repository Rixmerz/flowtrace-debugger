import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService, User } from './data.service';

@Component({
  selector: 'app-root',
  imports: [CommonModule],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class AppComponent implements OnInit {
  title = 'FlowTrace Angular Demo';
  users: User[] = [];
  processedData: any = null;
  loading = false;
  error: string | null = null;

  constructor(private dataService: DataService) {}

  ngOnInit() {
    console.log('=== FlowTrace Angular Demo ===');
    console.log('This app demonstrates truncation with large data operations');
    console.log('');
  }

  testGenerateLargeData() {
    console.log('\n=== Test 1: Generate Large Dataset ===');
    this.loading = true;
    this.error = null;

    try {
      this.users = this.dataService.generateLargeDataset(100);
      console.log(`Generated ${this.users.length} users`);
      console.log('Check flowtrace.jsonl for truncated logs');
    } catch (error: any) {
      this.error = error.message;
      console.error('Error:', error);
    } finally {
      this.loading = false;
    }
  }

  testProcessLargeData() {
    console.log('\n=== Test 2: Process Large Data (args + result) ===');
    this.loading = true;
    this.error = null;

    try {
      if (this.users.length === 0) {
        this.users = this.dataService.generateLargeDataset(50);
      }

      this.processedData = this.dataService.processUsers(this.users);
      console.log(`Processed ${this.processedData.processed.length} users`);
      console.log('Check flowtrace.jsonl for truncated args and result');
    } catch (error: any) {
      this.error = error.message;
      console.error('Error:', error);
    } finally {
      this.loading = false;
    }
  }

  async testAsyncOperation() {
    console.log('\n=== Test 3: Async Large Data Fetch ===');
    this.loading = true;
    this.error = null;

    try {
      this.users = await this.dataService.fetchLargeData();
      console.log(`Fetched ${this.users.length} users asynchronously`);
      console.log('Check flowtrace.jsonl for async operation logs');
    } catch (error: any) {
      this.error = error.message;
      console.error('Error:', error);
    } finally {
      this.loading = false;
    }
  }

  testException() {
    console.log('\n=== Test 4: Exception with Large Data ===');
    this.loading = true;
    this.error = null;

    try {
      this.dataService.testExceptionWithLargeData();
    } catch (error: any) {
      this.error = error.message;
      console.error('Expected error caught:', error.message.substring(0, 100) + '...');
      console.log('Check flowtrace.jsonl for exception with truncated data');
    } finally {
      this.loading = false;
    }
  }

  runAllTests() {
    console.log('\n=== Running All Tests ===');
    this.testGenerateLargeData();
    setTimeout(() => this.testProcessLargeData(), 500);
    setTimeout(() => this.testAsyncOperation(), 1000);
    setTimeout(() => this.testException(), 1500);
  }
}
