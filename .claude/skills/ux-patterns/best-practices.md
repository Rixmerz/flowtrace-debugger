# UX Best Practices

## Research Methods

### When to Use Each Method

| Method | Best for | Sample size | Timeline | Output |
|--------|----------|-------------|----------|--------|
| **Usability testing** | Validating prototypes, finding interaction issues | 5 users per round (85% of issues) | 1-2 weeks | Task success rate, error count, time-on-task |
| **Surveys (SUS/UMUX-Lite)** | Measuring satisfaction at scale, benchmarking | 40+ responses (statistical significance) | 3-7 days | Quantitative scores, NPS, CSAT |
| **Card sorting (open)** | Discovering user mental models for IA | 15-20 participants | 1-2 weeks | Dendrograms, similarity matrices |
| **Card sorting (closed)** | Validating proposed IA structure | 30+ participants | 1 week | Agreement matrices, category confidence |
| **Tree testing** | Validating navigation findability | 50+ participants | 1 week | Findability rates, path analysis |
| **A/B testing** | Comparing design variants with real users | 1,000+ per variant (depends on effect size) | 2-4 weeks | Conversion rates, statistical significance |
| **Diary study** | Understanding long-term behavior and habits | 10-15 participants | 1-4 weeks | Behavioral patterns, context insights |
| **Contextual inquiry** | Understanding real-world usage context | 5-8 participants | 2-3 weeks | Workflow maps, pain points, workarounds |
| **Heuristic evaluation** | Quick expert audit of existing interfaces | 3-5 evaluators | 2-5 days | Severity-ranked issue list |
| **Competitive analysis** | Understanding market landscape and conventions | 5-10 competitors | 1-2 weeks | Feature matrices, pattern inventory |

### Remote vs In-Person Trade-offs

| Factor | Remote | In-Person |
|--------|--------|-----------|
| **Participant pool** | Global, larger, more diverse | Local, smaller, less diverse |
| **Cost** | Lower (no travel, no facility) | Higher (travel, lab rental, incentives) |
| **Context** | Natural environment (home/office) | Controlled but artificial |
| **Observation quality** | Limited (screen + webcam) | Full (body language, environment) |
| **Moderation** | Harder to build rapport | Easier to probe and redirect |
| **Accessibility** | Better for participants with mobility constraints | May exclude some participants |
| **Best for** | Surveys, unmoderated testing, card sorting | Complex prototypes, physical products, contextual inquiry |

### Key Research Principles

- Run usability tests early and often -- testing a rough prototype beats testing nothing
- 5 users find ~85% of usability problems (Nielsen Norman Group)
- Triangulate: combine qualitative (why) with quantitative (what/how much)
- Separate generative research (what to build) from evaluative research (did we build it right)
- Document insights in a central repository (Dovetail, Notion, Confluence) so they compound over time

---

## Accessibility Compliance

### WCAG 2.2 AA -- New Criteria (December 2023)

WCAG 2.2 added 9 new success criteria. Criterion 4.1.1 (Parsing) was removed as browsers now handle malformed HTML gracefully.

**2.4.11 Focus Not Obscured (Minimum) -- AA**
When an element receives keyboard focus, it must not be entirely hidden by other content (sticky headers, floating toolbars, cookie banners).
- Implementation: Ensure `scroll-padding-top` accounts for sticky element height. Use `scroll-margin` on focusable elements. Test by tabbing through the page with sticky elements present.

**2.4.12 Focus Not Obscured (Enhanced) -- AAA**
No part of the focused element may be hidden by author-created content.

**2.4.13 Focus Appearance -- AAA**
Focus indicator must have sufficient size (at least 2px perimeter) and contrast (3:1 against unfocused state).

**2.5.7 Dragging Movements -- AA**
Any functionality that uses dragging must provide a single-pointer alternative (click/tap).
- Implementation: Drag-to-reorder lists must also have "move up"/"move down" buttons. Slider controls must accept click-to-set or direct value input.

**2.5.8 Target Size (Minimum) -- AA**
Interactive targets must be at least 24x24 CSS pixels, unless they are inline text links, user-agent controlled, or the target is available elsewhere on the page.
- Implementation: Audit all buttons, links, form controls, and custom interactive elements. Use padding to increase target size without changing visual appearance.

**3.2.6 Consistent Help -- A**
If help mechanisms (contact info, chat, FAQ links) are present on multiple pages, they must appear in the same relative location on each page.
- Implementation: Place help elements in a consistent position (e.g., always in footer, always in header). Use a consistent component across all pages.

