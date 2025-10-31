/**
 * User Service - Business Logic (IMPORTED MODULE)
 * Este módulo SÍ debería ser instrumentado
 */

const users = [
  { id: 1, name: 'Alice', email: 'alice@example.com' },
  { id: 2, name: 'Bob', email: 'bob@example.com' }
];

class UserService {
  constructor() {
    this.cache = new Map();
  }

  findById(id) {
    console.log(`[UserService] Finding user ${id}`);

    if (this.cache.has(id)) {
      return this.cache.get(id);
    }

    const user = users.find(u => u.id === id);
    if (user) {
      this.cache.set(id, user);
    }
    return user;
  }

  createUser(userData) {
    console.log(`[UserService] Creating user ${userData.name}`);
    const newUser = { id: users.length + 1, ...userData };
    users.push(newUser);
    return newUser;
  }
}

module.exports = { UserService };
