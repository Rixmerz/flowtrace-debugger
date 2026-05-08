# UI Best Practices (2024-2025)

## Performance

### Lazy Loading and Code Splitting

```tsx
// Route-level code splitting (React 19)
import { lazy, Suspense } from "react";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Settings = lazy(() => import("./pages/Settings"));

function App() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Routes>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Suspense>
  );
}

// Component-level lazy loading with named exports
const HeavyChart = lazy(() => import("./components/charts").then((m) => ({ default: m.HeavyChart })));
```

### Virtualization (TanStack Virtual)

```tsx
import { useVirtualizer } from "@tanstack/react-virtual";

function VirtualizedList({ items }: { items: Item[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 5,
  });

  return (
    <div ref={parentRef} style={{ height: 600, overflow: "auto" }}>
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div key={virtualRow.key} style={{ position: "absolute", top: virtualRow.start, height: virtualRow.size, width: "100%" }}>
            <ItemRow item={items[virtualRow.index]} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Image Optimization

```tsx
// Next.js: automatic optimization
import Image from "next/image";

<Image src="/hero.jpg" alt="Hero" width={1200} height={600} priority  // LCP image: skip lazy load
  sizes="(max-width: 768px) 100vw, 1200px"
  placeholder="blur" blurDataURL={blurData}
/>

// Generic: responsive images with srcset
<picture>
  <source srcSet="/hero.avif" type="image/avif" />
  <source srcSet="/hero.webp" type="image/webp" />
  <img src="/hero.jpg" alt="Hero" width="1200" height="600" loading="lazy" decoding="async"
    fetchPriority="low" sizes="(max-width: 768px) 100vw, 1200px" />
</picture>
```

### React Compiler (React 19)

```tsx
// React Compiler auto-memoizes. Manual useMemo/useCallback often unnecessary.
// Before (manual):
const MemoizedList = memo(({ items, onSelect }) => {
  const sorted = useMemo(() => items.sort(compareFn), [items]);
  const handleSelect = useCallback((id) => onSelect(id), [onSelect]);
  return sorted.map((item) => <Row key={item.id} item={item} onSelect={handleSelect} />);
});