**3.3.7 Redundant Entry -- A**
Information previously entered by or provided to the user that is required on a subsequent step must be auto-populated or available for selection.
- Implementation: Pre-fill shipping address from billing address. Remember previously entered data across form steps. Don't ask for the same information twice.

**3.3.8 Accessible Authentication (Minimum) -- AA**
Authentication must not require cognitive function tests (memorizing a password, solving a puzzle) unless an alternative method is available or the test is recognizing objects/personal content.
- Implementation: Support password managers (don't block paste in password fields). Provide WebAuthn/passkey authentication. If using CAPTCHA, offer an audio or object-recognition alternative.

**3.3.9 Accessible Authentication (Enhanced) -- AAA**
No cognitive function test for authentication at all, not even object recognition.

### European Accessibility Act (EAA)

**Enforcement date:** June 28, 2025.

**Scope:** E-commerce, banking/financial services, telecom, transport (ticketing, check-in), e-books/readers, computers and operating systems.

**Who must comply:** Any company selling products or services in the EU market, regardless of where they are headquartered. Micro-enterprises (< 10 employees, < 2M EUR turnover) are exempt.

**Fines by country:**
| Country | Maximum penalty |
|---------|----------------|
| Germany | Up to 500,000 EUR |
| France | 4% of annual revenue |
| Ireland | Up to 18 months imprisonment |
| Spain | Up to 1,000,000 EUR |
| Netherlands | Administrative fines + product withdrawal |

**Technical standard:** EN 301 549 (currently maps to WCAG 2.1 AA, expected update to WCAG 2.2 AA).

### Accessibility Testing Workflow

**Three-layer approach:**

1. **Automated testing (axe-core):** Catches ~30-40% of WCAG issues. Run in CI/CD pipeline. Zero false positives guarantee. Integrate via jest-axe, cypress-axe, or @axe-core/playwright.

2. **Semi-automated testing (WAVE):** Identifies issues requiring human judgment (alt text quality, reading order, color contrast in complex backgrounds). Run during code review.

3. **Manual testing with assistive technology:**
   - Screen reader: NVDA (Windows, free), VoiceOver (macOS/iOS, built-in), TalkBack (Android, built-in)
   - Keyboard-only: Tab through entire flow, verify focus order and visible focus
   - Magnification: 200% zoom, verify no content loss or horizontal scrolling
   - Reduced motion: Enable `prefers-reduced-motion` and verify animations are suppressed

---

## Performance UX

### Perceived Performance

Users' perception of speed matters more than actual speed. Techniques to improve perceived performance:

**Skeleton screens:** Show the page structure with placeholder shapes before content loads. More effective than spinners because they set expectations for what will appear.

**Optimistic UI:** Update the interface immediately as if the action succeeded, then reconcile with the server response. Use for low-risk actions (likes, bookmarks, form submissions where validation is client-side).

**Progress indicators:** For operations > 1 second, show a progress bar or percentage. For operations > 10 seconds, show elapsed time and estimated remaining time. For operations of unknown duration, use an indeterminate progress bar with status text.

**Instant navigation:** Prefetch likely next pages on hover (within 100-300ms). Use `<link rel="prefetch">` for probable navigation targets. Prerender full pages for highly likely destinations.

### Core Web Vitals Implementation

**LCP < 2.5s (Largest Contentful Paint):**
- Preload the LCP image with `<link rel="preload" as="image">`
- Use responsive images with `srcset` and `sizes`
- Avoid lazy loading above-the-fold images
- Inline critical CSS, defer non-critical stylesheets
- Use CDN for static assets with edge caching

**INP < 200ms (Interaction to Next Paint):**
- Break long tasks into smaller chunks with `requestIdleCallback` or `scheduler.yield()`
- Debounce/throttle input handlers
- Avoid layout thrashing (batch DOM reads and writes)
- Use CSS `content-visibility: auto` for off-screen content
- Move heavy computation to Web Workers

**CLS < 0.1 (Cumulative Layout Shift):**
- Set explicit `width`/`height` or `aspect-ratio` on images and videos
- Reserve space for dynamic content (ads, embeds, lazy-loaded components)
- Use `transform` animations instead of layout-triggering properties
- Avoid inserting content above existing content after page load
- Use `font-display: optional` or `font-display: swap` with size-adjust

### Loading Patterns

| Pattern | When to use | UX impact |
|---------|------------|-----------|
| **Progressive disclosure** | Complex interfaces with many options | Reduces initial cognitive load |
| **Lazy loading** | Below-fold images, secondary content | Faster initial load, saves bandwidth |
| **Infinite scroll** | Social feeds, content discovery | Engagement, but provide navigation landmarks |
| **Pagination** | Search results, data tables | Predictable, bookmarkable, accessible |
| **Skeleton screens** | Content-heavy pages during load | Sets expectations, reduces perceived wait |
| **Stale-while-revalidate** | Frequently updated data | Instant display with background refresh |

---

## Content Design

### UX Writing Principles

- **Clear over clever:** "Delete this file?" not "Hasta la vista, file!"
- **Concise:** Use the fewest words that convey the meaning. "Save" not "Save your changes to the document."
- **Useful:** Every word must serve the user's goal. Remove filler and corporate jargon.
- **Consistent:** Same action = same label everywhere. Don't alternate between "Remove," "Delete," and "Trash."
- **Conversational:** Write as you would speak to a colleague -- professional but human.

### Microcopy Patterns

**Error messages:** State what happened + why + how to fix it.
- Bad: "Error 422"
- Good: "That email is already registered. Try signing in instead, or use a different email."

**Empty states:** Explain what belongs here + how to get started.
- Bad: "No data"
- Good: "No projects yet. Create your first project to get started."

**Confirmation dialogs:** State the action + consequence + make the primary button match the action verb.
- Bad: "Are you sure?" [OK] [Cancel]
- Good: "Delete 3 files? This can't be undone." [Delete files] [Keep files]

**Loading states:** Set expectations for what's happening and how long it will take.
- Bad: spinning wheel with no text
- Good: "Loading your dashboard... This usually takes a few seconds."

---

## AI-Driven UX Workflows

### Current Adoption (2024-2025)

| AI use case | Adoption rate | Tools |
|-------------|---------------|-------|
| Asset generation (icons, images, illustrations) | 33% of designers | Midjourney, DALL-E 3, Figma AI Generate |
| Draft interface generation | 22% of designers | v0, Google Stitch, Uizard, Figma Make |
| Layout exploration | 21% of designers | Relume, Framer AI, Figma AI |
| Research analysis | 18% of designers | Dovetail AI, Maze AI, manual LLM |
| UX copy iteration | 15% of designers | ChatGPT, Claude, Figma AI Rewrite |
| Design system documentation | 12% of designers | Supernova, custom LLM workflows |

### Prompt Engineering for Design Tools

- Be specific about component type, state, and context: "A modal dialog for confirming file deletion, with a warning icon, file name display, and two buttons: 'Delete' (destructive/red) and 'Cancel' (neutral)"
- Specify the design system: "Using Material 3 Expressive with the default color scheme"
- Include responsive requirements: "Desktop layout with a sidebar, collapsing to bottom navigation on mobile"
- Define accessibility needs: "All interactive elements must have visible focus states and meet 4.5:1 contrast ratio"

---

## Ethical Design

### Dark Pattern Legislation

**EU Digital Services Act (DSA):** Fines up to 6% of global annual turnover for platforms using deceptive design patterns to manipulate user decisions. Covers consent dialogs, subscription flows, and data collection interfaces.

**EU AI Act:** Fines up to 7% of global annual turnover for AI systems that use subliminal techniques or exploit vulnerabilities to manipulate behavior. Applies to AI-generated interfaces and recommendation systems.

**US FTC enforcement:** Increasing action against subscription traps (click-to-cancel rule), hidden fees, and deceptive design. No single federal law, but enforcement through Section 5 unfair/deceptive practices.

### Inclusive Design Principles

- Design for the full range of human diversity (ability, age, culture, language, gender, economic status)
- Solve for one, extend to many (curb cuts designed for wheelchairs benefit strollers, delivery carts, and travelers)
- Provide multiple ways to accomplish the same task (voice, keyboard, mouse, touch, switch)
- Test with people who have disabilities, don't just simulate

### Sustainability in Design

| Practice | Impact |
|----------|--------|
| Dark mode on OLED screens | 63% less energy consumption |
| Static sites vs. dynamic CMS | Up to 90% less energy per page view |
| Compressed images (WebP/AVIF) | 25-50% smaller files, less transfer energy |
| System fonts vs. custom web fonts | Eliminates font download (100-500KB savings) |
| Efficient JavaScript (less code, better tree-shaking) | Reduced CPU processing, longer battery life |
| Green hosting (renewable energy) | 100% offset of server energy consumption |

The internet accounts for approximately 3.7% of global carbon emissions (comparable to the airline industry). Every design decision that reduces page weight, server requests, or processing time contributes to sustainability.
