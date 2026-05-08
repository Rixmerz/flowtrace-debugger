# UI Frameworks and Libraries

## UI Frameworks

| Framework | Version | Key Features | Best For |
|-----------|---------|-------------|----------|
| **React** | 19 | Server Components, Actions, `use()`, compiler auto-memoization | Complex SPAs, ecosystem depth |
| **Next.js** | 15 | App Router, Server Actions, PPR, Turbopack (stable) | Full-stack React, SSR/SSG |
| **Vue** | 3.5 | Composition API, Vapor mode (experimental), Reactive Props Destructure | Progressive adoption |
| **Nuxt** | 3.14 | Auto-imports, server routes, hybrid rendering | Full-stack Vue |
| **Svelte** | 5 | Runes (`$state`, `$derived`, `$effect`), compiled, no VDOM | Performance-critical, small bundles |
| **SvelteKit** | 2 | File-based routing, SSR/SSG/ISR, form actions | Full-stack Svelte |
| **Angular** | 19 | Signals, standalone components, zoneless, incremental hydration | Enterprise, large teams |
| **Solid.js** | 2.0 | Fine-grained reactivity, no VDOM, JSX, Solid Start | Signals-first architecture |
| **Astro** | 5 | Islands, Content Collections, Server Islands, any-framework | Content sites, blogs, docs |
| **Qwik** | 2 | Resumability, lazy loading by default, Qwik City | Instant-load apps |

## CSS and Styling

| Tool | Type | Notes |
|------|------|-------|
| **Tailwind CSS 4** | Utility-first | New Oxide engine (Rust), CSS-first config, `@theme`, container queries support |
| **CSS Modules** | Scoped CSS | Zero runtime, framework-agnostic, Vite/webpack native support |
| **vanilla-extract** | CSS-in-TS | Zero runtime, type-safe tokens, Sprinkles for atomic CSS |
| **Panda CSS** | CSS-in-JS (zero-runtime) | Type-safe, token-based, generates atomic CSS at build time |
| **StyleX** | CSS-in-JS (Meta) | Compile-time, atomic output, used in Facebook/Instagram |
| **UnoCSS** | Atomic CSS engine | Preset-based, compatible with Tailwind/Windi syntax, instant HMR |
| **Lightning CSS** | CSS transformer | Rust-based, bundling, minification, nesting, vendor prefixes |
| **Open Props** | CSS custom properties | Pre-built design tokens, no build step, progressive enhancement |

## Component Libraries

| Library | Framework | Philosophy |
|---------|-----------|-----------|
| **shadcn/ui** | React | Copy-paste components over Radix + Tailwind. Full ownership, no dependency lock-in |
| **Radix Primitives** | React | Unstyled, accessible primitives. Foundation for shadcn/ui |
| **Headless UI** | React, Vue | Unstyled components from Tailwind Labs. Disclosure, Dialog, Menu |
| **Ark UI** | React, Vue, Solid | Universal headless components built on Zag.js state machines |
| **Mantine 7** | React | Full-featured, 100+ components, hooks library, dark mode |
| **NextUI** | React | Beautiful defaults, built on React Aria + Tailwind |
| **DaisyUI** | Any (Tailwind plugin) | Semantic class names on top of Tailwind, themeable |
| **Radix Themes** | React | Styled Radix components with design system built in |
| **Park UI** | React, Vue, Solid | Beautifully designed components built on Ark UI |
| **Bits UI** | Svelte | Headless component primitives for Svelte 5 |

## State Management

| Library | Paradigm | Framework | Notes |
|---------|----------|-----------|-------|
| **Zustand 5** | Flux-like store | React | Minimal API, no providers, middleware support, slices pattern |
| **Jotai 2** | Atomic | React | Bottom-up atoms, derived state, async atoms, DevTools |
| **TanStack Query 5** | Server state | React, Vue, Solid, Svelte, Angular | Caching, background refetch, optimistic updates, infinite queries |
| **Pinia 3** | Store | Vue | Official Vue store. Composition API, type-safe, DevTools |
| **Signals** | Reactive primitive | Angular, Solid, Preact | Fine-grained reactivity, no diffing, framework-native |
| **XState 5** | State machines | Any | Finite state machines, statecharts, visual editor |
| **Valtio 2** | Proxy-based | React | Mutable API, proxy snapshots, derive |
| **Legend State** | Observable | React | Fast, fine-grained, persistence built-in, sync engine |
| **Nanostores** | Atomic | Any | Framework-agnostic, tiny (< 1KB), good for shared logic |
| **SWR 2** | Server state | React | Stale-while-revalidate, lighter alternative to TanStack Query |

