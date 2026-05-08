---
name: ux-patterns
description: "UX design reference - research methods, design systems, accessibility (WCAG 2.2, EAA), UX laws, AI-driven workflows, tools (Figma, Penpot), and production best practices for 2024-2025. Use when making UX decisions, reviewing designs, implementing accessibility, selecting design tools, or applying UX principles."
user-invocable: true
argument-hint: "[frameworks|patterns|research|tools|practices|all]"
---

# UX Design Patterns and Practices

## When to use this skill
- Making UX research method or tool selection decisions
- Reviewing designs for accessibility compliance (WCAG 2.2, EAA)
- Selecting or evaluating design systems (Material 3, Apple HIG, Carbon, Polaris)
- Choosing design tools (Figma, Sketch, Penpot, Framer)
- Applying UX laws and cognitive principles to interface decisions
- Implementing AI-driven design workflows
- Evaluating UX career paths, certifications, or salary benchmarks

## UX Research Method Decision Table

| Scenario | Default method | Why |
|----------|---------------|-----|
| Validate a prototype before development | **Usability testing (5 users)** | Finds ~85% of usability issues with minimal cost |
| Understand information architecture | **Card sorting (open)** | Reveals users' mental models for content grouping |
| Measure satisfaction at scale | **Survey (SUS/UMUX-Lite)** | Quantitative data from large sample, benchmarkable |
| Compare two design variants | **A/B testing** | Statistical evidence for conversion/engagement differences |
| Audit an existing interface | **Heuristic evaluation** | Fast, expert-driven, catches obvious violations early |
| Understand long-term behavior | **Diary study (7-14 days)** | Captures real context, habits, and pain points over time |
| Identify drop-off points | **Analytics + session recordings** | Data-driven insights on where users struggle or abandon |
| Validate navigation structure | **Tree testing** | Tests findability without visual design influence |
| Understand user context deeply | **Contextual inquiry** | In-situ observation reveals tacit knowledge and workarounds |

## Design System Selection Guide

| Context | Recommended system | Why |
|---------|-------------------|-----|
| Android / cross-platform apps | **Material 3 Expressive** | Google-backed, 4x faster element location, extensive components |
| iOS / Apple ecosystem | **Apple HIG (Liquid Glass)** | Platform-native feel, iOS 26 unified versioning |
| Enterprise / data-heavy apps | **IBM Carbon** | Best documentation, accessibility-first, complex data patterns |
| E-commerce / Shopify ecosystem | **Shopify Polaris** | i18n optimized, commerce-specific patterns |
| Developer tools | **GitHub Primer** | Developer-first, code-oriented components |
| Large-scale SaaS | **Atlassian Design System** | Proven at scale, rich pattern library |
| Chinese market / Ant ecosystem | **Ant Design 5** | CSS-in-JS, extensive component set, large community |
| Microsoft ecosystem | **Fluent 2** | Cross-platform (Windows, Web, iOS, Android) |
| Brand differentiation required | **Custom system** | When existing systems conflict with brand identity |

## Design Tool Selection Matrix

| Criteria | Figma | Sketch | Penpot | Framer |
|----------|-------|--------|--------|--------|
| Best for | Team collaboration, full workflow | macOS-focused design | Open-source, self-hosted | No-code production sites |
| Platform | Web + Desktop (all OS) | macOS only | Web + self-hosted | Web |
| AI features | Generate, Rewrite, Search | Limited | None (planned) | AI Wireframer, AI Pages |
| Prototyping | Advanced (variables, conditions) | Basic + third-party | Basic interactions | Full site with CMS |
| Dev handoff | Dev Mode (paid) | Inspector (free) | Inspect mode (free) | Code export |
| Pricing (team) | $15/editor/mo | $12/editor/mo | Free (self-hosted) | $15/seat/mo |
| Open source | No | No | Yes (MPL 2.0) | No |
| Design tokens | Variables (native) | Via plugins | Native support | Limited |
| Key advantage | Market leader, $749M rev 2024 | Native macOS performance | No vendor lock-in | Design-to-production |

## Core Web Vitals Targets (2024-2025)

| Metric | Good | Needs Improvement | Poor |
|--------|------|-------------------|------|
| **LCP** (Largest Contentful Paint) | < 2.5s | 2.5s - 4.0s | > 4.0s |
| **INP** (Interaction to Next Paint) | < 200ms | 200ms - 500ms | > 500ms |
| **CLS** (Cumulative Layout Shift) | < 0.1 | 0.1 - 0.25 | > 0.25 |

## Supporting files
- `frameworks.md` -- UX tools and frameworks (design, research, accessibility, AI)
- `design-patterns.md` -- UX design patterns and 30 Laws of UX
- `architecture.md` -- Design systems and UX architecture
- `best-practices.md` -- Research methods, accessibility compliance, performance UX, ethical design
- `language-features.md` -- UX industry landscape, trends, salaries, certifications

## Related Skills
- [ui-patterns](../ui-patterns/SKILL.md) — Frontend architecture and component patterns
- [dev-patterns](../dev-patterns/SKILL.md) — Language-agnostic design principles
