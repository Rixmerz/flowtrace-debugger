# FlowTrace Next.js 14 + TypeScript Example

Example demonstrating FlowTrace integration with Next.js 14 App Router and TypeScript.

## Features

- ✅ **Next.js 14 App Router** - Modern Next.js architecture
- ✅ **TypeScript Decorators** - `@Trace` for automatic tracing
- ✅ **API Routes** - Traced Next.js API endpoints
- ✅ **Server Components** - React Server Components with tracing
- ✅ **Server Actions** - Next.js Server Actions with automatic instrumentation

## Quick Start

### 1. Install Dependencies

```bash
cd examples/nextjs-typescript
npm install
```

### 2. Run with FlowTrace

```bash
npm run dev:trace
```

### 3. Open Browser

Navigate to `http://localhost:3000`

### 4. Generate Traces

- Visit pages and interact with the UI
- API routes and server actions are automatically traced
- Check `flowtrace.jsonl` for execution logs

### 5. Analyze

```bash
node ../../flowtrace-dashboard/cli.js open flowtrace.jsonl
```

## Project Structure

```
nextjs-typescript/
├── app/
│   ├── api/
│   │   └── users/
│   │       └── route.ts        # API route with @Trace
│   ├── users/
│   │   └── page.tsx            # User list page
│   ├── layout.tsx              # Root layout
│   └── page.tsx                # Home page
├── lib/
│   └── services/
│       └── UserService.ts      # Service with @TraceClass
├── types/
│   └── User.ts                 # TypeScript types
├── next.config.js
├── tsconfig.json
└── package.json
```

## TypeScript Configuration

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,  // Required for @Trace
    "emitDecoratorMetadata": true
  }
}
```

## API Route Example

```typescript
// app/api/users/route.ts
import { Trace } from '@/lib/flowtrace/decorators';

class UsersAPI {
  @Trace()
  async GET(request: Request) {
    const users = await userService.getAllUsers();
    return Response.json(users);
  }

  @Trace()
  async POST(request: Request) {
    const body = await request.json();
    const user = await userService.createUser(body);
    return Response.json(user, { status: 201 });
  }
}

const api = new UsersAPI();
export const GET = api.GET.bind(api);
export const POST = api.POST.bind(api);
```

## Server Action Example

```typescript
// app/actions.ts
'use server';

import { Trace } from '@/lib/flowtrace/decorators';
import { userService } from '@/lib/services/UserService';

export async function createUser(formData: FormData) {
  'use server';

  const data = {
    name: formData.get('name') as string,
    email: formData.get('email') as string,
    role: 'user' as const,
  };

  return await userService.createUser(data);
}
```

## Environment Variables

Create `.env.local`:

```bash
FLOWTRACE_PACKAGE_PREFIX=app,lib
FLOWTRACE_LOG_FILE=flowtrace.jsonl
FLOWTRACE_STDOUT=false
```

## Dashboard Analysis

After generating traces:

```bash
node ../../flowtrace-dashboard/cli.js open flowtrace.jsonl
```

Analyze:
- API route performance
- Server action execution times
- Data fetching patterns
- Performance bottlenecks

## License

MIT - See main FlowTrace LICENSE

## Author

Juan Pablo Diaz <juanpablo516@gmail.com>
