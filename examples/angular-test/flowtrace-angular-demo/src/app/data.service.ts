import { Injectable } from '@angular/core';

export interface User {
  id: number;
  name: string;
  email: string;
  address: string;
  phone: string;
  company: string;
  bio: string;
  metadata: {
    created: Date;
    updated: Date;
    tags: string[];
    preferences: Record<string, any>;
  };
}

@Injectable({
  providedIn: 'root'
})
export class DataService {

  constructor() {}

  /**
   * Generate large dataset - will trigger truncation
   */
  generateLargeDataset(count: number = 100): User[] {
    console.log(`Generating ${count} users...`);

    const users: User[] = [];
    for (let i = 0; i < count; i++) {
      users.push(this.generateUser(i));
    }

    return users;
  }

  /**
   * Generate single user with detailed information
   */
  private generateUser(id: number): User {
    return {
      id,
      name: `User ${id} - Full Name With Many Details`,
      email: `user${id}@example-company-with-long-domain-name.com`,
      address: `Street ${id}, Building ${id}, Floor ${id}, Apartment ${id}, City ${id}, State ${id}, Country ${id}, ZIP ${id * 1000}`,
      phone: `+1-555-${String(id).padStart(4, '0')}-${String(id * 2).padStart(4, '0')}`,
      company: `Company ${id} - Full Business Name With Extended Description`,
      bio: `This is a very detailed biography for user ${id}. `.repeat(10),
      metadata: {
        created: new Date(),
        updated: new Date(),
        tags: [`tag-${id}`, `category-${id}`, `type-${id}`, `group-${id}`, `segment-${id}`],
        preferences: {
          theme: 'dark',
          language: 'en',
          notifications: true,
          privacy: 'private',
          customSettings: {
            setting1: `value-${id}`,
            setting2: `value-${id * 2}`,
            setting3: `value-${id * 3}`,
            nestedData: {
              deep1: `deep-value-${id}`,
              deep2: `deep-value-${id * 2}`,
              deep3: `deep-value-${id * 3}`
            }
          }
        }
      }
    };
  }

  /**
   * Process large dataset - will have large args and result
   */
  processUsers(users: User[]): { processed: User[]; summary: any } {
    console.log(`Processing ${users.length} users...`);

    // Transform users (large operation)
    const processed = users.map(user => ({
      ...user,
      processed: true,
      processedAt: new Date(),
      hash: this.generateHash(user),
      extra: `Extra data for user ${user.id}`.repeat(5)
    }));

    // Generate summary
    const summary = {
      total: processed.length,
      timestamp: new Date(),
      statistics: {
        avgNameLength: processed.reduce((acc, u) => acc + u.name.length, 0) / processed.length,
        avgEmailLength: processed.reduce((acc, u) => acc + u.email.length, 0) / processed.length,
        totalTags: processed.reduce((acc, u) => acc + u.metadata.tags.length, 0),
      },
      samples: processed.slice(0, 5),
      metadata: {
        version: '1.0.0',
        processedBy: 'DataService',
        notes: 'This is a large summary object with lots of details'
      }
    };

    return { processed, summary };
  }

  /**
   * Simulate API call with large response
   */
  async fetchLargeData(): Promise<User[]> {
    console.log('Fetching large data from API...');

    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 100));

    return this.generateLargeDataset(50);
  }

  /**
   * Test exception with large data
   */
  testExceptionWithLargeData(): void {
    try {
      const largeData = this.generateLargeDataset(30);

      // Simulate error with large context
      throw new Error(`Processing failed for large dataset: ${JSON.stringify(largeData).substring(0, 500)}...`);
    } catch (error) {
      console.error('Exception caught:', error);
      throw error;
    }
  }

  private generateHash(user: User): string {
    return `hash-${user.id}-${Date.now()}`;
  }
}
