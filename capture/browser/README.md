# @rixmerz/flowtrace-browser

```bash
npm i @rixmerz/flowtrace-browser
```


Browser capture for FlowTrace v2: HTTP requests, route changes and unhandled
errors, emitted as the same schema v2 events every other capture layer produces
and shipped to the dashboard collector.

## What it does and does not trace

The Node and Python layers instrument *every* function, by rewriting modules at
load time. This one does not, and the reason is structural rather than
temporary: the browser has no `AsyncLocalStorage`. The nearest equivalent is
Zone.js, and Angular is actively moving away from it, so building on it would
tie this package to a shrinking assumption.

Without ambient async context there is no way to attribute an arbitrary
function call to the request that caused it. So this layer records the events
whose start and end are well defined and whose handle the caller can hold
across the await: **HTTP**, **navigation**, **errors**. Those are also where
the questions usually are.

Change detection is deliberately not instrumented. Angular exposes no supported
hook, and a CD pass is far too frequent to record per-occurrence without
drowning the trace.

## Mapping onto schema v2

The schema has no browser concepts and `additionalProperties: false`, so
nothing is invented. Browser work is expressed with the fields that exist:

| Field | Meaning here |
|-------|--------------|
| `module` | `http` \| `router` \| `error` |
| `class` | the resource: URL path, route, or error type |
| `method` | the operation: `GET`, `navigate`, the error origin |
| `args` | url, navigation endpoints |
| `result` | `{status, ok}`, or `{}` on failure |
| `error` | `{type, msg, stack}`, exactly as the other layers emit it |

A trace mixing browser and server spans therefore reads uniformly, and
`trace_tree`, `trace_find_error` and the dashboard work on it unchanged.
Events carry `lang: "browser"` (the schema enum has that value for this layer;
earlier releases emitted `"node"`).

**URLs are scrubbed of query strings and fragments before being recorded.**
Traces get shared, and query strings routinely carry tokens. Path segments are
recorded verbatim, so a path that embeds a token (`/reset/<token>`) lands in
the trace as-is. Other `args` keys go through the same redaction rule as every
capture layer (`password`, `secret`, `token`, `authorization`, `api_key`,
`dsn`, `connection_string`, `email`, plus `initFlowtrace({ redactKeys })`);
the URL-valued keys `url`, `from` and `to` are exempt because the scrubbed URL
is the point of the span.

**The collector is reached over HTTP, and losses are counted.** A batch the
collector never acknowledged (unreachable, non-2xx) is dropped, added to
`droppedCount()`, and reported once on the console. An `https:` page with the
default `http://localhost:8765` endpoint is blocked as mixed content by the
browser; `initFlowtrace` warns about that at setup rather than letting every
flush fail silently.

## Setup

```js
import { initFlowtrace } from '@rixmerz/flowtrace-browser';

initFlowtrace({
  endpoint: 'http://localhost:8765/api/trace',
  // Optional: a server-rendered traceparent, so the document request and
  // everything the page then does land in one trace.
  traceparent: document.querySelector('meta[name=traceparent]')?.content,
});
// Safe to call again (hydration, HMR): listeners are installed once.
```

Start the collector with `cd flowtrace-dashboard && pnpm start`.

Events are batched and flushed on size, on an interval, and on
`visibilitychange`/`pagehide` via `navigator.sendBeacon` — which is what keeps
the tail of a session from being lost when the tab closes.

## Angular

See `src/angular.js`. The bindings are intentionally thin: all the logic lives
in `src/api.js` and is unit-tested without Angular, so what remains in the
Angular file is wiring.

```ts
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAppInitializer, inject, ErrorHandler } from '@angular/core';
import { Router } from '@angular/router';
import { provideFlowtrace, flowtraceInterceptor } from '@rixmerz/flowtrace-browser/angular';

export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(withInterceptors([flowtraceInterceptor])),
    provideFlowtrace(
      { endpoint: 'http://localhost:8765/api/trace' },
      { provideAppInitializer, inject, Router, ErrorHandler },
    ),
  ],
};
```

Angular symbols are passed in rather than imported, so this package stays
installable — and testable — with no Angular in the dependency graph. The
TypeScript declarations duplicate Angular's shapes structurally for the same
reason: `flowtraceInterceptor` is assignable to `HttpInterceptorFn` without
this package depending on `@angular/common/http`.

The interceptor attaches `traceparent` to every outgoing request, so a call
from the browser continues into the traced server as one trace. It never
overwrites a header the application already set.

`rxjs` is the one framework import in `angular.js`, used for `tap` so the
interceptor returns Angular's own Observable with its identity intact —
unsubscribe still cancels the request and every `HttpEvent` still passes
through. It is a peer dependency, already present in any Angular app.

## Why this one is published and the others are not

Every other capture layer is vendored inside `@rixmerz/flowtrace`, because the
CLI launches the runtime and injects the layer into it. A browser layer cannot
work that way: it is a build-time dependency of the application's own bundle,
and no globally installed CLI can put a module into someone's vite graph.

Reaching it through the CLI tarball was measured and rejected — it costs a
frontend 31 MB of `@swc/core`, a 2.3 MB Java jar and a package-manager
build-script prompt, to import 60 KB of code it can install directly.

## Cross-origin: the server must allow the header

`traceparent` is not a CORS-safelisted request header, so adding it makes a
request that used to be simple into a preflighted one. If the browser and the
API are on different origins, the API must name it:

```
Access-Control-Allow-Headers: Content-Type, traceparent
```

Without that the preflight fails and **the request never happens** — turning on
FlowTrace breaks the call. This is the first thing to check when enabling the
browser layer turns working requests into CORS errors.

## Tests

```bash
make test-browser
```

Includes an end-to-end test that boots the real dashboard collector and asserts
that browser spans land on disk as schema-valid JSONL — the only test covering
the seam between the two.
