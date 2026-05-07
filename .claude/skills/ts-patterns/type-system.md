# TypeScript Type System Mastery

## Generics: preserve input-output relationships
```typescript
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] { return obj[key]; }
const name = getProperty({ name: "Alice", age: 30 }, "name"); // string
```
Prefer generics over overloads when possible — overloads are harder to maintain.

## Conditional types with `infer`
```typescript
type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;
type AsyncReturnType<T extends (...args: any) => any> = UnwrapPromise<ReturnType<T>>;
type Flatten<T> = T extends Array<infer U> ? U : T;
```

## Mapped types with key remapping + template literals
```typescript
type Getters<T> = { [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K] };
type EventMap<T> = { [K in keyof T as `on${Capitalize<string & K>}Change`]: (v: T[K]) => void };
// UserGetters = { getId: () => number; getName: () => string }
```

## `satisfies` (TS 4.9): validate without widening
```typescript
const palette = { red: [255, 0, 0], green: "#00ff00" } satisfies Record<string, string | number[]>;
palette.red.map(x => x);     // number[] preserved (not string | number[])
palette.green.toUpperCase();  // string preserved
```

## `as const` for literal types
```typescript
const routes = ["home", "about", "contact"] as const;
type Route = (typeof routes)[number]; // "home" | "about" | "contact"
```

## `const` type parameters (TS 5.0): literal inference in generics
```typescript
function routes<const T extends readonly { path: string }[]>(r: T) { return r; }
const r = routes([{ path: "/home" }, { path: "/about" }]);
// readonly [{ path: "/home" }, { path: "/about" }]
```

## `NoInfer<T>` (TS 5.4): control inference site
```typescript
function createLight<C extends string>(colors: C[], defaultColor?: NoInfer<C>) {}
createLight(["red", "yellow", "green"], "blue"); // ❌ Error!
```

## `using` / `await using` (TS 5.2): automatic resource cleanup
```typescript
async function work() {
  await using conn = await getDbConnection();
  await conn.query("SELECT 1");
} // conn[Symbol.asyncDispose]() called automatically
```

## Variadic tuple types (TS 4.0)
```typescript
type Concat<A extends unknown[], B extends unknown[]> = [...A, ...B];
```

## `override` keyword (TS 4.3)
With `--noImplicitOverride`, must explicitly declare when overriding base class methods.

## Inferred type predicates (TS 5.5)
```typescript
// arr.filter(x => x !== undefined) now returns correct type without manual guards
```

## Utility types cheat sheet
- `Pick<T, K>`, `Omit<T, K>` — subset/exclude keys
- `Partial<T>`, `Required<T>` — optional/required all
- `Readonly<T>`, `Record<K, V>` — immutable/map
- `Parameters<T>`, `ReturnType<T>` — function introspection
- `Awaited<T>` — unwrap Promise recursively
- `Exclude<T, U>`, `Extract<T, U>` — union filtering
