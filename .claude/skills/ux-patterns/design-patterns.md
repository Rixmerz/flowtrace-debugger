# UX Design Patterns and Laws

## Laws of UX -- 30 Principles

### Heuristics

**Aesthetic-Usability Effect**
Users perceive aesthetically pleasing designs as more usable, even when they are not objectively better.
- Application: Invest in visual polish for first impressions. A well-styled error page reduces perceived severity. Users are more forgiving of minor usability issues when the interface looks professional.

**Doherty Threshold**
Productivity soars when a system responds to user input in under 400 milliseconds.
- Application: Use skeleton screens, optimistic UI updates, and progress indicators to maintain perceived responsiveness. If an operation takes longer than 400ms, show a loading state immediately. Aim for < 200ms for direct manipulation interactions (dragging, typing).

**Fitts's Law**
The time to reach a target is a function of the distance to and size of the target.
- Application: Make primary actions large and position them near likely cursor/thumb locations. Place destructive actions (delete, cancel) away from constructive ones. Mobile: place key actions in the thumb zone (bottom third of screen). Minimum touch target: 24x24px (WCAG 2.5.8), recommended: 44x44px (Apple HIG) / 48x48px (Material).

**Goal-Gradient Effect**
Users accelerate behavior as they approach a goal. Motivation increases with proximity to completion.
- Application: Show progress indicators for multi-step flows. Display "3 of 5 steps complete" rather than just a progress bar. Pre-fill the first step of onboarding to create a sense of momentum. Loyalty programs showing partial progress outperform empty ones.

**Hick's Law**
The time to make a decision increases logarithmically with the number of choices available.
- Application: Limit navigation items to 5-7 top-level options. Use progressive disclosure to hide advanced settings. Break complex forms into multi-step wizards. Highlight a recommended option when presenting plans or pricing tiers.

**Jakob's Law**
Users spend most of their time on other sites, so they prefer your site to work the same way as others they already know.
- Application: Follow platform conventions (hamburger menu on mobile, logo-links-to-home, shopping cart icon top-right for e-commerce). Deviate from conventions only when the improvement is substantial and learnable. Test novel patterns with extra rigor.

**Miller's Law**
The average person can hold about 7 (plus or minus 2) items in working memory at a time.
- Application: Group related content into chunks of 5-9 items. Use categories and headings to organize long lists. Phone numbers are chunked (555-867-5309) for this reason. Dashboard widgets should present 5-7 key metrics, not 20.

**Parkinson's Law**
A task will expand to fill the time allotted for it.
- Application: Use time constraints and deadlines to drive action (countdown timers for limited offers, session timeouts with clear warnings). Reduce form fields to the minimum required -- users will spend less time if there are fewer fields.

### Gestalt Principles

**Law of Common Region**
Elements within a shared boundary are perceived as belonging to the same group.
- Application: Use cards, borders, or background colors to group related content. Form sections within bordered containers communicate field relationships. Toolbar groups within dividers indicate related actions.

**Law of Proximity**
Elements placed close together are perceived as related.
- Application: Place labels directly adjacent to their form fields (above or left, not far away). Group related buttons together. Add more spacing between unrelated sections than between related items. White space is a grouping tool.

**Law of Pragnanz (Simplicity)**
People tend to perceive and interpret ambiguous or complex shapes in the simplest form possible.
- Application: Simplify icons and visual elements. Use clear, unambiguous symbols. Reduce visual noise so the user can quickly parse the interface. Avoid decorative complexity that doesn't serve comprehension.

**Law of Similarity**
Elements that share visual characteristics (color, shape, size) are perceived as related.
- Application: Style all clickable elements consistently (same color, underline pattern). Use consistent icon styles within a category. Differentiate primary and secondary actions through visual weight (filled vs. outlined buttons).

**Law of Uniform Connectedness**
Elements connected by visual lines or flows are perceived as more related than elements without connection.
- Application: Use lines in timelines, flowcharts, and step indicators to show sequence. Connect related data points in charts. Use connector lines in organizational charts and process diagrams.

