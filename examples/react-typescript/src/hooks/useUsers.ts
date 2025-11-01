/**
 * Custom React Hook for user management
 * Demonstrates TypeScript hooks with FlowTrace tracing
 */

import { useState, useEffect, useCallback } from 'react';
import { userService } from '../services/UserService';
import type { User, CreateUserDTO, UpdateUserDTO, UserFilters } from '../types/User';

export function useUsers(initialFilters?: UserFilters) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<UserFilters | undefined>(initialFilters);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await userService.getAllUsers(filters);
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch users');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const createUser = useCallback(async (data: CreateUserDTO) => {
    setLoading(true);
    setError(null);

    try {
      const newUser = await userService.createUser(data);
      setUsers(prev => [...prev, newUser]);
      return newUser;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create user';
      setError(message);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const updateUser = useCallback(async (id: number, data: UpdateUserDTO) => {
    setLoading(true);
    setError(null);

    try {
      const updated = await userService.updateUser(id, data);
      setUsers(prev => prev.map(u => (u.id === id ? updated : u)));
      return updated;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update user';
      setError(message);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteUser = useCallback(async (id: number) => {
    setLoading(true);
    setError(null);

    try {
      await userService.deleteUser(id);
      setUsers(prev => prev.filter(u => u.id !== id));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete user';
      setError(message);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  return {
    users,
    loading,
    error,
    filters,
    setFilters,
    refresh: fetchUsers,
    createUser,
    updateUser,
    deleteUser,
  };
}
