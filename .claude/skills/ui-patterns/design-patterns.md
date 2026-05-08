# UI Design Patterns

## Compound Components

Context-based components that share implicit state. Users compose them freely without prop drilling.

```tsx
// React 19 compound component pattern
import { createContext, useContext, useState, type ReactNode } from "react";

interface AccordionContext {
  openItems: Set<string>;
  toggle: (id: string) => void;
}

const AccordionCtx = createContext<AccordionContext | null>(null);

function useAccordion() {
  const ctx = useContext(AccordionCtx);
  if (!ctx) throw new Error("Accordion.Item must be used within Accordion");
  return ctx;
}

function Accordion({ children, multiple = false }: { children: ReactNode; multiple?: boolean }) {
  const [openItems, setOpenItems] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setOpenItems((prev) => {
      const next = new Set(multiple ? prev : []);
      if (prev.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return <AccordionCtx value={{ openItems, toggle }}>{children}</AccordionCtx>;
}

function Item({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const { openItems, toggle } = useAccordion();
  const isOpen = openItems.has(id);
  return (
    <div>
      <button aria-expanded={isOpen} onClick={() => toggle(id)}>{title}</button>
      {isOpen && <div role="region">{children}</div>}
    </div>
  );
}

Accordion.Item = Item;

// Usage: composable, no prop drilling
<Accordion multiple>
  <Accordion.Item id="a" title="Section A">Content A</Accordion.Item>
  <Accordion.Item id="b" title="Section B">Content B</Accordion.Item>
</Accordion>
```

## Render Props and Slot Pattern

Inversion of control -- the parent decides what to render with data from the child.

```tsx
// Render prop for headless data components
interface VirtualListProps<T> {
  items: T[];
  height: number;
  itemHeight: number;
  renderItem: (item: T, index: number) => ReactNode;
}

function VirtualList<T>({ items, height, itemHeight, renderItem }: VirtualListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const startIndex = Math.floor(scrollTop / itemHeight);
  const visibleCount = Math.ceil(height / itemHeight) + 1;
  const visibleItems = items.slice(startIndex, startIndex + visibleCount);

  return (
    <div style={{ height, overflow: "auto" }} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
      <div style={{ height: items.length * itemHeight, position: "relative" }}>
        {visibleItems.map((item, i) => (
          <div key={startIndex + i} style={{ position: "absolute", top: (startIndex + i) * itemHeight, height: itemHeight }}>
            {renderItem(item, startIndex + i)}
          </div>
        ))}
      </div>
    </div>
  );
}

// Vue 3 slot pattern equivalent
// <VirtualList :items="users" :height="400" :item-height="60">
//   <template #item="{ item }">
//     <UserRow :user="item" />
//   </template>
// </VirtualList>
```

## Custom Hooks / Composables

Extract reusable stateful logic away from components.

```tsx
// React: custom hook for debounced search
function useDebouncedSearch(searchFn: (query: string) => Promise<unknown[]>, delay = 300) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<unknown[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const data = await searchFn(query);
        if (!controller.signal.aborted) setResults(data);
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }, delay);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, delay, searchFn]);

  return { query, setQuery, results, isLoading } as const;
}
```

```ts
// Vue 3 composable equivalent
import { ref, watch } from "vue";

export function useDebouncedSearch(searchFn: (q: string) => Promise<unknown[]>, delay = 300) {
  const query = ref("");
  const results = ref<unknown[]>([]);
  const isLoading = ref(false);

  watch(query, (val) => {
    if (!val.trim()) { results.value = []; return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      isLoading.value = true;
      const data = await searchFn(val);
      if (!controller.signal.aborted) results.value = data;
      isLoading.value = false;
    }, delay);
    return () => { clearTimeout(timer); controller.abort(); };
  });

  return { query, results, isLoading };
}
```

## Controlled vs Uncontrolled Components

```tsx
// Controlled: parent owns the state
function ControlledInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input value={value} onChange={(e) => onChange(e.target.value)} />;
}

// Uncontrolled with ref: internal state, expose via imperative handle
function UncontrolledInput({ defaultValue, onSubmit }: { defaultValue?: string; onSubmit: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(ref.current!.value); }}>
      <input ref={ref} defaultValue={defaultValue} />
      <button type="submit">Go</button>
    </form>
  );
}

// Hybrid: support both controlled and uncontrolled usage
function FlexibleInput({ value: controlledValue, defaultValue, onChange }: {
  value?: string; defaultValue?: string; onChange?: (v: string) => void;
}) {
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const isControlled = controlledValue !== undefined;
  const currentValue = isControlled ? controlledValue : internalValue;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isControlled) setInternalValue(e.target.value);
    onChange?.(e.target.value);
  };

  return <input value={currentValue} onChange={handleChange} />;
}
```

## State Machines for UI (XState)