### Cognitive Biases

**Peak-End Rule**
People judge an experience based on how they felt at the peak (most intense point) and at the end, rather than the average of every moment.
- Application: Invest in delightful moments (success animations, congratulatory messages) and ensure the final interaction is positive (confirmation page, follow-up email). A frustrating checkout flow with a satisfying confirmation page is remembered better than a mediocre flow throughout.

**Serial Position Effect**
Users tend to remember the first and last items in a series best.
- Application: Place the most important features or messages at the beginning and end of lists, menus, and onboarding flows. Navigation: put key items first and last in the nav bar.

**Von Restorff Effect (Isolation Effect)**
Items that stand out from their surroundings are more likely to be remembered.
- Application: Use visual contrast to highlight CTAs (color, size, whitespace). The "recommended" plan badge on pricing pages exploits this. Warning messages should visually contrast with surrounding content.

**Zeigarnik Effect**
People remember uncompleted tasks better than completed ones.
- Application: Show progress indicators for incomplete profiles ("Your profile is 60% complete"). Use checklists that show remaining items. LinkedIn and gaming apps use this extensively to drive engagement.

### Design Principles

**Occam's Razor**
Among competing hypotheses, the simplest explanation is usually the best. Prefer the design with the fewest assumptions.
- Application: When two designs achieve the same goal, choose the simpler one. Remove features that serve edge cases at the expense of the common case. Every additional element competes for attention.

**Pareto Principle (80/20 Rule)**
Roughly 80% of effects come from 20% of causes.
- Application: Identify the 20% of features that serve 80% of user needs and prioritize them. Analytics will reveal which flows account for most user activity -- optimize those first. Don't give equal visual weight to rarely-used functions.

**Postel's Law (Robustness Principle)**
Be liberal in what you accept and conservative in what you send.
- Application: Accept varied input formats (phone numbers with or without dashes, dates in multiple formats). Display output in a standardized, predictable format. Validate gracefully with helpful suggestions rather than rigid rejection.

**Tesler's Law (Law of Conservation of Complexity)**
Every system has an irreducible amount of complexity. The question is who deals with it -- the user or the developer.
- Application: Absorb complexity on the backend so the user's experience is simple. Auto-detect location instead of requiring manual entry. Infer reasonable defaults rather than presenting configuration panels. Smart defaults reduce cognitive burden.

### Cognitive Concepts (Newer Additions)

**Choice Overload (Overchoice)**
When presented with too many options, users experience anxiety, decision fatigue, and reduced satisfaction with their eventual choice.
- Application: Limit options to 3-5 when possible. Use filters and faceted search to help narrow large catalogs. Restaurant menus with fewer items per category produce higher satisfaction. Present a "recommended" or "most popular" default.

**Chunking**
Organizing information into familiar, manageable groups (chunks) improves short-term memory retention and processing.
- Application: Break long forms into logical sections. Display credit card numbers in groups of four. Use headings, dividers, and visual grouping to chunk content. Step-by-step instructions should have 3-5 steps per phase.

**Cognitive Bias**
Systematic patterns of deviation from rationality in judgment. Users make decisions based on mental shortcuts, not pure logic.
- Application: Anchoring (show original price before discount), framing (present outcomes positively), default effect (pre-select the preferred option ethically), social proof (show user counts, testimonials). Be aware of biases to design ethically, not exploitatively.

**Cognitive Load**
The total mental effort required to use a system. Three types: intrinsic (task complexity), extraneous (poor design), germane (learning).
- Application: Minimize extraneous load through clear layout, consistent patterns, and eliminating unnecessary decisions. Reduce intrinsic load by breaking complex tasks into steps. Support germane load with tutorials and contextual help.

**Flow State**
A mental state of complete immersion and focused engagement where the challenge level matches the user's skill level.
- Application: Match task difficulty to user expertise (progressive difficulty in onboarding). Remove interruptions during focused tasks (minimize notifications during writing). Provide immediate feedback for each action. Avoid breaking the user's concentration with unnecessary confirmations.

