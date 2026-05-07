# Design Systems and UX Architecture

## Major Design Systems (2024-2025)

### Material 3 Expressive (Google)

The latest evolution of Material Design, announced 2025. Backed by 46 research studies with 18,000+ participants.

**Key Features:**
- **Spring-based motion:** Physics-based animations replace duration-based transitions. Elements respond organically to interaction, with configurable mass, damping, and stiffness parameters.
- **Pill-shaped containers:** Rounded, pill-shaped cards and buttons replace sharp-cornered rectangles. Research showed 4x faster element location when shapes encode function.
- **Large FABs:** Floating Action Buttons are significantly larger and more prominent, improving discoverability on mobile.
- **Color system:** Dynamic Color generates harmonious palettes from a source color. Tonal palettes (13 tones per color) provide flexibility for light/dark themes and accessibility.
- **Typography scale:** 15 type roles across 5 categories (Display, Headline, Title, Body, Label) with configurable font, size, weight, tracking.
- **Shape system:** 7 shape categories (None, Extra Small, Small, Medium, Large, Extra Large, Full) applied consistently across components.

**Research Results:**
- 4x faster element location with shape-encoded function
- Improved emotional engagement scores
- Higher task completion rates in onboarding flows
- Better accessibility outcomes with increased contrast and sizing

**Implementation:** Material Web (web components), Jetpack Compose (Android), Flutter, Material Components for iOS.

### Apple Liquid Glass (iOS 26+)

Apple's 2025 design language unifying all platforms under a translucent, depth-aware aesthetic.

**Key Characteristics:**
- **Translucent material:** UI elements are semi-transparent, revealing content behind them with gaussian blur and tinted overlays.
- **Light refraction:** Surfaces respond to light direction, creating subtle specular highlights that shift with device orientation and scrolling.
- **Adaptive shadows:** Dynamic shadows adjust based on content depth and ambient lighting, providing natural depth cues.
- **Specular highlights:** Light reflections on glass surfaces respond to gyroscope and scroll position.
- **visionOS integration:** Liquid Glass extends naturally to spatial computing contexts with physical-world light interaction.

**iOS 26 Unified Versioning:** Apple dropped separate version numbers for iPadOS, watchOS, tvOS, visionOS. All platforms now share a single version number aligned with iOS.

**Design Implications:**
- Content legibility must be ensured behind translucent layers (use vibrancy, increased contrast)
- Animations should feel physically grounded (spring animations, momentum-based scrolling)
- Depth hierarchy replaces flat design -- elements at different z-levels have distinct glass properties
- Dark mode requires careful tuning of glass opacity and blur radius

### IBM Carbon Design System

The most thoroughly documented enterprise design system.

**Strengths:**
- **Documentation:** Exhaustive guidelines for every component, pattern, and interaction
- **Accessibility-first:** Built to WCAG 2.1 AA from the ground up, with detailed a11y guidance per component
- **Data visualization:** Dedicated charting library (Carbon Charts) with accessible, responsive visualizations
- **Complex patterns:** Enterprise-grade patterns for data tables, tree views, pagination, filtering
- **AI patterns:** Carbon for AI provides guidelines for AI-powered interfaces (prompt engineering, confidence indicators, explanation patterns)

**Components:** 60+ components in React, Angular, Vue, Svelte, Web Components.
**Tokens:** 450+ design tokens for color, spacing, typography, motion.

### Atlassian Design System

Proven at enterprise scale across Jira, Confluence, Trello, Bitbucket.

**Key Features:**
- **Rich pattern library:** Patterns for project management, collaboration, editing, navigation
- **Pragmatic approach:** Prioritizes developer productivity with clear composition patterns
- **Editor patterns:** Rich text editing patterns (from Confluence/Jira editing experience)
- **Token-first:** Design tokens as the primary interface for theming

### Microsoft Fluent 2

Cross-platform design system for Windows, Web, iOS, Android.

**Key Features:**
- **Platform adaptive:** Components adapt behavior and appearance per platform while maintaining consistency
- **Compound components:** Complex components built from composable primitives
- **Accessibility:** Strong screen reader and keyboard navigation support
- **Web Components:** Framework-agnostic via @fluentui/web-components

### Shopify Polaris

E-commerce-focused design system.

**Key Features:**
- **i18n optimized:** Built for internationalization with RTL support, text expansion handling, and locale-aware formatting
- **Commerce patterns:** Cart, product listing, checkout, order management, merchant dashboard
- **App development:** Guidelines for building Shopify apps that feel native
- **Tokens:** Design tokens with light/dark mode and high-contrast themes

### Ant Design 5

Popular in the Chinese market and globally for admin/enterprise interfaces.

**Key Features:**
- **CSS-in-JS:** Emotion-based styling with theme customization via ConfigProvider
- **Component count:** 60+ components with comprehensive variants
- **Pro components:** ProTable, ProForm, ProLayout for rapid admin development
- **Design tokens:** Seed, Map, and Alias token layers for granular theming

### GitHub Primer

Developer-first design system.