```tsx
import { useMachine } from "@xstate/react";
import { setup } from "xstate";

const fetchMachine = setup({
  types: {
    context: {} as { data: unknown[] | null; error: string | null; retries: number },
    events: {} as { type: "FETCH" } | { type: "RESOLVE"; data: unknown[] } | { type: "REJECT"; error: string } | { type: "RETRY" },
  },
}).createMachine({
  id: "fetch",
  initial: "idle",
  context: { data: null, error: null, retries: 0 },
  states: {
    idle: { on: { FETCH: "loading" } },
    loading: {
      invoke: { src: "fetchData", onDone: { target: "success", actions: ({ context, event }) => { context.data = event.output; } },
        onError: { target: "failure", actions: ({ context, event }) => { context.error = String(event.error); } } },
    },
    success: { on: { FETCH: "loading" } },
    failure: { on: { RETRY: { target: "loading", guard: ({ context }) => context.retries < 3, actions: ({ context }) => { context.retries++; } } } },
  },
});

function DataFetcher() {
  const [state, send] = useMachine(fetchMachine);
  if (state.matches("idle")) return <button onClick={() => send({ type: "FETCH" })}>Load</button>;
  if (state.matches("loading")) return <div>Loading...</div>;
  if (state.matches("failure")) return <button onClick={() => send({ type: "RETRY" })}>Retry ({state.context.retries}/3)</button>;
  return <pre>{JSON.stringify(state.context.data, null, 2)}</pre>;
}
```

## Optimistic Updates

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";

function useOptimisticToggleTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (todo: Todo) => api.updateTodo({ ...todo, done: !todo.done }),
    onMutate: async (todo) => {
      await queryClient.cancelQueries({ queryKey: ["todos"] });
      const previous = queryClient.getQueryData<Todo[]>(["todos"]);
      queryClient.setQueryData<Todo[]>(["todos"], (old) =>
        old?.map((t) => (t.id === todo.id ? { ...t, done: !t.done } : t))
      );
      return { previous };
    },
    onError: (_err, _todo, context) => {
      queryClient.setQueryData(["todos"], context?.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["todos"] });
    },
  });
}
```

## Provider Pattern (Context + Composition)

```tsx
// Theme provider with type-safe tokens
interface Theme { colors: { primary: string; surface: string }; spacing: Record<string, string> }

const ThemeCtx = createContext<Theme | null>(null);
export const useTheme = () => { const t = useContext(ThemeCtx); if (!t) throw new Error("Missing ThemeProvider"); return t; };

function ThemeProvider({ theme, children }: { theme: Theme; children: ReactNode }) {
  return (
    <ThemeCtx value={theme}>
      <div style={{ "--color-primary": theme.colors.primary, "--color-surface": theme.colors.surface } as React.CSSProperties}>
        {children}
      </div>
    </ThemeCtx>
  );
}
```

## Container / Presentational Split

```tsx
// Presentational: pure UI, receives everything via props
function UserCard({ name, avatar, role, onEdit }: { name: string; avatar: string; role: string; onEdit: () => void }) {
  return (
    <div className="card">
      <img src={avatar} alt={name} />
      <h3>{name}</h3>
      <span>{role}</span>
      <button onClick={onEdit}>Edit</button>
    </div>
  );
}

// Container: data fetching and business logic
function UserCardContainer({ userId }: { userId: string }) {
  const { data: user, isLoading } = useQuery({ queryKey: ["user", userId], queryFn: () => fetchUser(userId) });
  const editMutation = useMutation({ mutationFn: (data: UserUpdate) => updateUser(userId, data) });

  if (isLoading) return <Skeleton />;
  if (!user) return null;
  return <UserCard name={user.name} avatar={user.avatar} role={user.role} onEdit={() => editMutation.mutate(user)} />;
}
```

## Facade Pattern for Complex APIs

```tsx
// Simplify a complex subsystem behind a clean interface
class NotificationFacade {
  private toast: ToastService;
  private sound: SoundService;
  private badge: BadgeService;

  constructor(toast: ToastService, sound: SoundService, badge: BadgeService) {
    this.toast = toast; this.sound = sound; this.badge = badge;
  }

  success(message: string) { this.toast.show({ message, type: "success" }); this.sound.play("success"); }
  error(message: string) { this.toast.show({ message, type: "error", duration: 8000 }); this.sound.play("error"); this.badge.increment(); }
  async permission() { return Notification.requestPermission(); }
}
```

## Observer Pattern (Intersection Observer)

```tsx
function useIntersectionObserver(options?: IntersectionObserverInit) {
  const [entry, setEntry] = useState<IntersectionObserverEntry | null>(null);
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([e]) => setEntry(e), options);
    observer.observe(node);
    return () => observer.disconnect();
  }, [options?.threshold, options?.root, options?.rootMargin]);

  return { ref, entry, isIntersecting: entry?.isIntersecting ?? false };
}

// Usage: lazy-load images, infinite scroll triggers
function LazyImage({ src, alt }: { src: string; alt: string }) {
  const { ref, isIntersecting } = useIntersectionObserver({ rootMargin: "200px" });
  return <img ref={ref as React.Ref<HTMLImageElement>} src={isIntersecting ? src : undefined} alt={alt} loading="lazy" />;
}
```

## Anti-Patterns

| Anti-pattern | Problem | Fix |
|-------------|---------|-----|
| Prop drilling (5+ levels) | Tight coupling, hard to refactor | Context, Zustand, or composition |
| God components (>300 lines) | Untestable, unmaintainable | Split into container + presentational |
| `useEffect` for derived state | Unnecessary re-renders, stale data | `useMemo` or compute inline |
| Premature abstraction | Over-engineering, wrong boundaries | Wait for 3 uses before extracting |
| State duplication | Out-of-sync bugs | Single source of truth + derive |
| Fetching in useEffect without cleanup | Race conditions, memory leaks | TanStack Query or AbortController |
| Inline function props in render | Breaks memoization | `useCallback` or extract handler |
| Boolean state explosion | Impossible states representable | Discriminated unions or state machines |
| Direct DOM manipulation in React | Breaks reconciliation | Use refs, portals, or state |
