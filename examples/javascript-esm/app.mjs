/**
 * Example ES Module Application for FlowTrace Testing
 * Simple task manager with asynchronous operations
 */

// Simulated database
const tasks = [
  { id: 1, title: 'Complete project', status: 'pending', priority: 'high' },
  { id: 2, title: 'Review code', status: 'in-progress', priority: 'medium' },
  { id: 3, title: 'Write tests', status: 'pending', priority: 'high' }
];

/**
 * Task Manager Service
 */
export class TaskManager {
  constructor() {
    this.lastId = tasks.length;
  }

  /**
   * Get all tasks
   */
  getAllTasks() {
    console.log('Fetching all tasks');
    return [...tasks];
  }

  /**
   * Get task by ID
   */
  getTaskById(id) {
    console.log(`Looking up task with ID: ${id}`);

    const task = tasks.find(t => t.id === id);

    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }

    return task;
  }

  /**
   * Filter tasks by status
   */
  getTasksByStatus(status) {
    console.log(`Filtering tasks by status: ${status}`);
    return tasks.filter(t => t.status === status);
  }

  /**
   * Create new task (async)
   */
  async createTask(taskData) {
    console.log('Creating new task:', taskData);

    // Validate
    this.validateTask(taskData);

    // Simulate async database insert
    await this.delay(100);

    const newTask = {
      id: ++this.lastId,
      status: 'pending',
      priority: 'medium',
      ...taskData
    };

    tasks.push(newTask);

    return newTask;
  }

  /**
   * Update task status (async)
   */
  async updateTaskStatus(id, newStatus) {
    console.log(`Updating task ${id} to status: ${newStatus}`);

    const task = this.getTaskById(id);

    // Simulate async operation
    await this.delay(50);

    task.status = newStatus;

    return task;
  }

  /**
   * Delete task (async)
   */
  async deleteTask(id) {
    console.log(`Deleting task: ${id}`);

    const index = tasks.findIndex(t => t.id === id);

    if (index === -1) {
      throw new Error(`Task not found: ${id}`);
    }

    // Simulate async operation
    await this.delay(50);

    const deletedTask = tasks.splice(index, 1)[0];

    return deletedTask;
  }

  /**
   * Validate task data
   */
  validateTask(task) {
    if (!task.title || task.title.trim() === '') {
      throw new Error('Task title is required');
    }

    const validStatuses = ['pending', 'in-progress', 'completed', 'cancelled'];
    if (task.status && !validStatuses.includes(task.status)) {
      throw new Error(`Invalid status: ${task.status}`);
    }

    const validPriorities = ['low', 'medium', 'high'];
    if (task.priority && !validPriorities.includes(task.priority)) {
      throw new Error(`Invalid priority: ${task.priority}`);
    }

    return true;
  }

  /**
   * Utility: Delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Main application logic
 */
async function main() {
  console.log('Starting FlowTrace Example Application (ES Module)');
  console.log('='.repeat(60));

  const manager = new TaskManager();

  try {
    // Test 1: Get all tasks
    console.log('\n--- Test 1: Get All Tasks ---');
    const allTasks = manager.getAllTasks();
    console.log('Total tasks:', allTasks.length);

    // Test 2: Get task by ID
    console.log('\n--- Test 2: Get Task by ID ---');
    const task1 = manager.getTaskById(1);
    console.log('Found task:', task1);

    // Test 3: Filter by status
    console.log('\n--- Test 3: Filter by Status ---');
    const pendingTasks = manager.getTasksByStatus('pending');
    console.log('Pending tasks:', pendingTasks.length);

    // Test 4: Create new task
    console.log('\n--- Test 4: Create New Task ---');
    const newTask = await manager.createTask({
      title: 'Deploy application',
      priority: 'high'
    });
    console.log('Created task:', newTask);

    // Test 5: Update task status
    console.log('\n--- Test 5: Update Task Status ---');
    const updatedTask = await manager.updateTaskStatus(1, 'completed');
    console.log('Updated task:', updatedTask);

    // Test 6: Delete task
    console.log('\n--- Test 6: Delete Task ---');
    const deletedTask = await manager.deleteTask(2);
    console.log('Deleted task:', deletedTask);

    // Test 7: Error handling - validation
    console.log('\n--- Test 7: Error Handling (Validation) ---');
    try {
      await manager.createTask({
        title: '',
        status: 'invalid-status'
      });
    } catch (error) {
      console.log('Caught validation error:', error.message);
    }

    // Test 8: Error handling - not found
    console.log('\n--- Test 8: Error Handling (Not Found) ---');
    try {
      manager.getTaskById(999);
    } catch (error) {
      console.log('Caught not found error:', error.message);
    }

    console.log('\n' + '='.repeat(60));
    console.log('All tests completed successfully!');

  } catch (error) {
    console.error('Unexpected error:', error);
    process.exit(1);
  }
}

// Run main
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
