# Modern Web Platform Features

## View Transitions API

Smooth animated transitions between DOM states or page navigations, built into the browser.

```tsx
// SPA view transition (same-document)
function navigateTo(path: string) {
  if (!document.startViewTransition) {
    updateDOM(path);
    return;
  }
  document.startViewTransition(() => updateDOM(path));
}

// Named view transitions for hero elements
// CSS: assign transition names to elements that should animate across states
// .product-image { view-transition-name: product-hero; }
// .product-title { view-transition-name: product-title; }

// Customize transition animations
/* ::view-transition-old(product-hero) { animation: fade-out 0.3s ease-out; }
   ::view-transition-new(product-hero) { animation: fade-in 0.3s ease-in; } */

// Next.js integration with useTransitionRouter (next-view-transitions)
import { useTransitionRouter } from "next-view-transitions";

function ProductCard({ product }: { product: Product }) {
  const router = useTransitionRouter();
  return (
    <div onClick={() => router.push(`/products/${product.slug}`)}>
      <img style={{ viewTransitionName: `product-${product.id}` }} src={product.image} alt={product.name} />
      <h3 style={{ viewTransitionName: `title-${product.id}` }}>{product.name}</h3>
    </div>
  );
}

// Cross-document transitions (MPA): opt-in via meta tag
// <meta name="view-transition" content="same-origin" />
// Browser auto-animates matching view-transition-names across pages
```

## Popover API

Native popover behavior without JavaScript positioning or z-index management.

```html
<!-- Declarative popover: no JS needed for show/hide -->
<button popovertarget="my-popover">Open Menu</button>
<div id="my-popover" popover>
  <nav>
    <a href="/settings">Settings</a>
    <a href="/profile">Profile</a>
  </nav>
</div>

<!-- Anchor positioning (CSS Anchor Positioning) -->
<style>
  .trigger { anchor-name: --menu-trigger; }
  .popover-menu {
    position-anchor: --menu-trigger;
    inset-area: bottom span-right;
    margin-top: 4px;
  }
</style>

<!-- Manual popover (explicit show/hide control) -->
<div id="toast" popover="manual">Saved successfully</div>
<script>
  const toast = document.getElementById("toast");
  toast.showPopover();
  setTimeout(() => toast.hidePopover(), 3000);
</script>
```

```tsx
// React wrapper for popover
function Popover({ trigger, children }: { trigger: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <>
      <button popoverTarget={id}>{trigger}</button>
      <div id={id} popover="" className="popover-content">{children}</div>
    </>
  );
}
```

## Web Workers

Offload heavy computation to background threads without blocking the UI.

```ts
// worker.ts: runs in a separate thread
self.onmessage = (e: MessageEvent<{ type: string; data: unknown[] }>) => {
  if (e.data.type === "sort") {
    const sorted = (e.data.data as number[]).toSorted((a, b) => a - b);
    self.postMessage({ type: "sorted", result: sorted });
  }
  if (e.data.type === "filter") {
    const { items, predicate } = e.data.data as { items: unknown[]; predicate: string };
    const fn = new Function("item", `return ${predicate}`) as (item: unknown) => boolean;
    self.postMessage({ type: "filtered", result: items.filter(fn) });
  }
};

// Using Comlink for ergonomic Worker API
import * as Comlink from "comlink";

// worker.ts
const api = {
  async processCSV(csv: string): Promise<ParsedData[]> {
    // Heavy parsing runs off main thread
    return csv.split("\n").map(parseRow);
  },
  async generateReport(data: unknown[]): Promise<Blob> {
    // CPU-intensive report generation
    return new Blob([buildReport(data)], { type: "application/pdf" });
  },
};
Comlink.expose(api);

// main.ts
const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
const api = Comlink.wrap<typeof import("./worker").api>(worker);
const report = await api.generateReport(data);  // Looks like a normal async call
```

## Intersection Observer

Efficient visibility detection for lazy loading, infinite scroll, and scroll-triggered animations.

