# Frontend Architecture Patterns

## Feature-Sliced Design (FSD)

Layered architecture where each layer has a clear responsibility and can only import from layers below it.

```
src/
  app/          -- App-wide setup: providers, router, global styles
  processes/    -- Cross-page flows (onboarding wizard, checkout)
  pages/        -- Route-level components, compose widgets/features
  widgets/      -- Complex UI blocks (header, sidebar, feed)
  features/     -- User interactions (add-to-cart, search, auth)
  entities/     -- Business domain (user, product, order)
  shared/       -- Reusable utils, UI kit, API client, config
```

**Import rule**: `app -> processes -> pages -> widgets -> features -> entities -> shared` (never upward).

```
features/
  add-to-cart/
    ui/            -- AddToCartButton.tsx
    model/         -- useAddToCart.ts (hook), store slice
    api/           -- addToCart.ts (API call)
    index.ts       -- Public API (barrel export)
```

| Layer | Can import from | Contains |
|-------|----------------|----------|
| shared | nothing | UI kit, helpers, types, API client |
| entities | shared | Domain models, base UI for entities |
| features | entities, shared | User actions, business logic |
| widgets | features, entities, shared | Composed UI blocks |
| pages | widgets, features, entities, shared | Route components |

## Micro Frontends

| Approach | Integration | Trade-offs |
|----------|------------|------------|
| **Module Federation 2** | Runtime JS modules | Shared dependencies, version negotiation, webpack/rspack |
| **Single-SPA** | Framework-agnostic orchestrator | Multiple frameworks coexist, complex setup |
| **iframe-based** | Native browser isolation | Full isolation, limited communication, SEO issues |
| **Server-side composition** | Edge/CDN stitching | SSR-friendly, Tailor/Podium/Piral |
| **Web Components** | Custom elements | Framework-agnostic, Shadow DOM encapsulation |

```ts
// Module Federation 2 (rspack.config.ts)
const { ModuleFederationPlugin } = require("@module-federation/enhanced/rspack");

module.exports = {
  plugins: [
    new ModuleFederationPlugin({
      name: "shell",
      remotes: {
        checkout: "checkout@https://checkout.example.com/remoteEntry.js",
        catalog: "catalog@https://catalog.example.com/remoteEntry.js",
      },
      shared: {
        react: { singleton: true, requiredVersion: "^19.0.0" },
        "react-dom": { singleton: true, requiredVersion: "^19.0.0" },
      },
    }),
  ],
};
```

## Islands Architecture

Ship zero JS by default. Hydrate only interactive components ("islands") independently.

```astro
---
// Astro 5: static by default, islands opt-in
import StaticHeader from "../components/Header.astro";  // Zero JS
import SearchBar from "../components/SearchBar.tsx";     // React island
import ProductGrid from "../components/ProductGrid.svelte"; // Svelte island
---

<StaticHeader />
<!-- client:visible hydrates when element enters viewport -->
<SearchBar client:visible placeholder="Search products..." />
<!-- client:idle hydrates when browser is idle -->
<ProductGrid client:idle products={products} />
<!-- client:load hydrates immediately (use sparingly) -->
<!-- client:media="(min-width: 768px)" hydrates only on desktop -->
```

**Hydration directives**:
- `client:load` -- Immediate hydration (highest priority)
- `client:idle` -- After page load, when browser is idle
- `client:visible` -- When component enters the viewport
- `client:media` -- When a CSS media query matches
- `client:only="react"` -- Client-render only, no SSR

## BFF (Backend for Frontend) Pattern

A lightweight backend layer tailored to specific frontend needs. Aggregates data, handles auth, shapes responses.

```
Mobile App  -->  Mobile BFF  -->  |
Web App     -->  Web BFF     -->  | Microservices
Admin Panel -->  Admin BFF   -->  |
```

```ts
// Next.js Server Action as BFF layer
"use server";
import { auth } from "@/lib/auth";
import { productService, reviewService, inventoryService } from "@/lib/services";

export async function getProductPage(slug: string) {
  const session = await auth();
  const [product, reviews, inventory] = await Promise.all([
    productService.getBySlug(slug),
    reviewService.getByProduct(slug, { limit: 10 }),
    inventoryService.getStock(slug),
  ]);

  return {
    product: { ...product, price: session?.isPremium ? product.premiumPrice : product.price },
    reviews: reviews.map(({ id, rating, text, author }) => ({ id, rating, text, author })),
    inStock: inventory.quantity > 0,
  };
}
```

## Offline-First Architecture

