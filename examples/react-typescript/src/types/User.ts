/**
 * User domain types for FlowTrace React TypeScript example
 */

export interface User {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  createdAt: Date;
  lastLogin?: Date;
}

export type UserRole = 'admin' | 'user' | 'guest';

export interface CreateUserDTO {
  name: string;
  email: string;
  role: UserRole;
}

export interface UpdateUserDTO {
  name?: string;
  email?: string;
  role?: UserRole;
}

export interface UserFilters {
  role?: UserRole;
  searchTerm?: string;
}

export interface PaginatedUsers {
  users: User[];
  total: number;
  page: number;
  pageSize: number;
}
