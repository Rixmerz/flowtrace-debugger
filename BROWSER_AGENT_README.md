# FlowTrace Browser Agent 🌐

FlowTrace Browser Agent enables client-side execution tracing for JavaScript applications running in the browser. It captures console output, execution context, and user interactions, allowing you to debug browser-based applications with the same power as server-side Node.js tracing.

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Installation Methods](#installation-methods)
- [Configuration](#configuration)
- [Usage](#usage)
- [Integration Guides](#integration-guides)
- [API Reference](#api-reference)
- [Examples](#examples)
- [Troubleshooting](#troubleshooting)

---

## Features

### ✅ Core Capabilities

- **Console Interception**: Automatically captures all `console.log`, `console.error`, `console.warn`, `console.info`, and `console.debug` calls
- **Stack Trace Capture**: Records execution context with full stack traces for debugging
- **JSONL Export**: Compatible log format with Node.js FlowTrace agent
- **Memory-Efficient**: Circular buffer storage with configurable size (default: 10,000 entries)
- **Zero Dependencies**: Pure JavaScript, works in any modern browser
- **Framework Agnostic**: Works with React, Vue, Angular, vanilla JS, and more
- **Development Focus**: Designed for debugging during development (not production monitoring)

### 📊 Output Format

Logs are stored in JSONL (JSON Lines) format, with one JSON object per line:

```json
{"timestamp":"2025-11-01T03:20:15.123Z","event":"CONSOLE","level":"LOG","thread":"main","message":"User created successfully","source":{"file":"http://localhost:3000/src/App.tsx","line":28,"column":15}}
{"timestamp":"2025-11-01T03:20:15.456Z","event":"CONSOLE","level":"ERROR","thread":"main","message":"Failed to fetch users","source":{"file":"http://localhost:3000/src/hooks/useUsers.ts","line":45,"column":20}}
```

---

## Quick Start

### 1. Add Browser Shim to Your HTML

```html
<!DOCTYPE html>
<html>
<head>
  <title>My App</title>
  <!-- Load FlowTrace Browser Agent -->
  <script src="path/to/browser-shim.js"></script>
</head>
<body>
  <div id="root"></div>

  <!-- Initialize FlowTrace -->
  <script>
    FlowTrace.init({
      packagePrefix: 'src/',      // Only trace files from src/
      captureStackTraces: true,   // Capture execution context
      maxLogEntries: 10000,       // Max log entries
      consolePassthrough: true    // Still show console output
    });
  </script>

  <!-- Your app code -->
  <script src="app.js"></script>
</body>
</html>
```

### 2. Use Your Application Normally

All `console.*` calls are automatically captured:

```javascript
console.log('User logged in:', user);
console.error('API request failed:', error);
console.warn('Deprecated API usage detected');
```

### 3. Export Logs

```javascript
// In browser console or via UI button:
FlowTrace.export('my-app-logs.jsonl');
```

A JSONL file will be downloaded to your computer for analysis.

---

## Installation Methods

### Method 1: React + Vite (Recommended for React apps)

**Step 1**: Create loader file `src/browser-shim-loader.ts`:

```typescript
import '../../../flowtrace-agent-js/src/browser-shim.js';

if (typeof window !== 'undefined' && window.FlowTrace) {
  window.FlowTrace.init({
    packagePrefix: 'src/',
    captureStackTraces: true,
    maxLogEntries: 10000,
    consolePassthrough: true,
    enabled: true
  });

  console.log('🔍 FlowTrace Browser Agent initialized');
}

export {};
```

**Step 2**: Update `index.html`:

```html
<head>
  <!-- Add FlowTrace loader before main app -->
  <script src="/src/browser-shim-loader.ts" type="module"></script>
</head>
```

**Step 3**: Run your app:

```bash
npm run dev
```

**Step 4**: Open browser console and interact with your app. Export logs with:

```javascript
FlowTrace.export('flowtrace-react.jsonl');
```

---

### Method 2: Create React App (CRA)

**Step 1**: Copy `browser-shim.js` to `public/` directory:

```bash
cp flowtrace-agent-js/src/browser-shim.js public/
```

**Step 2**: Update `public/index.html`:

```html
<head>
  <!-- Load FlowTrace -->
  <script src="%PUBLIC_URL%/browser-shim.js"></script>
  <script>
    FlowTrace.init({
      packagePrefix: 'src/',
      captureStackTraces: true
    });
  </script>
</head>
```

**Step 3**: Run your app:

```bash
npm start
```

---

### Method 3: Next.js

**Step 1**: Copy `browser-shim.js` to `public/` directory.

**Step 2**: Create `_document.tsx` (or update existing):

```tsx
import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html>
      <Head>
        <script src="/browser-shim.js"></script>
        <script dangerouslySetInnerHTML={{
          __html: `
            FlowTrace.init({
              packagePrefix: 'src/',
              captureStackTraces: true,
              enabled: process.env.NODE_ENV === 'development'
            });
          `
        }} />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
```

---

### Method 4: Vanilla HTML/JavaScript

```html
<!DOCTYPE html>
<html>
<head>
  <script src="browser-shim.js" data-auto-init data-package-prefix="app/" data-capture-stack="true"></script>
</head>
<body>
  <h1>My App</h1>
  <script src="app.js"></script>

  <!-- Export button -->
  <button onclick="FlowTrace.export()">Export Logs</button>
</body>
</html>
```

---

## Configuration

### Configuration Options

```typescript
interface FlowTraceConfig {
  // Filter logs by source file prefix (e.g., 'src/', 'app/')
  packagePrefix?: string;

  // Capture stack traces for execution context (default: true)
  captureStackTraces?: boolean;

  // Maximum log entries before circular buffer overwrites oldest (default: 10000)
  maxLogEntries?: number;

  // Still show logs in browser console (default: true)
  consolePassthrough?: boolean;

  // Enable console method interception (default: true)
  captureConsole?: boolean;

  // Timestamp format: 'iso' or 'epoch' (default: 'iso')
  timestampFormat?: 'iso' | 'epoch';

  // Master on/off switch (default: true)
  enabled?: boolean;
}
```

### Example Configurations

**Development Mode (Full Tracing)**:
```javascript
FlowTrace.init({
  packagePrefix: '',              // Capture all logs
  captureStackTraces: true,       // Full context
  maxLogEntries: 50000,           // Large buffer
  consolePassthrough: true,       // Show in console
  enabled: true
});
```

**Production Mode (Minimal Overhead)**:
```javascript
FlowTrace.init({
  packagePrefix: 'src/',          // Only app code
  captureStackTraces: false,      // Skip stack traces
  maxLogEntries: 5000,            // Smaller buffer
  consolePassthrough: true,
  enabled: process.env.NODE_ENV === 'development' // Dev only
});
```

**Testing Mode (Silent Capture)**:
```javascript
FlowTrace.init({
  packagePrefix: 'src/',
  captureStackTraces: true,
  maxLogEntries: 10000,
  consolePassthrough: false,      // Don't show in console
  enabled: true
});
```

---

## Usage

### Basic Operations

```javascript
// Initialize FlowTrace
FlowTrace.init({ packagePrefix: 'src/' });

// Export logs as JSONL file
FlowTrace.export('my-logs.jsonl');

// Get statistics
const stats = FlowTrace.getStats();
console.log(stats);
// Output:
// {
//   totalEntries: 1234,
//   maxCapacity: 10000,
//   utilizationPercent: "12.34",
//   byLevel: { LOG: 1000, ERROR: 200, WARN: 34 },
//   byEvent: { CONSOLE: 1234 }
// }

// Get all log entries
const logs = FlowTrace.getLogs();

// Clear all logs
FlowTrace.clearLogs();

// Get current configuration
const config = FlowTrace.getConfig();

// Update configuration
FlowTrace.updateConfig({ maxLogEntries: 20000 });

// Temporarily disable/enable
FlowTrace.disable();
FlowTrace.enable();
```

### Integration with React Components

```typescript
import React, { useEffect } from 'react';

function MyComponent() {
  useEffect(() => {
    console.log('Component mounted');

    return () => {
      console.log('Component unmounting');
    };
  }, []);

  const handleClick = () => {
    console.log('Button clicked');
    // ... your logic
  };

  return (
    <div>
      <button onClick={handleClick}>Click Me</button>
      <button onClick={() => FlowTrace.export()}>Export Logs</button>
    </div>
  );
}
```

---

## Integration Guides

### React + Vite

See [examples/react-typescript](./examples/react-typescript) for a complete working example.

**Key Files**:
- `index.html` - Loads browser shim loader
- `src/browser-shim-loader.ts` - Initializes FlowTrace
- `src/App.tsx` - Example React component with tracing

**Run Example**:
```bash
cd examples/react-typescript
npm install
npm run dev
```

Open http://localhost:5173, interact with the app, open browser console, and run:
```javascript
FlowTrace.export('react-logs.jsonl');
```

---

### Create React App

```bash
# Step 1: Copy browser shim
cp flowtrace-agent-js/src/browser-shim.js public/

# Step 2: Update public/index.html (see Method 2 above)

# Step 3: Run app
npm start
```

---

### Next.js

See Method 3 in [Installation Methods](#method-3-nextjs).

---

### Vue.js

**Step 1**: Copy `browser-shim.js` to `public/`.

**Step 2**: Update `public/index.html`:

```html
<head>
  <script src="<%= BASE_URL %>browser-shim.js"></script>
  <script>
    FlowTrace.init({
      packagePrefix: 'src/',
      captureStackTraces: true
    });
  </script>
</head>
```

---

### Angular

**Step 1**: Copy `browser-shim.js` to `src/assets/`.

**Step 2**: Update `src/index.html`:

```html
<head>
  <script src="assets/browser-shim.js"></script>
  <script>
    FlowTrace.init({
      packagePrefix: 'src/',
      captureStackTraces: true
    });
  </script>
</head>
```

**Step 3**: Update `angular.json` to include script in assets:

```json
{
  "projects": {
    "your-app": {
      "architect": {
        "build": {
          "options": {
            "assets": [
              "src/assets",
              "src/assets/browser-shim.js"
            ]
          }
        }
      }
    }
  }
}
```

---

## API Reference

### FlowTrace.init(config?)

Initialize the browser agent with optional configuration.

```typescript
FlowTrace.init({
  packagePrefix: 'src/',
  captureStackTraces: true,
  maxLogEntries: 10000,
  consolePassthrough: true,
  enabled: true
});
```

---

### FlowTrace.export(filename?)

Download logs as JSONL file.

```typescript
FlowTrace.export('my-logs.jsonl'); // Default: flowtrace-browser.jsonl
```

---

### FlowTrace.getLogs()

Get all captured log entries as array.

```typescript
const logs = FlowTrace.getLogs();
console.log(logs.length); // e.g., 1234
```

---

### FlowTrace.clearLogs()

Clear all captured logs.

```typescript
FlowTrace.clearLogs();
```

---

### FlowTrace.getStats()

Get statistics about captured logs.

```typescript
const stats = FlowTrace.getStats();
// {
//   totalEntries: 1234,
//   maxCapacity: 10000,
//   utilizationPercent: "12.34",
//   byLevel: { LOG: 1000, ERROR: 200, WARN: 34 },
//   byEvent: { CONSOLE: 1234 }
// }
```

---

### FlowTrace.getConfig()

Get current configuration.

```typescript
const config = FlowTrace.getConfig();
```

---

### FlowTrace.updateConfig(newConfig)

Update configuration dynamically.

```typescript
FlowTrace.updateConfig({
  maxLogEntries: 20000,
  captureStackTraces: false
});
```

---

### FlowTrace.disable() / FlowTrace.enable()

Temporarily disable/enable tracing.

```typescript
FlowTrace.disable(); // Stop capturing logs
// ... do something without tracing
FlowTrace.enable();  // Resume capturing logs
```

---

## Examples

### Example 1: Simple HTML Page

See [examples/browser-test.html](./examples/browser-test.html) for an interactive test page with UI controls.

```bash
# Open in browser:
open examples/browser-test.html
```

---

### Example 2: React Application

Complete React + TypeScript example with:
- User management interface
- Async operations
- Console logging throughout
- Export button integration

```bash
cd examples/react-typescript
npm install
npm run dev
```

---

### Example 3: Debugging Async Operations

```javascript
async function fetchUsers() {
  console.log('📡 Fetching users...');

  try {
    const response = await fetch('/api/users');
    const users = await response.json();
    console.log('✅ Users fetched:', users.length);
    return users;
  } catch (error) {
    console.error('❌ Failed to fetch users:', error);
    throw error;
  }
}

// Later, export logs to see the full async flow:
FlowTrace.export('async-debug.jsonl');
```

---

### Example 4: Custom Export Button

```javascript
// Add floating export button to your app
function addFlowTraceExportButton() {
  const btn = document.createElement('button');
  btn.textContent = '📥 Export FlowTrace Logs';
  btn.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 12px 20px;
    background: #007bff;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    z-index: 10000;
  `;
  btn.onclick = () => FlowTrace.export();
  document.body.appendChild(btn);
}

// Call after DOM loaded
document.addEventListener('DOMContentLoaded', addFlowTraceExportButton);
```

---

## Troubleshooting

### Issue: Logs Not Being Captured

**Solution**: Verify FlowTrace is initialized before your app code runs.

```html
<!-- ✅ Correct: FlowTrace loads first -->
<script src="browser-shim.js"></script>
<script>FlowTrace.init();</script>
<script src="app.js"></script>

<!-- ❌ Wrong: App loads before FlowTrace -->
<script src="app.js"></script>
<script src="browser-shim.js"></script>
```

---

### Issue: Export Does Nothing

**Check**:
1. Are there any logs captured? Run `FlowTrace.getStats()` in console
2. Is popup blocker preventing download? Check browser settings
3. Are you using HTTPS? Some browsers restrict downloads on HTTP

```javascript
// Debug export:
const stats = FlowTrace.getStats();
console.log('Total entries:', stats.totalEntries);

if (stats.totalEntries === 0) {
  console.warn('No logs to export. Interact with the app first.');
} else {
  FlowTrace.export();
}
```

---

### Issue: Too Many Logs (Performance)

**Solution**: Configure smaller buffer or filter by package prefix.

```javascript
FlowTrace.updateConfig({
  maxLogEntries: 5000,        // Reduce buffer size
  packagePrefix: 'src/app/',  // Only capture specific directory
  captureStackTraces: false   // Skip stack traces for performance
});
```

---

### Issue: Logs from Dependencies/Libraries

**Solution**: Use `packagePrefix` to filter only your application code.

```javascript
FlowTrace.init({
  packagePrefix: 'src/', // Only logs from src/ directory
  // Filters out node_modules, vendor libs, etc.
});
```

---

### Issue: Console Output Not Showing

**Solution**: Ensure `consolePassthrough` is enabled.

```javascript
FlowTrace.updateConfig({
  consolePassthrough: true
});
```

---

### Issue: TypeScript Errors for window.FlowTrace

**Solution**: Add type declarations.

```typescript
declare global {
  interface Window {
    FlowTrace: {
      init: (config?: any) => void;
      export: (filename?: string) => void;
      getLogs: () => any[];
      clearLogs: () => void;
      getStats: () => any;
      // ... other methods
    };
  }
}
```

---

## Performance Considerations

### Memory Usage

- **Default**: 10,000 log entries ≈ 2-5 MB RAM (depending on log size)
- **Circular Buffer**: Automatically overwrites oldest entries when full
- **Recommendation**: Adjust `maxLogEntries` based on your debugging needs

### Execution Overhead

- **Console Interception**: ~0.1ms per log statement
- **Stack Trace Capture**: ~1-2ms per log (can be disabled)
- **Overall Impact**: Negligible for development debugging

### Production Considerations

**⚠️ Not Recommended for Production**

FlowTrace Browser Agent is designed for development debugging, not production monitoring. For production:

- Use `enabled: process.env.NODE_ENV === 'development'`
- Or use commercial tools like Sentry, LogRocket, Datadog

---

## Comparison: Browser Agent vs Node.js Agent

| Feature | Browser Agent | Node.js Agent |
|---------|---------------|---------------|
| **Environment** | Browser JavaScript | Node.js Server |
| **Log Storage** | In-memory (circular buffer) | File system (JSONL) |
| **Export Method** | Download file | Direct file write |
| **Stack Traces** | Browser stack format | Node.js stack format |
| **Performance Overhead** | Negligible (~0.1ms/log) | Negligible (~0.1ms/log) |
| **Use Case** | Client-side debugging | Server-side debugging |
| **Persistence** | Session-based (lost on refresh) | Persistent (file-based) |

---

## Future Enhancements (Phase 2)

The current browser agent is a Phase 1 prototype focused on console interception. Future enhancements include:

### Phase 2: Automatic Function Tracing
- ES6 Proxy-based automatic instrumentation
- Capture function entry/exit with arguments and results
- Handle async/Promise-returning functions
- Filter by package prefix (similar to Node.js agent)

### Phase 3: Build Tool Integration
- Vite plugin for automatic injection
- Webpack plugin for CRA support
- Next.js configuration guide
- Rollup, Parcel, esbuild support

### Phase 4: Advanced Features
- IndexedDB storage for persistence across sessions
- Real-time log streaming to backend
- React Profiler API integration
- Performance metrics and flamegraphs

---

## Contributing

Found a bug or have a feature request? Please open an issue on GitHub!

---

## License

MIT License - See LICENSE file for details.

---

## Support

- **Documentation**: This README
- **Examples**: `examples/browser-test.html`, `examples/react-typescript/`
- **Issues**: GitHub Issues
- **Email**: juanpablo516@gmail.com