```ts
// Service Worker caching strategy selection
const CACHE_STRATEGIES = {
  // Static assets: cache first, fallback to network
  static: new CacheFirst({ cacheName: "static-v1", plugins: [new ExpirationPlugin({ maxEntries: 100 })] }),
  // API data: network first, fallback to cache
  api: new NetworkFirst({ cacheName: "api-v1", networkTimeoutSeconds: 3 }),
  // Images: stale-while-revalidate
  images: new StaleWhileRevalidate({ cacheName: "images-v1" }),
};

// IndexedDB for structured offline data (using Dexie)
import Dexie from "dexie";

class AppDB extends Dexie {
  todos!: Table<Todo, string>;
  syncQueue!: Table<SyncOperation, string>;

  constructor() {
    super("app-db");
    this.version(1).stores({
      todos: "id, updatedAt, [status+priority]",
      syncQueue: "id, createdAt, type",
    });
  }
}

// Sync strategy: queue mutations offline, replay when online
async function syncOfflineChanges(db: AppDB) {
  const pending = await db.syncQueue.orderBy("createdAt").toArray();
  for (const op of pending) {
    try {
      await fetch(op.url, { method: op.method, body: JSON.stringify(op.payload) });
      await db.syncQueue.delete(op.id);
    } catch {
      break; // Stop on first failure, retry later
    }
  }
}

window.addEventListener("online", () => syncOfflineChanges(db));
```

## Monorepo Structure

```
apps/
  web/              -- Next.js main app
  mobile/           -- React Native app
  admin/            -- Internal admin panel
  storybook/        -- Storybook host
packages/
  ui/               -- Shared component library
  config-eslint/    -- Shared ESLint config
  config-ts/        -- Shared tsconfig
  utils/            -- Shared utilities
  api-client/       -- Generated API client
  tokens/           -- Design tokens (colors, spacing, typography)
turbo.json          -- Turborepo pipeline config
pnpm-workspace.yaml -- Workspace definition
```

```jsonc
// turbo.json
{
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**"] },
    "dev": { "cache": false, "persistent": true },
    "lint": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["^build"] },
    "typecheck": { "dependsOn": ["^build"] }
  }
}
```

| Tool | Approach | Best for |
|------|----------|----------|
| **Turborepo** | Task runner, remote caching | Simplicity, incremental builds |
| **Nx** | Full monorepo platform | Large teams, dependency graph, generators |
| **pnpm workspaces** | Package manager level | Lightweight, no extra tooling |
| **Lerna** | Publishing-focused | Multi-package npm publishing |

## Server Components Architecture

```tsx
// Next.js 15 App Router: server by default
// app/products/page.tsx -- Server Component (no "use client")
import { Suspense } from "react";
import { ProductList } from "./ProductList";
import { ProductFilters } from "./ProductFilters";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string }> }) {
  const params = await searchParams;
  return (
    <div className="grid grid-cols-[250px_1fr]">
      {/* Client component for interactive filters */}
      <ProductFilters initialCategory={params.category} />
      {/* Server component streams data progressively */}
      <Suspense fallback={<ProductSkeleton count={12} />}>
        <ProductList query={params.q} category={params.category} />
      </Suspense>
    </div>
  );
}

// ProductList.tsx -- Server Component, async data fetching
async function ProductList({ query, category }: { query?: string; category?: string }) {
  const products = await db.product.findMany({
    where: { name: query ? { contains: query } : undefined, category },
    orderBy: { createdAt: "desc" },
  });
  return (
    <div className="grid grid-cols-3 gap-4">
      {products.map((p) => <ProductCard key={p.id} product={p} />)}
    </div>
  );
}
```

## Routing Patterns

| Pattern | Framework | Example |
|---------|-----------|---------|
| File-based | Next.js, SvelteKit, Nuxt | `app/products/[id]/page.tsx` |
| Type-safe | TanStack Router | Full TypeScript inference for params, search |
| Nested layouts | Next.js App Router | `layout.tsx` at each level, shared UI |
| Parallel routes | Next.js | `@modal/page.tsx`, `@sidebar/page.tsx` |
| Route groups | Next.js | `(auth)/login`, `(marketing)/about` |
| Catch-all | Next.js, SvelteKit | `[...slug]/page.tsx`, `[[...slug]]` optional |

## Architecture Decision by Project Complexity

| Scale | Architecture | Routing | State | Testing |
|-------|-------------|---------|-------|---------|
| **Prototype / MVP** | Single page, flat structure | React Router / file-based | useState + context | Manual + smoke tests |
| **Small app (1-3 devs)** | Feature folders | File-based (Next/SvelteKit) | Zustand + TanStack Query | Vitest + Playwright basics |
| **Medium app (3-8 devs)** | Feature-Sliced Design | TanStack Router or App Router | Zustand + TanStack Query | Full pyramid, Storybook |
| **Large app (8+ devs)** | FSD + micro frontends | Module Federation | Per-team choice, shared contracts | Contract tests, visual regression |
| **Enterprise (multiple teams)** | Micro frontends + monorepo | Independent deployments | Decoupled, event-based | Each team owns full stack |
