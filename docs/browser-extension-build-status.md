# Browser Extension Build Status

## Purpose
Track what has been built, what is currently in progress, and what remains for the browser extension initiative.

This file should be updated as implementation progresses so we always have one current source of truth.

## Current Status
- Current phase: `Phase 4 - Application Workspace`
- Overall state: `In progress`
- Last updated: `2026-03-21`

## Completed

### Planning
- [x] Product plan created
- [x] Phase-by-phase implementation plan created
- [x] Parsing engine architecture created

### Phase 0 Foundation
- [x] Added a living build-status tracker
- [x] Added shared backend extension schemas
- [x] Added backend helper to fetch an extension-friendly profile bundle
- [x] Added backend helper to analyze a job page using existing JD parsing
- [x] Added `GET /api/extension/me`
- [x] Added `POST /api/extension/page/analyze`
- [x] Added initial `extension/` folder scaffold
- [x] Added a minimal Chrome extension shell:
  - [x] manifest
  - [x] background worker
  - [x] content script
  - [x] popup UI
  - [x] side panel UI

### Phase 1 Page Detection + Analysis
- [x] Built structured page classifier
- [x] Built DOM reduction pipeline
- [x] Built JD candidate extraction
- [x] Built normalized field detection
- [x] Improved extension shell to publish parsed page context
- [x] Expanded backend analyze contract to accept normalized page payloads

### Phase 2 Safe Autofill
- [x] Built fill planner for basic profile fields
- [x] Built profile-to-field resolver for low-risk semantic keys
- [x] Built safe text-like autofill executor
- [x] Built one-run undo support per tab
- [x] Added side panel preview/apply/undo flow
- [x] Expanded safe autofill to selects and high-confidence enumerations
- [x] Added explicit field-by-field confirm flows for review-required items
- [x] Added protected upload handling for resume/CV fields

## In Progress

### Phase 0 Foundation
- [ ] Extension auth handshake beyond current web-session assumptions
- [ ] Extension-to-backend token/session design
- [ ] Real extension build tooling decision

## Remaining

### Phase 1 Page Detection + Analysis
- [x] Build normalized page model
- [x] Improve analysis payload from browser to backend
- [ ] Persist analyzed job context more intentionally

### Phase 2 Safe Autofill
- [x] Build raw field scanner
- [x] Build field normalization engine
- [x] Build confidence scoring for field mapping
- [x] Build fill planner
- [x] Build safe autofill executor
- [x] Build undo support

### Phase 3 AI Answers
- [x] Build question detector
- [x] Build question classification hints
- [x] Build answer suggestion endpoint
- [x] Build answer insert/copy/save UX

### Phase 4 Application Workspace
- [x] Add `ApplicationWorkspace` data model
- [x] Add workspace create/update APIs
- [x] Link browser state to saved workspace state

### Phase 5 Resume Tailoring From Browser
- [ ] Add browser-triggered resume generation endpoint
- [ ] Show generation progress in extension
- [ ] Link generated resumes to the job/application context

### Phase 6 Memory
- [ ] Add reusable answers model
- [ ] Add recurring application preference memory

### Phase 7 Company Intelligence
- [ ] Add company insight model
- [ ] Add enrichment pipeline
- [ ] Add company trust/fit UI

## Notes
- Current API routes use the existing authenticated web session model.
- Extension-specific secure token/session flow is still pending.
- The initial extension shell is intentionally simple so we can start building the parser and page-analysis loop quickly.