**Mental Model**
Users' internal representations of how a system should work, based on prior experience with similar systems.
- Application: Align interface metaphors with existing mental models (folder/file metaphor for documents, shopping cart for e-commerce). When introducing novel concepts, bridge from familiar ones. Test for mental model alignment with card sorting and tree testing.

**Paradox of the Active User**
Users prefer to learn by doing rather than reading instructions, even when reading would be more efficient.
- Application: Design interfaces that are safe to explore (undo support, non-destructive defaults). Use inline hints and contextual tooltips instead of upfront documentation. Make onboarding interactive rather than tutorial-based.

**Selective Attention**
Users focus on information relevant to their current task and filter out the rest, often missing elements outside their attention.
- Application: Don't place critical information in areas users are unlikely to look (banner blindness, footer burial). Use visual cues (animation, contrast, positioning) to draw attention to important changes. Error messages should appear near the source of the error, not in a disconnected banner.

**Working Memory**
The cognitive system that temporarily holds and manipulates information (capacity: ~4 items for complex information).
- Application: Don't require users to remember information from one page to use on another. Show relevant context inline. Avoid requiring users to mentally track state across multiple tabs. Persist form data during navigation.

---

## Common UX Anti-Patterns

### Dark Patterns (Deceptive Design)

Regulated under the EU Digital Services Act (fines up to 6% of global revenue) and EU AI Act (fines up to 7%).

**Confirmshaming**
Guilting users into accepting by framing the decline option negatively.
- Example: "No thanks, I don't want to save money" as the opt-out text for a newsletter.
- Fix: Use neutral language for both options ("Subscribe" / "No thanks").

**Roach Motel**
Making it easy to get into a situation but difficult to get out.
- Example: One-click subscription signup, but cancellation requires calling a phone number during business hours.
- Fix: Cancellation should be as easy as signup. Provide self-service account management.

**Forced Continuity**
Silently charging a user after a free trial ends without clear notification.
- Example: Free trial that auto-converts to paid without a reminder email or confirmation.
- Fix: Send reminders before trial expiration. Require explicit opt-in for paid conversion.

**Misdirection**
Focusing user attention on one thing to distract from another.
- Example: Large "Accept All" button with a tiny "Manage Preferences" link for cookie consent.
- Fix: Give equal visual weight to all options. Present choices clearly and neutrally.

**Hidden Costs**
Revealing additional charges (shipping, taxes, service fees) only at the final step of checkout.
- Example: $9.99 product becomes $18.49 at checkout after fees.
- Fix: Show total estimated cost early. Disclose all fees upfront on product pages.

### Other Anti-Patterns

**Infinite Scroll Without Landmarks**
Endless content feeds that prevent users from reaching footer content, bookmarking positions, or understanding scope.
- Fix: Provide pagination alternatives, "load more" buttons, or position indicators. Ensure footer content is accessible via other paths.

**Notification Fatigue**
Excessive, non-essential notifications that train users to ignore all alerts, including important ones.
- Fix: Default to minimal notifications. Let users configure notification types and frequency. Batch non-urgent notifications.

**Feature Bloat**
Continuously adding features without considering the overall complexity impact on the user experience.
- Fix: Apply the Pareto Principle. Audit feature usage regularly. Consider removing underused features. Use progressive disclosure to hide advanced functionality.

**Mystery Meat Navigation**
Icons or navigation elements without labels, requiring users to hover or guess their function.
- Fix: Always pair icons with text labels, especially for primary navigation. Icon-only is acceptable only for universally understood symbols (close, search, home) and when space is extremely limited.

**Zombie Toggles**
Preferences or settings that appear to be configurable but don't actually do anything or have no visible effect.
- Fix: Every setting should produce an observable result. Remove non-functional options. Provide confirmation or preview of what changed.