// After (with React Compiler): write plain code, compiler handles memoization
function List({ items, onSelect }: { items: Item[]; onSelect: (id: string) => void }) {
  const sorted = items.toSorted(compareFn);
  return sorted.map((item) => <Row key={item.id} item={item} onSelect={() => onSelect(item.id)} />);
}
```

### Core Web Vitals Optimization Checklist

| Metric | Optimization | Impact |
|--------|-------------|--------|
| **LCP** | Preload hero image, inline critical CSS, server-render above fold | Direct |
| **LCP** | `fetchPriority="high"` on LCP element, avoid client-side redirects | Direct |
| **INP** | Debounce/throttle handlers, use `startTransition` for non-urgent updates | Direct |
| **INP** | Move heavy computation to Web Workers | High |
| **CLS** | Set explicit `width`/`height` on images/video, use `aspect-ratio` | Direct |
| **CLS** | Reserve space for dynamic content, avoid layout-shifting fonts | Direct |

## Accessibility (a11y)

### Semantic HTML and ARIA

```tsx
// Prefer semantic HTML over ARIA when possible
function Navigation({ items }: { items: NavItem[] }) {
  return (
    <nav aria-label="Main navigation">
      <ul role="list">
        {items.map((item) => (
          <li key={item.href}>
            <a href={item.href} aria-current={item.active ? "page" : undefined}>{item.label}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// Dialog with proper focus management
function Modal({ isOpen, onClose, title, children }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen) dialog.showModal();
    else dialog.close();
  }, [isOpen]);

  return (
    <dialog ref={dialogRef} onClose={onClose} aria-labelledby="modal-title">
      <h2 id="modal-title">{title}</h2>
      {children}
      <button onClick={onClose} aria-label="Close dialog">X</button>
    </dialog>
  );
}
```

### Keyboard Navigation and Focus

```tsx
// Roving tabindex for composite widgets (toolbar, menu, listbox)
function Toolbar({ items }: { items: ToolbarItem[] }) {
  const [activeIndex, setActiveIndex] = useState(0);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    let next = activeIndex;
    if (e.key === "ArrowRight") next = (activeIndex + 1) % items.length;
    if (e.key === "ArrowLeft") next = (activeIndex - 1 + items.length) % items.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = items.length - 1;
    if (next !== activeIndex) { e.preventDefault(); setActiveIndex(next); }
  };

  return (
    <div role="toolbar" aria-label="Formatting" onKeyDown={handleKeyDown}>
      {items.map((item, i) => (
        <button key={item.id} tabIndex={i === activeIndex ? 0 : -1} ref={(el) => { if (i === activeIndex) el?.focus(); }}
          aria-pressed={item.active}>{item.label}</button>
      ))}
    </div>
  );
}
```

### Reduced Motion

```css
/* Respect user preference globally */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

```tsx
// Hook for conditional animations
function usePrefersReducedMotion() {
  const [reduces, setReduces] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setReduces(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduces;
}
```

## Security

### XSS Prevention

```tsx
// React auto-escapes JSX expressions -- this is safe:
<p>{userInput}</p>

// DANGEROUS: only use with sanitized HTML
import DOMPurify from "dompurify";
const clean = DOMPurify.sanitize(rawHtml, { ALLOWED_TAGS: ["b", "i", "a", "p"], ALLOWED_ATTR: ["href"] });
<div dangerouslySetInnerHTML={{ __html: clean }} />

// CSP header (next.config.ts)
const cspHeader = `
  default-src 'self';
  script-src 'self' 'nonce-${nonce}';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
`;
```

### CSRF and iframe Protection

```tsx
// Next.js middleware for security headers
import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return response;
}
```

## TypeScript for UI

### Generic Components

```tsx
// Generic list component with type inference
interface ListProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
  keyExtractor: (item: T) => string;
  emptyState?: ReactNode;
}

function List<T>({ items, renderItem, keyExtractor, emptyState }: ListProps<T>) {
  if (items.length === 0 && emptyState) return <>{emptyState}</>;
  return <ul>{items.map((item, i) => <li key={keyExtractor(item)}>{renderItem(item, i)}</li>)}</ul>;
}

// Usage: T is inferred as User
<List items={users} keyExtractor={(u) => u.id} renderItem={(user) => <span>{user.name}</span>} />
```

### Discriminated Unions for Props

```tsx
// Polymorphic button: link or button, never both
type ButtonProps =
  | { as: "button"; onClick: () => void; href?: never; type?: "button" | "submit" }
  | { as: "link"; href: string; onClick?: never; type?: never };

type CommonProps = { children: ReactNode; variant?: "primary" | "ghost"; disabled?: boolean };

function Button({ as, children, variant = "primary", ...rest }: ButtonProps & CommonProps) {
  const className = `btn btn-${variant}`;
  if (as === "link") return <a className={className} href={rest.href}>{children}</a>;
  return <button className={className} type={rest.type ?? "button"} onClick={rest.onClick} disabled={rest.disabled}>{children}</button>;
}
```

## i18n

```tsx
// next-intl: type-safe internationalization
import { useTranslations } from "next-intl";

function ProductCard({ product }: { product: Product }) {
  const t = useTranslations("product");
  const format = useFormatter();

  return (
    <div>
      <h3>{t("title", { name: product.name })}</h3>
      <p>{format.number(product.price, { style: "currency", currency: "USD" })}</p>
      <p>{format.relativeTime(product.createdAt)}</p>
      <p>{t("stock", { count: product.stock })}</p> {/* ICU: "{count, plural, =0 {Out of stock} one {# item left} other {# items left}}" */}
    </div>
  );
}
```

### CSS Logical Properties for RTL

```css
/* Use logical properties instead of physical for RTL support */
.card {
  margin-inline-start: 1rem;   /* not margin-left */
  padding-inline: 1.5rem;     /* not padding-left/right */
  border-inline-end: 1px solid var(--border);  /* not border-right */
  text-align: start;           /* not text-align: left */
  float: inline-start;         /* not float: left */
}
```

## SEO

```tsx
// Next.js 15 Metadata API
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug);
  return {
    title: product.name,
    description: product.summary,
    openGraph: { title: product.name, description: product.summary, images: [{ url: product.image, width: 1200, height: 630 }] },
    alternates: { canonical: `https://example.com/products/${slug}` },
  };
}

// Structured data (JSON-LD)
export default function ProductPage({ product }: { product: Product }) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    image: product.image,
    offers: { "@type": "Offer", price: product.price, priceCurrency: "USD", availability: "https://schema.org/InStock" },
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <ProductContent product={product} />
    </>
  );
}
```

## Error Handling

```tsx
// Error boundary with retry
"use client";
import { Component, type ReactNode } from "react";

interface Props { children: ReactNode; fallback?: (error: Error, retry: () => void) => ReactNode }
interface State { error: Error | null }

class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  retry = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return this.props.fallback?.(this.state.error, this.retry) ?? (
        <div role="alert">
          <h2>Something went wrong</h2>
          <pre>{this.state.error.message}</pre>
          <button onClick={this.retry}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Next.js 15 error.tsx: file-convention error boundary
// app/products/error.tsx
"use client";
export default function ProductError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert">
      <h2>Failed to load products</h2>
      <p>{error.message}</p>
      <button onClick={reset}>Retry</button>
    </div>
  );
}
```
