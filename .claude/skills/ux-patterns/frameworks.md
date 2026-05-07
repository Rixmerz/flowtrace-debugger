# UX Tools and Frameworks

## Design Tools

### Figma (Market Leader)

**Revenue:** $749M in 2024. Dominant collaborative design platform.

**UI3 (2024 redesign):**
- Rebuilt interface with unified toolbar and contextual panels
- Slide-over panels replace tabbed side panels
- Full-screen, distraction-free mode for presentations

**AI Features (Figma AI):**
- **Generate:** Text-to-design for UI elements, icons, images within the canvas
- **Rewrite:** AI-powered content rewriting for UX copy iteration
- **Search:** Semantic search across files, components, and design systems
- **Asset generation:** Smart selection suggestions based on context

**Figma Sites:** Design-to-website publishing directly from Figma files. Responsive, SEO-ready, custom domains.

**Figma Make:** AI-powered app prototyping with functional interactions, data binding, and logic without code.

**Figma MCP Server:** Model Context Protocol integration enabling AI coding agents (Claude, Cursor) to read Figma files, extract design tokens, component specs, and layout data programmatically.

**Dev Mode:** Paid feature ($25/seat/mo or included in Organization plan). Code snippets (CSS, iOS, Android), component properties, spacing/sizing values, design token references.

**Pricing:**
| Plan | Cost | Key features |
|------|------|-------------|
| Starter | Free | 3 files, limited history |
| Professional | $15/editor/mo | Unlimited files, shared libraries |
| Organization | $45/editor/mo | SSO, branching, analytics, Dev Mode included |
| Enterprise | $75/editor/mo | Advanced security, dedicated support |

### Sketch 2025.3

macOS-native design tool. Key features in 2025:
- **Stacks:** Auto-layout with smart distribution and alignment
- **Frames:** Responsive container system with constraints
- **Design tokens:** Variable support for colors, spacing, typography
- **Collaboration:** Real-time via Sketch workspace (web-based)
- **Pricing:** $12/editor/mo (workspace), one-time $120 (Mac-only license)
- **Strength:** Native macOS performance, simpler learning curve
- **Limitation:** macOS only, smaller plugin ecosystem than Figma

### Framer

No-code web builder bridging design and production:
- **CMS:** Built-in content management for blogs, portfolios, product pages
- **AI Wireframer:** Text-to-wireframe generation for rapid ideation
- **AI Pages:** Generate full page layouts from prompts
- **Plugins:** Extensible with community and first-party integrations
- **Animations:** Scroll-based, hover, page transitions with visual timeline
- **SEO:** Built-in meta tags, sitemap, robots.txt, structured data
- **Pricing:** Free (2 pages), Mini $5/mo, Basic $15/mo, Pro $30/mo
- **Best for:** Marketing sites, portfolios, landing pages

### Penpot 2.0

Open-source design platform (MPL 2.0):
- **CSS Grid:** Native grid layout system (unique among design tools)
- **Design Tokens:** First-class token support for spacing, color, typography
- **Components:** Multi-level components with variants and overrides
- **Self-hosted:** Run on your own infrastructure for data sovereignty
- **SVG-native:** All designs stored as SVG, ensuring portability
- **Flex Layout:** Auto-layout equivalent with gap, padding, alignment
- **Pricing:** Free (cloud and self-hosted), paid support plans for enterprise
- **Best for:** Teams needing open-source, self-hosted, or vendor-independent tooling

---

## Research Tools

### Maze

End-to-end product research platform:
- **Usability testing:** Task-based testing with heatmaps and click tracking
- **Surveys:** In-product and standalone surveys with conditional logic
- **Card sorting:** Open and closed card sorting with dendrograms
- **AI analysis:** Automated insight extraction from qualitative responses
- **Prototype testing:** Direct integration with Figma, Sketch, InVision, Adobe XD
- **Reach:** Recruitment panel with 290M+ participants across 130 countries
- **Pricing:** Free (3 studies/mo), $99/mo (Growth), custom (Enterprise)

### Dovetail

Qualitative research and insights hub:
- **AI Agents:** Automated tagging, theme detection, and pattern recognition
- **Video analysis:** Transcription and highlight reels from user interviews
- **Repository:** Centralized insight storage with search and taxonomy
- **Integrations:** Slack, Jira, Confluence, Notion for insight distribution
- **Best for:** Teams doing regular qualitative research at scale

### Hotjar (now Contentsquare)

Behavioral analytics for websites and apps:
- **Heatmaps:** Click, scroll, move heatmaps for page interaction analysis
- **Session recordings:** Full playback of user sessions with event filtering
- **Surveys:** On-page feedback collection with targeting rules
- **Funnels:** Conversion funnel analysis with drop-off identification
- **Contentsquare merger:** Combined with enterprise-grade analytics (zone-based heatmaps, journey analysis, frustration scoring)
- **Pricing:** Free (35 sessions/day), Plus $32/mo, Business $80/mo