## Build Tools

| Tool | Type | Notes |
|------|------|-------|
| **Vite 6** | Dev server + bundler | Rollup-based production, instant HMR, Environment API |
| **Turbopack** | Bundler | Rust-based, Next.js default dev bundler, incremental |
| **Biome** | Linter + formatter | Rust-based, replaces ESLint + Prettier, fast, opinionated |
| **Rspack** | Bundler | Rust-based webpack-compatible, drop-in replacement |
| **Farm** | Bundler | Rust-based, Vite-compatible, partial bundling strategy |
| **oxc** | Parser + linter + transformer | Rust-based, 50-100x faster than babel/eslint |
| **tsup** | Library bundler | Powered by esbuild, simple config for library authors |
| **Bun** | Runtime + bundler + PM | All-in-one, fast installs, native TypeScript |

## Testing

| Tool | Type | Notes |
|------|------|-------|
| **Vitest 3** | Unit / integration | Vite-native, Jest-compatible API, browser mode, type testing |
| **Testing Library** | Component testing | User-centric queries, React/Vue/Svelte/Angular variants |
| **Playwright 1.x** | E2E / browser | Multi-browser, auto-wait, codegen, component testing |
| **Storybook 8** | Component dev | Interaction testing, visual regression, framework-agnostic |
| **Chromatic** | Visual regression | Storybook-based, cloud CI, snapshot comparison |
| **MSW 2** | API mocking | Service Worker-based, intercepts fetch/XHR, type-safe handlers |
| **Cypress 13** | E2E | Real browser, time-travel debugging, component testing |

## Animation

| Library | Type | Notes |
|---------|------|-------|
| **Framer Motion 12** | Declarative | React. Layout animations, gestures, scroll-triggered, exit animations |
| **Motion One** | Web Animations API | Framework-agnostic, small bundle, hardware-accelerated |
| **GSAP 3** | Timeline-based | Professional-grade, ScrollTrigger, complex sequences |
| **AutoAnimate** | Drop-in | One function call adds transitions to list changes |
| **View Transitions API** | Browser native | Cross-document and SPA transitions, no library needed |
| **CSS scroll-driven** | Browser native | `animation-timeline: scroll()` / `view()`, no JS |
| **Rive** | Interactive graphics | Vector animations, state machines, runtime control |

## Forms and Validation

| Library | Framework | Notes |
|---------|-----------|-------|
| **React Hook Form 7** | React | Uncontrolled by default, minimal re-renders, resolver pattern |
| **Zod** | Any | Schema validation, TypeScript inference, form adapter ecosystem |
| **Formik** | React | Controlled forms, widely adopted, heavier than RHF |
| **VeeValidate** | Vue | Composition API, Zod/Yup integration, field-level validation |
| **Superforms** | SvelteKit | Server-side validation, progressive enhancement, Zod schemas |
| **Conform** | React (RSC) | Server Actions compatible, progressive enhancement |
| **TanStack Form** | React, Vue, Solid | Type-safe, headless, framework-agnostic core |

## Data Fetching and API

| Library | Type | Notes |
|---------|------|-------|
| **TanStack Query 5** | Async state | Caching, deduplication, background refetch, infinite scroll |
| **tRPC 11** | Type-safe RPC | End-to-end type safety, no codegen, React/Next.js integration |
| **Apollo Client 3** | GraphQL | Normalized cache, subscriptions, local state management |
| **urql** | GraphQL | Lightweight alternative to Apollo, extensible exchanges |
| **Ky** | HTTP client | Tiny fetch wrapper, retry, hooks, JSON by default |
| **openapi-typescript** | Codegen | Generate TypeScript types from OpenAPI schemas |
| **Orval** | Codegen | Generate API clients from OpenAPI, TanStack Query integration |
