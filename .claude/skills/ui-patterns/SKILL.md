---
name: ui-patterns
description: "UI/Frontend architecture reference - React 19, Next.js 15, Vue 3, Svelte 5, Angular 19, CSS modern features, component libraries, state management, and production best practices for 2024-2025. Use when building frontend UIs, selecting frameworks, reviewing component code, or making frontend architecture decisions."
user-invocable: true
argument-hint: "[frameworks|patterns|architecture|practices|features|all]"
---

# UI/Frontend Architecture Patterns

## When to use this skill
- Making frontend framework or library selection decisions
- Reviewing component architecture and UI code quality
- Selecting state management, styling, or build tool strategies
- Understanding modern rendering patterns (SSR, SSG, RSC, Islands)
- Building accessible, performant, production-grade user interfaces

## Framework Decision Table

| Scenario | Default choice | Why |
|----------|---------------|-----|
| Complex SPA with rich interactions | **React 19** | Largest ecosystem, Server Components, mature tooling |
| SEO-critical app with dynamic data | **Next.js 15** | SSR/SSG/ISR, App Router, Server Actions |
| Progressive adoption in existing app | **Vue 3** | Gentle learning curve, Composition API, incremental |
| Performance-critical with small bundle | **Svelte 5** | Compiled output, no virtual DOM, Runes reactivity |
| Enterprise with large teams | **Angular 19** | Opinionated structure, Signals, strong typing, DI built-in |
| Content-heavy / marketing site | **Astro 5** | Islands architecture, zero JS by default, any framework |
| Signals-first reactive model | **Solid.js 2** | Fine-grained reactivity, no virtual DOM, React-like JSX |
| Resumable, instant-load apps | **Qwik 2** | Resumability instead of hydration, lazy execution |

## Rendering Strategy Guide

| Strategy | When to use | Trade-offs |
|----------|------------|------------|
| **CSR** (Client-Side Rendering) | Internal tools, dashboards, auth-gated apps | Fast navigation, poor SEO, blank initial load |
| **SSR** (Server-Side Rendering) | Dynamic content needing SEO, personalized pages | Fresh data, higher server cost, TTFB matters |
| **SSG** (Static Site Generation) | Blogs, docs, marketing pages | Fastest TTFB, stale until rebuild |
| **ISR** (Incremental Static Regen) | E-commerce catalogs, large content sites | SSG speed + periodic freshness |
| **Streaming SSR** | Complex pages with mixed data speeds | Progressive rendering, reduced TTFB |
| **Islands** | Content sites with isolated interactivity | Minimal JS, partial hydration |
| **RSC** (React Server Components) | Next.js apps, data-heavy pages | Zero client bundle for server parts, composable |

## State Management Decision

| Complexity | Approach | Tools |
|------------|----------|-------|
| Component-local | useState / useReducer / $state | Built-in framework primitives |
| Shared across siblings | Lift state + context | React Context, Vue provide/inject |
| Global client state | Lightweight store | Zustand, Jotai, Pinia, Signals |
| Server/async state | Data fetching library | TanStack Query, SWR, Apollo Client |
| Complex workflows | State machines | XState, Robot |
| Form state | Form library | React Hook Form, VeeValidate, Superforms |
| URL state | Router params | nuqs, next-usequerystate, TanStack Router |

## Production Results

| Company | Stack | Outcome |
|---------|-------|---------|
| Vercel (Next.js 15) | RSC + Streaming SSR | 50% reduction in client JS, improved LCP |
| Shopify Hydrogen | Remix/React | Sub-second page loads for e-commerce |
| IKEA | Svelte + SvelteKit | 50% less code than React equivalent, faster TTI |
| Adobe Spectrum | React + Web Components | Cross-framework design system serving all Adobe apps |
| Discord | React 18 + Rust (WASM) | Reduced message rendering from 50ms to 2ms |
| The Guardian | Islands (Astro-like) | 80% less JavaScript shipped to readers |

## Core Web Vitals Targets (2024-2025)

| Metric | Good | Needs Improvement | Poor |
|--------|------|-------------------|------|
| **LCP** (Largest Contentful Paint) | < 2.5s | 2.5s - 4.0s | > 4.0s |
| **INP** (Interaction to Next Paint) | < 200ms | 200ms - 500ms | > 500ms |
| **CLS** (Cumulative Layout Shift) | < 0.1 | 0.1 - 0.25 | > 0.25 |

## Supporting files
- `frameworks.md` -- Frameworks, libraries, and tools by domain
- `design-patterns.md` -- UI component and state patterns with code examples
- `architecture.md` -- Frontend architecture patterns (FSD, Micro Frontends, Islands)
- `best-practices.md` -- Performance, accessibility, security, TypeScript for UI
- `language-features.md` -- Modern Web Platform features (View Transitions, Container Queries, etc.)

## Related Skills
- [ux-patterns](../ux-patterns/SKILL.md) — UX research, design systems, accessibility
- [ts-patterns](../ts-patterns/SKILL.md) — TypeScript type system and tooling
- [css-theming](../css-theming/SKILL.md) — CSS custom properties and theming
