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
- side panel can preview bulk-safe fields plus per-field review actions
- side panel can detect long-form application questions and request grounded answer drafts
- answer drafts support tone switching, copy, insert, and save actions
- safe autofill supports text-like fields and high-confidence select/radio/checkbox matches
- resume/CV upload fields stay protected: the extension can focus the field and open the picker, but does not auto-attach files
- safe autofill supports one-run undo per tab
- popup and side panel show the parsed page context

## Next Steps
- add authenticated backend calls
- add page analysis action from the normalized page payload
- connect parsed page context to backend analysis and saved job/application state
- add application workspace persistence that groups saved questions per job
