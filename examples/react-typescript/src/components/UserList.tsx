/**
 * UserList React Component with TypeScript
 * Demonstrates React + TypeScript + FlowTrace integration
 */

import React from 'react';
import type { User } from '../types/User';

interface UserListProps {
  users: User[];
  loading: boolean;
  onDelete: (id: number) => void;
  onSelect: (user: User) => void;
}

export const UserList: React.FC<UserListProps> = ({ users, loading, onDelete, onSelect }) => {
  if (loading) {
    return <div style={styles.loading}>Loading users...</div>;
  }

  if (users.length === 0) {
    return <div style={styles.empty}>No users found</div>;
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Users ({users.length})</h2>
      <div style={styles.grid}>
        {users.map(user => (
          <div key={user.id} style={styles.card}>
            <div style={styles.cardHeader}>
              <h3 style={styles.userName}>{user.name}</h3>
              <span style={{ ...styles.badge, ...getBadgeStyle(user.role) }}>{user.role}</span>
            </div>
            <p style={styles.email}>{user.email}</p>
            <p style={styles.date}>Created: {new Date(user.createdAt).toLocaleDateString()}</p>
            {user.lastLogin && (
              <p style={styles.date}>Last login: {new Date(user.lastLogin).toLocaleString()}</p>
            )}
            <div style={styles.actions}>
              <button onClick={() => onSelect(user)} style={styles.btnEdit}>
                Edit
              </button>
              <button onClick={() => onDelete(user.id)} style={styles.btnDelete}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

function getBadgeStyle(role: string) {
  switch (role) {
    case 'admin':
      return { backgroundColor: '#dc3545' };
    case 'user':
      return { backgroundColor: '#28a745' };
    case 'guest':
      return { backgroundColor: '#6c757d' };
    default:
      return { backgroundColor: '#007bff' };
  }
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '20px',
  },
  title: {
    fontSize: '24px',
    marginBottom: '20px',
    color: '#333',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: '20px',
  },
  card: {
    border: '1px solid #ddd',
    borderRadius: '8px',
    padding: '16px',
    backgroundColor: '#fff',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  },
  userName: {
    margin: 0,
    fontSize: '18px',
    color: '#333',
  },
  badge: {
    padding: '4px 8px',
    borderRadius: '4px',
    color: '#fff',
    fontSize: '12px',
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  email: {
    margin: '8px 0',
    color: '#666',
    fontSize: '14px',
  },
  date: {
    margin: '4px 0',
    color: '#999',
    fontSize: '12px',
  },
  actions: {
    display: 'flex',
    gap: '8px',
    marginTop: '12px',
  },
  btnEdit: {
    flex: 1,
    padding: '8px',
    backgroundColor: '#007bff',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
  },
  btnDelete: {
    flex: 1,
    padding: '8px',
    backgroundColor: '#dc3545',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
  },
  loading: {
    padding: '40px',
    textAlign: 'center',
    fontSize: '18px',
    color: '#666',
  },
  empty: {
    padding: '40px',
    textAlign: 'center',
    fontSize: '16px',
    color: '#999',
  },
};