```tsx
// Infinite scroll with Intersection Observer
function useInfiniteScroll(loadMore: () => void, hasMore: boolean) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadMore(); },
      { rootMargin: "200px" }
    );
    const sentinel = sentinelRef.current;
    if (sentinel) observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore, hasMore]);

  return sentinelRef;
}

// Usage
function Feed() {
  const { data, fetchNextPage, hasNextPage } = useInfiniteQuery({ /* ... */ });
  const sentinelRef = useInfiniteScroll(fetchNextPage, !!hasNextPage);
  return (
    <>
      {data?.pages.flat().map((post) => <PostCard key={post.id} post={post} />)}
      <div ref={sentinelRef} />
    </>
  );
}

// Scroll-triggered animations
function useScrollAnimation(threshold = 0.2) {
  const ref = useRef<HTMLElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setIsVisible(true); observer.unobserve(el); }
    }, { threshold });
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return { ref, isVisible };
}
```

## CSS Container Queries

Component-responsive design: style based on the container size, not the viewport.

```css
/* Define a containment context */
.card-container {
  container-type: inline-size;
  container-name: card;
}

/* Style based on container width */
@container card (min-width: 400px) {
  .card { display: grid; grid-template-columns: 200px 1fr; }
  .card-image { aspect-ratio: 1; }
}

@container card (max-width: 399px) {
  .card { display: flex; flex-direction: column; }
  .card-image { aspect-ratio: 16/9; }
}

/* Container query units: cqi (inline), cqb (block) */
.card-title {
  font-size: clamp(1rem, 3cqi, 1.5rem);
}
```

## CSS Nesting

Native CSS nesting, no preprocessor needed.

```css
.card {
  padding: 1rem;
  border-radius: 0.5rem;
  background: var(--surface);

  & .title {
    font-size: 1.25rem;
    font-weight: 600;
  }

  & .description {
    color: var(--text-muted);
    margin-block-start: 0.5rem;
  }

  &:hover {
    box-shadow: 0 4px 12px oklch(0 0 0 / 0.1);
  }

  &:has(.badge--urgent) {
    border-inline-start: 3px solid var(--color-danger);
  }

  @media (prefers-color-scheme: dark) {
    background: var(--surface-dark);
  }
}
```

## CSS :has() Selector

Parent selection and conditional styling based on child/sibling state.

```css
/* Style parent based on child state */
.form-group:has(:invalid) {
  border-color: var(--color-danger);
}

.form-group:has(:focus-visible) {
  outline: 2px solid var(--color-primary);
}

/* Card with image vs card without */
.card:has(img) {
  grid-template-rows: 200px 1fr;
}

.card:not(:has(img)) {
  grid-template-rows: 1fr;
}

/* Navigation: highlight active section */
.nav-item:has(a[aria-current="page"]) {
  background: var(--active-bg);
}

/* Quantity selector: disable minus at 1, plus at max */
.quantity-btn.minus:has(+ input[value="1"]) { opacity: 0.5; pointer-events: none; }
```

## OKLCH Color Space

Perceptually uniform colors with wide gamut support.

```css
:root {
  /* OKLCH: lightness (0-1), chroma (0-0.4), hue (0-360) */
  --primary: oklch(0.55 0.25 260);       /* Vibrant blue */
  --primary-light: oklch(0.75 0.15 260); /* Same hue, lighter */
  --primary-dark: oklch(0.35 0.20 260);  /* Same hue, darker */

  /* Generate consistent palettes by varying lightness */
  --success: oklch(0.55 0.20 145);
  --warning: oklch(0.75 0.18 80);
  --danger: oklch(0.55 0.22 25);

  /* Alpha channel */
  --overlay: oklch(0 0 0 / 0.5);
}

/* Relative color syntax: derive colors from a base */
.button {
  --base: oklch(0.55 0.25 260);
  background: var(--base);
  &:hover { background: oklch(from var(--base) calc(l + 0.1) c h); }
  &:active { background: oklch(from var(--base) calc(l - 0.1) c h); }
}
```

## CSS Scroll-Driven Animations

Animate elements based on scroll position without JavaScript.

