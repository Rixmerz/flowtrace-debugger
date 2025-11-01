/**
 * User Service with FlowTrace @Trace decorators
 * Demonstrates TypeScript decorator usage for automatic tracing
 */

import { Trace, TraceClass } from '../../../../flowtrace-agent-js/src/decorators';
import type { User, CreateUserDTO, UpdateUserDTO, PaginatedUsers, UserFilters } from '../types/User';

/**
 * Service for user management operations
 * All methods automatically traced with @TraceClass()
 */
@TraceClass()
export class UserService {
  private users: User[] = [];
  private nextId: number = 1;

  constructor() {
    // Initialize with sample data
    this.seedData();
  }

  /**
   * Seed initial user data
   * Private method - still traced by @TraceClass
   */
  private seedData(): void {
    const sampleUsers: Omit<User, 'id' | 'createdAt'>[] = [
      { name: 'Alice Johnson', email: 'alice@example.com', role: 'admin' },
      { name: 'Bob Smith', email: 'bob@example.com', role: 'user' },
      { name: 'Carol Williams', email: 'carol@example.com', role: 'user' },
      { name: 'David Brown', email: 'david@example.com', role: 'guest' },
    ];

    sampleUsers.forEach(userData => {
      this.users.push({
        ...userData,
        id: this.nextId++,
        createdAt: new Date(),
      });
    });
  }

  /**
   * Get all users with optional filters
   * Simulates API delay
   */
  async getAllUsers(filters?: UserFilters): Promise<User[]> {
    // Simulate API delay
    await this.delay(100);

    let filtered = [...this.users];

    if (filters?.role) {
      filtered = filtered.filter(u => u.role === filters.role);
    }

    if (filters?.searchTerm) {
      const term = filters.searchTerm.toLowerCase();
      filtered = filtered.filter(
        u =>
          u.name.toLowerCase().includes(term) ||
          u.email.toLowerCase().includes(term)
      );
    }

    return filtered;
  }

  /**
   * Get paginated users
   */
  async getPaginatedUsers(
    page: number = 1,
    pageSize: number = 10
  ): Promise<PaginatedUsers> {
    await this.delay(150);

    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const users = this.users.slice(start, end);

    return {
      users,
      total: this.users.length,
      page,
      pageSize,
    };
  }

  /**
   * Get user by ID
   */
  async getUserById(id: number): Promise<User | null> {
    await this.delay(50);

    const user = this.users.find(u => u.id === id);
    return user || null;
  }

  /**
   * Create new user
   * Demonstrates automatic async tracing
   */
  async createUser(data: CreateUserDTO): Promise<User> {
    await this.delay(200);

    // Validation
    this.validateEmail(data.email);
    this.checkDuplicateEmail(data.email);

    const newUser: User = {
      ...data,
      id: this.nextId++,
      createdAt: new Date(),
    };

    this.users.push(newUser);
    return newUser;
  }

  /**
   * Update existing user
   */
  async updateUser(id: number, data: UpdateUserDTO): Promise<User> {
    await this.delay(150);

    const user = this.users.find(u => u.id === id);
    if (!user) {
      throw new Error(`User not found: ${id}`);
    }

    if (data.email && data.email !== user.email) {
      this.validateEmail(data.email);
      this.checkDuplicateEmail(data.email, id);
    }

    Object.assign(user, data);
    return user;
  }

  /**
   * Delete user
   */
  async deleteUser(id: number): Promise<void> {
    await this.delay(100);

    const index = this.users.findIndex(u => u.id === id);
    if (index === -1) {
      throw new Error(`User not found: ${id}`);
    }

    this.users.splice(index, 1);
  }

  /**
   * Update last login timestamp
   * Demonstrates @Trace with custom options
   */
  @Trace({ methodName: 'recordLogin', captureResult: false })
  async updateLastLogin(id: number): Promise<void> {
    await this.delay(50);

    const user = this.users.find(u => u.id === id);
    if (user) {
      user.lastLogin = new Date();
    }
  }

  /**
   * Get user statistics
   */
  async getUserStats(): Promise<{
    total: number;
    byRole: Record<string, number>;
    recentLogins: number;
  }> {
    await this.delay(100);

    const byRole = this.users.reduce((acc, user) => {
      acc[user.role] = (acc[user.role] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentLogins = this.users.filter(
      u => u.lastLogin && u.lastLogin > sevenDaysAgo
    ).length;

    return {
      total: this.users.length,
      byRole,
      recentLogins,
    };
  }

  // Private validation methods

  private validateEmail(email: string): void {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new Error(`Invalid email format: ${email}`);
    }
  }

  private checkDuplicateEmail(email: string, excludeId?: number): void {
    const duplicate = this.users.find(
      u => u.email === email && u.id !== excludeId
    );

    if (duplicate) {
      throw new Error(`Email already exists: ${email}`);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
export const userService = new UserService();
