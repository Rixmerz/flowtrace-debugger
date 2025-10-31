/**
 * Example CommonJS Application for FlowTrace Testing
 * Simple user service with synchronous and asynchronous operations
 */

// Simulated database
const users = [
  { id: 1, name: 'Alice', email: 'alice@example.com' },
  { id: 2, name: 'Bob', email: 'bob@example.com' },
  { id: 3, name: 'Charlie', email: 'charlie@example.com' }
];

/**
 * User Service - Business logic layer
 */
class UserService {
  constructor() {
    this.cache = new Map();
  }

  /**
   * Find user by ID (synchronous)
   */
  findById(id) {
    console.log(`Looking up user with ID: ${id}`);

    // Check cache first
    if (this.cache.has(id)) {
      console.log('Cache hit!');
      return this.cache.get(id);
    }

    // Simulate database lookup
    const user = users.find(u => u.id === id);

    if (!user) {
      throw new Error(`User not found: ${id}`);
    }

    // Cache the result
    this.cache.set(id, user);

    return user;
  }

  /**
   * Find all users (synchronous)
   */
  findAll() {
    console.log('Fetching all users');
    return users;
  }

  /**
   * Find user by ID (asynchronous - simulates database query)
   */
  async findByIdAsync(id) {
    console.log(`Async lookup for user ID: ${id}`);

    // Simulate network delay
    await this.sleep(100);

    return this.findById(id);
  }

  /**
   * Validate user data
   */
  validateUser(user) {
    if (!user.name || user.name.trim() === '') {
      throw new Error('User name is required');
    }

    if (!user.email || !user.email.includes('@')) {
      throw new Error('Valid email is required');
    }

    return true;
  }

  /**
   * Create new user (asynchronous)
   */
  async createUser(userData) {
    console.log('Creating new user:', userData);

    // Validate first
    this.validateUser(userData);

    // Simulate async database insert
    await this.sleep(150);

    const newUser = {
      id: users.length + 1,
      ...userData
    };

    users.push(newUser);

    return newUser;
  }

  /**
   * Utility: Sleep for specified milliseconds
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Main application logic
 */
async function main() {
  console.log('Starting FlowTrace Example Application (CommonJS)');
  console.log('='.repeat(60));

  const service = new UserService();

  try {
    // Test 1: Synchronous user lookup
    console.log('\n--- Test 1: Synchronous Lookup ---');
    const user1 = service.findById(1);
    console.log('Found user:', user1);

    // Test 2: Cache hit
    console.log('\n--- Test 2: Cache Hit ---');
    const user1Again = service.findById(1);
    console.log('Found user (cached):', user1Again);

    // Test 3: Find all users
    console.log('\n--- Test 3: Find All Users ---');
    const allUsers = service.findAll();
    console.log('Total users:', allUsers.length);

    // Test 4: Asynchronous lookup
    console.log('\n--- Test 4: Asynchronous Lookup ---');
    const user2 = await service.findByIdAsync(2);
    console.log('Found user (async):', user2);

    // Test 5: Create new user
    console.log('\n--- Test 5: Create New User ---');
    const newUser = await service.createUser({
      name: 'David',
      email: 'david@example.com'
    });
    console.log('Created user:', newUser);

    // Test 6: Error handling - invalid user
    console.log('\n--- Test 6: Error Handling (Validation) ---');
    try {
      await service.createUser({
        name: '',
        email: 'invalid'
      });
    } catch (error) {
      console.log('Caught validation error:', error.message);
    }

    // Test 7: Error handling - user not found
    console.log('\n--- Test 7: Error Handling (Not Found) ---');
    try {
      service.findById(999);
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

// Run if executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

// Export for testing
module.exports = { UserService, main };