```css
/* Progress bar that fills as you scroll the page */
.scroll-progress {
  position: fixed;
  top: 0;
  left: 0;
  height: 3px;
  background: var(--primary);
  transform-origin: left;
  animation: grow-progress linear;
  animation-timeline: scroll(root);
}

@keyframes grow-progress {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}

/* Fade-in elements as they scroll into view */
.reveal {
  animation: fade-slide-in linear both;
  animation-timeline: view();
  animation-range: entry 0% entry 100%;
}

@keyframes fade-slide-in {
  from { opacity: 0; transform: translateY(40px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Parallax effect */
.parallax-bg {
  animation: parallax linear;
  animation-timeline: scroll();
}

@keyframes parallax {
  from { transform: translateY(0); }
  to { transform: translateY(-30%); }
}
```

## Speculation Rules API

Prerender or prefetch pages before the user navigates.

```html
<!-- Prerender specific URLs -->
<script type="speculationrules">
{
  "prerender": [
    { "urls": ["/dashboard", "/products"] }
  ],
  "prefetch": [
    { "where": { "href_matches": "/products/*" }, "eagerness": "moderate" }
  ]
}
</script>
```

```tsx
// Dynamic speculation rules in Next.js
function SpeculationRules({ urls }: { urls: string[] }) {
  const rules = { prerender: [{ urls, eagerness: "moderate" as const }] };
  return <script type="speculationrules" dangerouslySetInnerHTML={{ __html: JSON.stringify(rules) }} />;
}
```

**Eagerness levels**: `immediate` (now), `eager` (likely navigate), `moderate` (hover/focus), `conservative` (click down).

## Server Components and Streaming

```tsx
// Streaming SSR with Suspense boundaries (Next.js 15 / React 19)
// Each Suspense boundary streams independently as data resolves
export default function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main>
      <Suspense fallback={<ProductSkeleton />}>
        <ProductDetails id={params} />
      </Suspense>
      <Suspense fallback={<ReviewsSkeleton />}>
        <ProductReviews id={params} />
      </Suspense>
      <Suspense fallback={<RecommendationsSkeleton />}>
        <Recommendations id={params} />
      </Suspense>
    </main>
  );
}

// Each component fetches its own data, streams when ready
async function ProductReviews({ id }: { id: Promise<{ id: string }> }) {
  const { id: productId } = await id;
  const reviews = await db.review.findMany({ where: { productId }, take: 10 }); // 800ms query
  return <ReviewList reviews={reviews} />;
}
```

## WebSocket Patterns

```tsx
// Reconnecting WebSocket with exponential backoff
function useWebSocket<T>(url: string, onMessage: (data: T) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);

  useEffect(() => {
    function connect() {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => { retriesRef.current = 0; };
      ws.onmessage = (event) => { onMessage(JSON.parse(event.data)); };
      ws.onclose = (event) => {
        if (event.code !== 1000) {
          const delay = Math.min(1000 * 2 ** retriesRef.current, 30000);
          retriesRef.current++;
          setTimeout(connect, delay);
        }
      };
    }
    connect();
    return () => { wsRef.current?.close(1000); };
  }, [url, onMessage]);

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return { send };
}
```

## Service Workers

```ts
// Workbox: declarative caching strategies
import { precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

// Precache app shell (injected at build time)
precacheAndRoute(self.__WB_MANIFEST);

// API calls: network-first with cache fallback
registerRoute(
  ({ url }) => url.pathname.startsWith("/api/"),
  new NetworkFirst({ cacheName: "api", networkTimeoutSeconds: 5,
    plugins: [new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 300 })] })
);

// Static assets: cache-first
registerRoute(
  ({ request }) => ["style", "script", "font"].includes(request.destination),
  new CacheFirst({ cacheName: "static", plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 86400 * 30 })] })
);

// Images: stale-while-revalidate
registerRoute(
  ({ request }) => request.destination === "image",
  new StaleWhileRevalidate({ cacheName: "images", plugins: [new ExpirationPlugin({ maxEntries: 200 })] })
);

// Background sync for offline mutations
import { BackgroundSyncPlugin } from "workbox-background-sync";

registerRoute(
  ({ url }) => url.pathname.startsWith("/api/mutations"),
  new NetworkFirst({ plugins: [new BackgroundSyncPlugin("mutation-queue", { maxRetentionTime: 60 * 24 })] }),
  "POST"
);
```