---

## Accessibility Tools

### axe by Deque

Industry-standard accessibility testing engine:
- **Downloads:** 3B+ total, most widely used accessibility testing library
- **Zero false positives:** Rules engine designed to eliminate false positive results
- **axe-core:** Open-source JavaScript library for automated WCAG testing
- **axe DevTools:** Browser extension with guided manual testing
- **axe MCP Server:** AI agent integration for accessibility testing via Model Context Protocol
- **axe Monitor:** Continuous site-wide scanning with dashboards and trend tracking
- **WCAG coverage:** Tests against WCAG 2.0, 2.1, and 2.2 (A, AA, AAA criteria)
- **Integrations:** Jest, Cypress, Playwright, Storybook, CI/CD pipelines

### WAVE 3.3

Web accessibility evaluation tool by WebAIM:
- **AIM Score:** Quantitative accessibility score for benchmarking and tracking
- **Browser extension:** Chrome and Firefox, free for individual use
- **API:** Automated testing for CI/CD integration
- **Visual feedback:** Inline annotations showing errors, alerts, features, and structure
- **Best for:** Quick manual audits and developer education

### Stark

Accessibility tools integrated into design workflows:
- **Figma plugin:** 390K+ installs, contrast checking, vision simulation, alt text
- **Sketch plugin:** Equivalent feature set for Sketch users
- **Contrast checker:** Real-time WCAG AA/AAA contrast ratio validation
- **Vision simulation:** Simulate color blindness, low vision, and cataracts
- **Focus order:** Visualize and verify tab order in designs
- **Pricing:** Free (basic), Pro $50/mo, Business custom

---

## AI-Powered Design Tools

### Google Stitch (formerly Galileo AI)

- **Text-to-UI:** Generate high-fidelity UI designs from natural language prompts
- **Powered by:** Gemini 2.5 multimodal model
- **Output:** Editable designs with real components, not static images
- **Integration:** Export to Figma, code generation planned
- **Status:** Limited access / beta as of 2025

### Uizard

- **Autodesigner 2.0:** Multi-screen app design from text descriptions
- **Users:** 3.2M+ registered users
- **Screenshot-to-design:** Upload a screenshot, get an editable design
- **Sketch-to-design:** Hand-drawn wireframe to digital conversion
- **Pricing:** Free (3 projects), Pro $12/mo, Business $39/mo

### Relume

- **Sitemaps:** AI-generated sitemaps from project briefs
- **Wireframes:** AI-generated wireframes based on sitemap structure
- **Component library:** 700+ pre-built, customizable Webflow components
- **Figma plugin:** Generate wireframes directly in Figma
- **Best for:** Rapid website planning and wireframing

### v0 by Vercel

- **Code generation:** React/Next.js/Tailwind code from prompts or screenshots
- **Context window:** 512K tokens for complex multi-file generation
- **Iteration:** Conversational refinement of generated code
- **Deployment:** Direct deploy to Vercel from generated output
- **Best for:** Developer-designers needing production-ready code quickly

---

## Prototyping Tools

| Tool | Best for | Key feature |
|------|----------|-------------|
| **ProtoPie** | Complex interactions, sensor-based | Multi-device prototyping, hardware triggers |
| **Principle** | macOS animation prototyping | Timeline-based animation, auto keyframes |
| **Origami Studio** | Meta/Facebook design patterns | Patch-based logic, device preview |
| **Play** | Mobile-first prototyping | SwiftUI-native, real device testing |

---

## Handoff and Collaboration

| Tool | Best for | Key feature |
|------|----------|-------------|
| **Figma Dev Mode** | Figma-centric teams | Code snippets, component specs, tokens |
| **Zeplin** | Multi-tool teams | Figma/Sketch/XD support, style guides |
| **Storybook** | Component documentation | Interactive component catalog, visual testing |
| **Supernova** | Design system documentation | Token management, auto-generated docs |

---

## Analytics Platforms

| Tool | Best for | Key feature |
|------|----------|-------------|
| **Amplitude** | Product analytics | Behavioral cohorts, experimentation |
| **Mixpanel** | Event-based analytics | Funnel analysis, retention tracking |
| **FullStory** | Session replay + analytics | DX data capture, frustration signals |
| **LogRocket** | Frontend error + session replay | Error tracking with session context |
| **PostHog** | Open-source product analytics | Feature flags, A/B testing, session replay |
| **Heap** | Auto-capture analytics | Retroactive event definition, no tagging needed |
