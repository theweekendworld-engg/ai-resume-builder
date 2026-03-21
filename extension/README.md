# Browser Extension

This folder contains the browser extension client for the job application copilot.

## Current State
Phase 3 answer assistant foundation:
- manifest
- background worker
- structured content-script parser pipeline
- popup UI
- side panel UI

The shell is still intentionally lightweight, but it now runs a real parser pipeline before storing page context.

## Load Locally
1. Open `chrome://extensions`
2. Enable Developer Mode
3. Click `Load unpacked`
4. Select this `extension/` folder

## Current Behavior
- content script classifies the page and reduces the DOM to relevant regions
- job metadata and job-description candidates are extracted from the reduced regions
- visible fields are normalized into shared semantic keys where confidence is high enough
- background worker stores the latest parsed page context per tab
- popup can verify backend access, mint a dedicated extension token from the signed-in web session, and configure the target app base URL
- side panel can preview bulk-safe fields plus per-field review actions
- side panel can run explicit job-fit analysis and persist the fit summary into the saved application workspace
- side panel can detect long-form application questions and request grounded answer drafts
- answer drafts support tone switching, copy, insert, and save actions
- current job pages are persisted into recoverable application workspaces and resumed when the same role/page is revisited
- repeated answer regeneration updates the existing saved question record instead of creating duplicates
- safe autofill supports text-like fields and high-confidence select/radio/checkbox matches
- resume/CV upload fields stay protected: the extension can focus the field and open the picker, but does not auto-attach files
- safe autofill supports one-run undo per tab
- popup and side panel show the parsed page context

## Next Steps
- decide whether extension tokens need explicit revoke/sign-out controls in the UI
- add real extension bundling/build tooling
- deepen site-specific adapters for major ATS platforms