**Key Features:**
- **Developer-centric:** Patterns for code display, diff views, issue tracking, PR workflows
- **Accessible by default:** High contrast, keyboard navigation, screen reader support
- **React + CSS:** Primer React components and Primer CSS utility classes
- **ViewComponents:** Ruby component library for server-rendered GitHub interfaces

---

## Design System Architecture

### Token Architecture

Design tokens are the atomic values that define a design system's visual language.

**Token Layers:**

| Layer | Purpose | Example |
|-------|---------|---------|
| **Global/Reference** | Raw values, color palette | `blue-500: #3b82f6` |
| **Semantic/Alias** | Intent-based mapping | `color-action-primary: {blue-500}` |
| **Component** | Component-specific overrides | `button-background: {color-action-primary}` |

**W3C Design Tokens Specification (Community Group Draft):**
- JSON format for design token interchange
- Supports color, dimension, duration, font family, font weight, number, and composite types
- Enables tool-agnostic token definitions (Figma, Sketch, code)

**Token Distribution:**
- CSS Custom Properties for web
- Tailwind config generation for utility-class systems
- Swift/Kotlin constants for native mobile
- JSON/YAML for cross-platform consumption

### Atomic Design Methodology

Brad Frost's compositional model for building design systems:

| Level | Definition | Example |
|-------|-----------|---------|
| **Atoms** | Smallest UI elements | Button, Input, Label, Icon |
| **Molecules** | Simple component groups | Search bar (input + button), Form field (label + input + error) |
| **Organisms** | Complex component sections | Navigation header, Product card grid, Comment thread |
| **Templates** | Page-level layouts | Dashboard layout, Article page layout |
| **Pages** | Template instances with real content | Homepage with live data |

### Component API Design Principles

- **Composition over configuration:** Prefer composable children over monolithic prop APIs
- **Sensible defaults:** Components work out of the box with zero configuration
- **Escape hatches:** Allow style and behavior overrides without forking
- **Accessibility built-in:** ARIA attributes, keyboard handling, and focus management by default
- **Polymorphism:** `as` or `asChild` prop for rendering as different HTML elements

---

## Design-to-Code Pipeline

### Figma to Code

**Figma Dev Mode:**
- Code snippets in CSS, Swift, Kotlin from selected elements
- Component property inspection (props, variants, states)
- Spacing and sizing as design token references
- Ready-for-dev annotations from designers

**Figma Plugins for Code Generation:**
- **Anima:** Figma to React/Vue/HTML with responsive layouts
- **Locofy:** AI-powered Figma to React/Next.js/Gatsby
- **Builder.io (Visual Copilot):** Figma to code with AI optimization

**Figma MCP Server:**
- AI coding agents read Figma files programmatically
- Extract design tokens, component specs, layout data
- Bridge between design decisions and code implementation

### Design Tokens to Code

| Source | Target | Method |
|--------|--------|--------|
| Figma Variables | CSS Custom Properties | Style Dictionary, Token Studio plugin |
| Figma Variables | Tailwind Config | Figma-to-Tailwind plugins, custom transforms |
| Token JSON (W3C) | Multi-platform | Style Dictionary with custom transforms |
| Penpot Tokens | CSS | Native export (SVG/CSS) |

### Component Library Mapping

Map design system components to code libraries:

| Design System | React | Web Components | Native Mobile |
|--------------|-------|----------------|---------------|
| Material 3 | MUI / Material Web | @material/web | Jetpack Compose / SwiftUI |
| Carbon | @carbon/react | @carbon/web-components | Carbon Native (limited) |
| Fluent 2 | @fluentui/react-components | @fluentui/web-components | FluentUI Native |
| Ant Design | antd | N/A | Ant Design Mobile |
| Primer | @primer/react | Primer CSS | N/A |

---

## DesignOps

### Version Control for Design

- **Figma branching:** Create branches from main files, merge with conflict resolution
- **Abstract:** Git-like version control for Sketch files (deprecated, use Figma)
- **Component versioning:** Semantic versioning for component libraries (breaking/non-breaking changes)

### Component Governance

| Phase | Activities |
|-------|-----------|
| **Proposal** | RFC document, use case justification, competitive analysis |
| **Design** | Figma component with all variants, states, and responsive behavior |
| **Review** | Accessibility audit, design review, engineering feasibility |
| **Build** | Code implementation matching design spec, unit tests, visual regression tests |
| **Document** | Usage guidelines, do/don't examples, accessibility notes |
| **Release** | Changelog, migration guide (if breaking), adoption tracking |

### Adoption Metrics

| Metric | What it measures | Target |
|--------|-----------------|--------|
| **Component coverage** | % of product UI using DS components | > 80% |
| **Design token usage** | % of styles using tokens vs. hardcoded values | > 90% |
| **Accessibility score** | Automated a11y test pass rate | 100% (A/AA) |
| **Contribution rate** | Components contributed by product teams | Growing quarter-over-quarter |
| **Deviation rate** | Custom overrides of DS components | < 10% |

### Deprecation Strategy

1. **Announce:** Mark component as deprecated in documentation and code (console warnings)
2. **Provide alternative:** Document migration path to replacement component
3. **Grace period:** 2-3 major versions or 6-12 months before removal
4. **Codemod:** Provide automated migration scripts where possible
5. **Remove:** Delete from library with final changelog entry
