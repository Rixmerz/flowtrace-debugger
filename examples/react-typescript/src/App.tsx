/**
 * Main App Component - React + TypeScript + FlowTrace Example
 */

import React, { useState } from 'react';
import { UserList } from './components/UserList';
import { useUsers } from './hooks/useUsers';
import type { User } from './types/User';

function App() {
  console.log('🚀 App component rendering');

  const { users, loading, error, refresh, createUser, updateUser, deleteUser } = useUsers();
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  console.log('📊 App state:', { usersCount: users.length, loading, error, selectedUser });

  const handleCreateUser = async () => {
    console.log('➕ Creating new user...');
    try {
      const newUser = {
        name: `User ${users.length + 1}`,
        email: `user${users.length + 1}@example.com`,
        role: 'user',
      };
      console.log('📝 New user data:', newUser);
      await createUser(newUser);
      console.log('✅ User created successfully');
      alert('User created successfully!');
    } catch (err) {
      console.error('❌ Failed to create user:', err);
      alert('Failed to create user');
    }
  };

  const handleDelete = async (id: number) => {
    console.log('🗑️ Delete user requested:', id);
    if (window.confirm('Are you sure you want to delete this user?')) {
      try {
        await deleteUser(id);
        console.log('✅ User deleted successfully:', id);
        alert('User deleted successfully!');
      } catch (err) {
        console.error('❌ Failed to delete user:', err);
        alert('Failed to delete user');
      }
    } else {
      console.log('❌ User deletion cancelled');
    }
  };

  const handleSelect = (user: User) => {
    console.log('👤 User selected for editing:', user);
    setSelectedUser(user);
  };

  const handleUpdate = async () => {
    if (!selectedUser) return;

    console.log('💾 Updating user:', selectedUser);
    try {
      await updateUser(selectedUser.id, {
        name: selectedUser.name,
        email: selectedUser.email,
      });
      setSelectedUser(null);
      console.log('✅ User updated successfully');
      alert('User updated successfully!');
    } catch (err) {
      console.error('❌ Failed to update user:', err);
      alert('Failed to update user');
    }
  };

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <h1 style={styles.title}>FlowTrace React + TypeScript Example</h1>
        <p style={styles.subtitle}>Demonstrating TypeScript decorators, React hooks, and automatic tracing</p>
      </header>

      <div style={styles.toolbar}>
        <button onClick={handleCreateUser} style={styles.btnPrimary} disabled={loading}>
          Create New User
        </button>
        <button onClick={refresh} style={styles.btnSecondary} disabled={loading}>
          Refresh
        </button>
      </div>

      {error && <div style={styles.error}>Error: {error}</div>}

      <UserList
        users={users}
        loading={loading}
        onDelete={handleDelete}
        onSelect={handleSelect}
      />

      {selectedUser && (
        <div style={styles.modal}>
          <div style={styles.modalContent}>
            <h2>Edit User</h2>
            <div style={styles.form}>
              <label style={styles.label}>
                Name:
                <input
                  type="text"
                  value={selectedUser.name}
                  onChange={(e) =>
                    setSelectedUser({ ...selectedUser, name: e.target.value })
                  }
                  style={styles.input}
                />
              </label>
              <label style={styles.label}>
                Email:
                <input
                  type="email"
                  value={selectedUser.email}
                  onChange={(e) =>
                    setSelectedUser({ ...selectedUser, email: e.target.value })
                  }
                  style={styles.input}
                />
              </label>
              <div style={styles.modalActions}>
                <button onClick={handleUpdate} style={styles.btnPrimary}>
                  Save
                </button>
                <button onClick={() => setSelectedUser(null)} style={styles.btnSecondary}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <footer style={styles.footer}>
        <p>Check <code>flowtrace.jsonl</code> for execution logs</p>
        <p>Dashboard: <code>node ../flowtrace-dashboard/cli.js open flowtrace.jsonl</code></p>
      </footer>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  app: {
    minHeight: '100vh',
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#282c34',
    padding: '40px 20px',
    color: 'white',
    textAlign: 'center',
  },
  title: {
    margin: 0,
    fontSize: '36px',
  },
  subtitle: {
    margin: '10px 0 0 0',
    fontSize: '16px',
    opacity: 0.8,
  },
  toolbar: {
    padding: '20px',
    display: 'flex',
    gap: '12px',
    backgroundColor: '#fff',
    borderBottom: '1px solid #ddd',
  },
  btnPrimary: {
    padding: '10px 20px',
    backgroundColor: '#007bff',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 'bold',
  },
  btnSecondary: {
    padding: '10px 20px',
    backgroundColor: '#6c757d',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 'bold',
  },
  error: {
    padding: '12px 20px',
    backgroundColor: '#f8d7da',
    color: '#721c24',
    border: '1px solid #f5c6cb',
    borderRadius: '4px',
    margin: '20px',
  },
  modal: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modalContent: {
    backgroundColor: '#fff',
    padding: '30px',
    borderRadius: '8px',
    maxWidth: '500px',
    width: '90%',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    fontSize: '14px',
    fontWeight: 'bold',
  },
  input: {
    padding: '8px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
  },
  modalActions: {
    display: 'flex',
    gap: '12px',
    marginTop: '20px',
  },
  footer: {
    padding: '40px 20px',
    textAlign: 'center',
    backgroundColor: '#fff',
    borderTop: '1px solid #ddd',
    marginTop: '40px',
    color: '#666',
    fontSize: '14px',
  },
};

export default App;
