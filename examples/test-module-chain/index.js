/**
 * Entry Point - Simula un index.js real de una API
 * Solo hace wiring, NO lógica de negocio
 */

const { UserService } = require('./userService');

console.log('=== Simulating Real API Entry Point ===');
console.log('Wiring services...');

const userService = new UserService();

console.log('\nExecuting business logic:');
const user = userService.findById(1);
console.log('Result:', user);

const newUser = userService.createUser({ name: 'Test', email: 'test@test.com' });
console.log('Created:', newUser);
