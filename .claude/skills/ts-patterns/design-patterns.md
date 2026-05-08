# TypeScript Design Patterns

## Creational

### Singleton via module caching (preferred)
```typescript
const connection = createConnection("postgres://...");
export const db = { query: (sql: string) => connection.query(sql) };
```

### Builder with type-safe accumulation
Boolean generics track required fields, preventing `build()` without them:
```typescript
class QueryBuilder<HasTable extends boolean = false, HasSelect extends boolean = false> {
  private _table?: string;
  private _fields: string[] = [];
  from(table: string): QueryBuilder<true, HasSelect> { this._table = table; return this as any; }
  select(...fields: string[]): QueryBuilder<HasTable, true> { this._fields = fields; return this as any; }
  build(this: QueryBuilder<true, true>): string {
    return `SELECT ${this._fields.join(",")} FROM ${this._table}`;
  }
}
// new QueryBuilder().build(); // ❌ Compile error
// new QueryBuilder().from("users").select("id").build(); // ✅
```

### Factory with generics
```typescript
interface Factory<T extends Product> { create(name: string): T; }
class WidgetFactory implements Factory<Widget> { create(name: string) { return new Widget(name); } }
```

## Structural

### Decorator (Stage 3 TC39, TS 5.0+ no flag)
```typescript
function logged(originalMethod: any, context: ClassMethodDecoratorContext) {
  return function (this: any, ...args: any[]) {
    console.log(`Calling ${String(context.name)}`);
    return originalMethod.call(this, ...args);
  };
}
```
Note: Stage 3 uses `context` object, NOT legacy `(target, propertyKey, descriptor)`.

### Composite with discriminated unions
```typescript
type FSNode =
  | { type: "file"; name: string; size: number }
  | { type: "directory"; name: string; children: FSNode[] };
function totalSize(node: FSNode): number {
  switch (node.type) {
    case "file": return node.size;
    case "directory": return node.children.reduce((sum, c) => sum + totalSize(c), 0);
  }
}
```

### Proxy with ES Proxy typed
```typescript
function createValidatedProxy<T extends object>(
  obj: T, validator: (key: keyof T, value: any) => boolean
): T {
  return new Proxy(obj, {
    set(target, prop, value) {
      if (!validator(prop as keyof T, value)) throw new Error(`Invalid ${String(prop)}`);
      return Reflect.set(target, prop, value);
    },
  });
}
```

## Behavioral

### Strategy as first-class functions
```typescript
type SortStrategy<T> = (a: T, b: T) => number;
function sortUsers(users: User[], strategy: SortStrategy<User>): User[] {
  return [...users].sort(strategy);
}
const byName: SortStrategy<User> = (a, b) => a.name.localeCompare(b.name);
```

### Observer with typed EventEmitter
```typescript
class TypedEventEmitter<Events extends Record<string, any>> {
  private listeners = new Map<keyof Events, Set<Function>>();
  on<K extends keyof Events>(event: K, fn: (data: Events[K]) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return () => this.listeners.get(event)!.delete(fn);
  }
  emit<K extends keyof Events>(event: K, data: Events[K]) {
    this.listeners.get(event)?.forEach(fn => fn(data));
  }
}
```

### State via discriminated unions
```typescript
type RequestState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: User }
  | { status: "error"; error: Error };
```

### Chain of Responsibility (middleware)
```typescript
type Middleware<T> = (ctx: T, next: () => Promise<void>) => Promise<void>;
```

## Modern Ecosystem Patterns

### Result type (neverthrow)
```typescript
import { ok, err, Result } from "neverthrow";
function divide(a: number, b: number): Result<number, string> {
  return b === 0 ? err("Division by zero") : ok(a / b);
}
divide(10, 2).map(r => r * 2).match(val => console.log(val), err => console.error(err));
```

### Branded types (nominal typing)
```typescript
declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };
type UserId = Brand<string, "UserId">;
type OrderId = Brand<string, "OrderId">;
// getUser(createUserId("abc")); // ✅
// getUser("abc");               // ❌
```

### Exhaustive checking
```typescript
function assertNever(x: never): never { throw new Error("Unhandled: " + x); }
// Adding a new variant to a union causes compile error at the default case
```

### Pipe/Compose (Effect/fp-ts)
```typescript
import { pipe } from "effect/Function";
const result = pipe(Either.right(5), Either.map(n => n * 2), Either.flatMap(n => n > 0 ? Either.right(n) : Either.left("neg")));
```
