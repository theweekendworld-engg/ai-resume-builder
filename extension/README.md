# Patronus Extension

Chrome MV3 extension. Phase 1 of the one-stop-platform-plan introduced a Vite + React + TypeScript build pipeline; the legacy vanilla files at the root of this directory are kept as the parser modules (`parsers/*.js`) until Phase 1 slice 2 ports them to TS.

## Building

From the repo root:

```bash
bun run ext:install     # one-time, installs extension/-local deps
bun run ext:build       # produces extension/dist/
```

Or from this directory:

```bash
cd extension/
bun install
bun run build
```

## Loading the extension in Chrome

After a build:

1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Click **Load unpacked**.
4. Select `extension/dist/` (the build output — **not** this directory).

The legacy vanilla extension at the root of this directory is no longer the loaded artifact. It remains in the tree because Phase 1 slice 1 only ships the build pipeline + shells; the parser modules (`parsers/*.js`) are still loaded as content scripts in their JS form during this transition. They will be ported to TS in slice 2.

## Dev loop

```bash
cd extension/
bun run dev
```

Vite serves the side panel / popup with HMR; reload the extension from `chrome://extensions` after changes to the background worker or content script.

## What's here vs. what's deferred

Built this slice (Phase 1 slice 1):
- Vite + React + TS + tailwind + crxjs build pipeline
- MV3 manifest (`manifest.config.ts`) generating `dist/manifest.json`
- Typed background service worker with `messageBus`, `tokenStore`, `tabContext`
- Content script TS shim that drives the existing JS parser pipeline
- Side panel React app with 5 routes: Apply, Tailor, Answers, Workspaces, Settings
- Popup with connected / expired / disconnected states
- Local design tokens matching the web app's tailwind theme

Deferred to slice 2:
- 1:1 TS port of the parser modules (`parsers/*.js` → `src/parsers/*.ts`)
- `ApplicationSession` state machine + persistence
- `POST /api/extension/session/orchestrate` backend route
- Profile completeness gate with deep link
- Real component depth for Fields/Questions/Workspace cards
- Telemetry event wiring
- Deletion of legacy vanilla `popup.*`, `sidepanel.*`, `background.js`, `content.js`

## Tests

The Phase 0 fixture suite lives at `__tests__/parsers/` and runs against the JS parser modules. Run from the repo root:

```bash
bun run test:extension
```
