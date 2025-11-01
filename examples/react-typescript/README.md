# FlowTrace React + TypeScript Example

Complete example demonstrating FlowTrace integration with React, TypeScript, and modern hooks.

## Features

- ✅ **TypeScript Support** - Full type safety with FlowTrace type definitions
- ✅ **Decorator Pattern** - `@Trace`, `@TraceClass` decorators for automatic tracing
- ✅ **React Hooks** - Custom `useUsers` hook with typed state management
- ✅ **Service Layer** - TypeScript service class with automatic tracing
- ✅ **Modern React** - Functional components, hooks, and TypeScript types
- ✅ **Vite** - Fast development with Hot Module Replacement
- ✅ **Dashboard Integration** - Analyze performance with FlowTrace Dashboard

## Quick Start

### 1. Install Dependencies

```bash
cd examples/react-typescript
npm install
```

### 2. Run with FlowTrace

```bash
npm run dev:trace
```

This starts the development server with FlowTrace instrumentation enabled.

### 3. Use the Application

- Create, update, and delete users
- All service operations are automatically traced
- Logs are written to `flowtrace.jsonl`

### 4. Analyze with Dashboard

```bash
# In another terminal
node ../../flowtrace-dashboard/cli.js open flowtrace.jsonl
```

Open the dashboard URL in your browser to analyze performance metrics.

## Project Structure

```
react-typescript/
├── src/
│   ├── components/
│   │   └── UserList.tsx         # React component
│   ├── hooks/
│   │   └── useUsers.ts          # Custom React hook
│   ├── services/
│   │   └── UserService.ts       # Service with @TraceClass
│   ├── types/
│   │   └── User.ts              # TypeScript interfaces
│   ├── App.tsx                  # Main application
│   ├── main.tsx                 # Entry point
│   └── index.css                # Styles
├── package.json
├── tsconfig.json                # TypeScript config with decorators
├── vite.config.ts               # Vite configuration
└── README.md
```

## TypeScript Decorator Usage

### Class-Level Tracing

```typescript
import { TraceClass } from '../../../flowtrace-agent-js/src/decorators';

@TraceClass()
export class UserService {
  // All methods automatically traced
  async getAllUsers() { ... }
  async createUser(data) { ... }
  async updateUser(id, data) { ... }
}
```

### Method-Level Tracing

```typescript
import { Trace } from '../../../flowtrace-agent-js/src/decorators';

export class AuthService {
  @Trace()
  async login(email: string, password: string) {
    // Automatically traced
  }

  @Trace({ captureArgs: false })
  async validateToken(token: string) {
    // Traced without capturing arguments
  }
}
```

### Hook Integration

```typescript
export function useUsers() {
  const [users, setUsers] = useState<User[]>([]);

  const fetchUsers = useCallback(async () => {
    // Service call automatically traced
    const data = await userService.getAllUsers();
    setUsers(data);
  }, []);

  return { users, fetchUsers };
}
```

## Configuration

### tsconfig.json

Decorators require these compiler options:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

### FlowTrace Configuration

Environment variables for tracing:

```bash
# Filter to only trace your code
FLOWTRACE_PACKAGE_PREFIX=src

# Log file output
FLOWTRACE_LOG_FILE=flowtrace.jsonl

# Disable console output (logs only to file)
FLOWTRACE_STDOUT=false
```

## Log Format

FlowTrace generates JSONL logs for each traced method:

```json
{"timestamp":1635789012345,"event":"ENTER","thread":"main","class":"UserService","method":"getAllUsers","args":"[]"}
{"timestamp":1635789012567,"event":"EXIT","thread":"main","class":"UserService","method":"getAllUsers","args":"[]","result":"[{\"id\":1,...}]","durationMicros":222000,"durationMillis":222}
```

## Dashboard Analysis

The FlowTrace Dashboard provides:

- **Performance Metrics** - P50, P95, P99 percentiles
- **Bottleneck Detection** - Methods with high impact (frequency × duration)
- **Error Tracking** - Exception rates and error hotspots
- **Time Distribution** - Histogram of method durations
- **Slowest Methods** - Performance optimization targets

## TypeScript Features Demonstrated

### Type Safety

```typescript
// Strongly typed interfaces
interface User {
  id: number;
  name: string;
  email: string;
  role: UserRole;
}

type UserRole = 'admin' | 'user' | 'guest';
```

### Generic Types

```typescript
const [users, setUsers] = useState<User[]>([]);
const [selectedUser, setSelectedUser] = useState<User | null>(null);
```

### Async/Await with Types

```typescript
async getAllUsers(filters?: UserFilters): Promise<User[]> {
  // TypeScript ensures type safety
  const filtered = this.users.filter(u => u.role === filters?.role);
  return filtered;
}
```

## Development

### Start Dev Server

```bash
npm run dev              # Normal mode
npm run dev:trace        # With FlowTrace instrumentation
```

### Build for Production

```bash
npm run build
npm run preview
```

### Type Checking

```bash
npx tsc --noEmit
```

## Best Practices

### ✅ Good Practices

1. **Declare Services at Module Level**
   ```typescript
   // Good: Service declared before usage
   export class UserService { }
   export const userService = new UserService();
   ```

2. **Use Decorators for Automatic Tracing**
   ```typescript
   @TraceClass() // Easier than manual tracing
   export class DataService { }
   ```

3. **Type Your Props and State**
   ```typescript
   interface UserListProps {
     users: User[];
     loading: boolean;
   }
   ```

### ❌ Avoid

1. **Hoisting Dependencies**
   ```typescript
   // Bad: Using before declaration
   const service = new UserService();
   class UserService { }
   ```

2. **Missing TypeScript Config**
   ```typescript
   // Decorators won't work without:
   // "experimentalDecorators": true
   ```

## Troubleshooting

### Decorators Not Working

Ensure `tsconfig.json` has:
```json
{
  "compilerOptions": {
    "experimentalDecorators": true
  }
}
```

### Empty Logs

Check that `FLOWTRACE_PACKAGE_PREFIX` matches your source directory:
```bash
FLOWTRACE_PACKAGE_PREFIX=src  # For src/ directory
```

### Type Errors

Install type definitions:
```bash
npm install --save-dev @types/react @types/react-dom @types/node
```

## License

MIT - See main FlowTrace LICENSE

## Author

Juan Pablo Diaz <juanpablo516@gmail.com>
