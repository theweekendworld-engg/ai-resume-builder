# AI Resume Builder — UX & Architecture Improvement Plan

**Date:** 2026-02-28  
**Status:** Draft  
**Scope:** End-to-end user flow redesign, mandatory authentication, UI modernization, and architecture cleanup.

---

## Table of Contents

1. [Current State Assessment](#1-current-state-assessment)
2. [Core Philosophy & Design Principles](#2-core-philosophy--design-principles)
3. [Mandatory Authentication — Gate Everything](#3-mandatory-authentication--gate-everything)
4. [Redesigned User Flow (End-to-End)](#4-redesigned-user-flow-end-to-end)
5. [Page-by-Page UI Redesign](#5-page-by-page-ui-redesign)
6. [Component Architecture Cleanup](#6-component-architecture-cleanup)
7. [Design System Overhaul](#7-design-system-overhaul)
8. [State Management Simplification](#8-state-management-simplification)
9. [Mobile-First Responsive Strategy](#9-mobile-first-responsive-strategy)
10. [Error Handling & Loading States](#10-error-handling--loading-states)
11. [Implementation Phases](#11-implementation-phases)
12. [File Change Map](#12-file-change-map)

---

## 1. Current State Assessment

### What works well
- Solid Next.js App Router architecture with server actions.
- Clerk authentication is integrated (just not enforced).
- AI features (ATS scoring, copilot, smart writing) are functional.
- Zustand store with persistence provides good local-first UX.
- shadcn/ui + Tailwind CSS foundation is strong.
- LaTeX compilation and live preview pipeline works.

### Critical problems

| Problem | Impact | Root Cause |
|---|---|---|
| No mandatory sign-in | Can't track users, no data ownership, privacy confusion | Landing page says "No sign-up required" |
| Cluttered editor header | 15+ buttons/controls in the header bar | Everything crammed into one screen |
| Visual ↔ LaTeX sync concept is confusing | Users don't understand "Visual → LaTeX" buttons | Two-way sync exposed as raw UI instead of being handled automatically |
| Cloud sync is opt-in toggle | Users forget to enable it, lose data | Privacy-first design conflicts with product goals |
| No onboarding flow | New users land on editor with sample data and no guidance | Missing wizard/stepper for first-time users |
| Landing page is generic | Doesn't convey product value, no social proof | Minimal marketing page with 4 static cards |
| Mobile experience is broken | Sidebar behind sheet, preview unusable, header overflows | Desktop-first layout with afterthought responsiveness |
| Too many entry points | `/editor` and `/latex-editor` are separate pages with duplicated logic | Historical code growth without consolidation |
| Section navigation is hidden | Active section shown in a sheet drawer, not visible by default | Sidebar is a sheet on all screen sizes |
| Inconsistent AI feature styling | Mix of `.smart-feature`, `.ai-feature`, `.ai-badge`, `.ai-glow` | Legacy CSS classes not cleaned up |

---

## 2. Core Philosophy & Design Principles

### Design principles for the rebuild

1. **Auth-first, always.** Every user is signed in. No anonymous mode. Simplifies data ownership, sync, and analytics.

2. **Progressive disclosure.** Don't show everything at once. Guide users through a clear flow: context → generation → refinement → export.

3. **Invisible sync.** Cloud sync is automatic and always on. No toggle. No "Visual → LaTeX" buttons. Sync happens behind the scenes.

4. **One screen, clear sections.** The editor is the product. Make it a polished, single-screen experience with a persistent sidebar (desktop) and bottom nav (mobile).

5. **AI is a feature, not the chrome.** AI features should be contextual and inline — not badges and glowing borders everywhere.

6. **Professional minimalism.** Clean, high-contrast, well-spaced. Think Linear/Notion aesthetics, not gradient-heavy gaming UI.

---

## 3. Mandatory Authentication — Gate Everything

### Current behavior
- Landing page (`/`) lets anyone click "Start Building" → goes to `/editor`.
- Sign-in button is small, in the editor header.
- Cloud sync is a toggle that only appears after sign-in.
- The copy literally says "No sign-up required."

### New behavior

```
User visits / → Marketing landing page with "Get Started" CTA
                 ↓
          Click "Get Started"
                 ↓
     Clerk sign-in/sign-up modal (or redirect to /sign-in)
                 ↓
     Authenticated → redirect to /dashboard (new page)
                 ↓
      First time? → Onboarding wizard
      Returning?  → Dashboard with resume list
```

### Implementation

1. **Add Clerk middleware** to protect `/dashboard`, `/editor`, and all app routes.

```
// middleware.ts
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher(['/', '/sign-in(.*)', '/sign-up(.*)']);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});
```

2. **Create `/sign-in` and `/sign-up` pages** using Clerk's `<SignIn>` and `<SignUp>` components with custom styling.

3. **Remove all `<SignedIn>/<SignedOut>` conditional rendering** from the editor. The editor is always authenticated.

4. **Remove the cloud sync toggle entirely.** If you're signed in, your data syncs. Period.

5. **Update landing page copy** to replace "No sign-up required" with a clear value proposition and "Get Started Free" CTA.

---

## 4. Redesigned User Flow (End-to-End)

### Flow diagram

```
┌─────────────────────────────────────────────────────────┐
│  LANDING PAGE (/)                                       │
│  Marketing hero + features + CTA → "Get Started Free"   │
└────────────────────────┬────────────────────────────────┘
                         │ (unauthenticated → Clerk modal)
                         ▼
┌─────────────────────────────────────────────────────────┐
│  DASHBOARD (/dashboard)                                 │
│  - "Create New Resume" card                             │
│  - List of existing resumes (title, last edited, score) │
│  - Quick actions: duplicate, delete, export             │
└────────────────────────┬────────────────────────────────┘
                         │ (click resume or "Create New")
                         ▼
┌─────────────────────────────────────────────────────────┐
│  ONBOARDING (/editor/new) — first-time only             │
│  Step 1: What role are you targeting?                   │
│  Step 2: Paste a job description (optional)             │
│  Step 3: Import from GitHub / LinkedIn / upload (opt.)  │
│  Step 4: Pick a template                                │
│           → Generate initial resume draft               │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  EDITOR (/editor/[id])                                  │
│  ┌──────────┬──────────────────────┬──────────────────┐ │
│  │ Sidebar  │    Editor Panel      │  Live Preview    │ │
│  │          │                      │                  │ │
│  │ Sections │  Form-based editing  │  Real-time PDF   │ │
│  │ ──────── │  per active section  │  rendering       │ │
│  │ Personal │                      │                  │ │
│  │ Exprnce  │  AI suggestions      │                  │ │
│  │ Projects │  appear inline       │                  │ │
│  │ Educatn  │                      │                  │ │
│  │ Skills   │                      │                  │ │
│  │ ──────── │                      │                  │ │
│  │ Tools    │                      │                  │ │
│  │ ATS      │                      │                  │ │
│  │ Copilot  │                      │                  │ │
│  │ LaTeX    │                      │                  │ │
│  │ Export   │                      │                  │ │
│  └──────────┴──────────────────────┴──────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### Key flow changes

| Current | New |
|---|---|
| One unnamed resume, stored in localStorage | Multiple named resumes, stored in DB, listed on dashboard |
| No onboarding — land on editor with sample data | Guided onboarding wizard for first resume |
| Cloud sync is opt-in toggle | Always-on auto-save (debounced, background) |
| Visual/LaTeX are tabs with manual sync buttons | Visual is primary; LaTeX is an "Advanced" tool in sidebar |
| `/editor` and `/latex-editor` are separate pages | Single `/editor/[id]` with LaTeX as a sidebar tool panel |
| ATS score in header badge → sheet | ATS score in sidebar tool panel with inline suggestions |
| Copilot in header button → sheet | Copilot as sidebar tool panel |
| Template selector in toolbar | Template picker in onboarding + accessible via sidebar |

---

## 5. Page-by-Page UI Redesign

### 5.1 Landing Page (`/`)

**Current:** Centered layout, gradient icon, 4 feature cards, "Start Building" button.  
**Problem:** Generic, no differentiation, says "No sign-up required."

**New design:**

```
┌────────────────────────────────────────────────────────┐
│  NAV: Logo          Features  Pricing  Sign In  [CTA]  │
├────────────────────────────────────────────────────────┤
│                                                        │
│  HERO SECTION                                          │
│  ─────────────                                         │
│  "Land your dream job with                             │
│   an AI-tailored resume"                               │
│                                                        │
│  Subtitle: paste a job description, connect GitHub,    │
│  and get a perfectly tailored resume in minutes.       │
│                                                        │
│  [Get Started Free]  [See How It Works]                │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Hero image: app screenshot / animation          │  │
│  │  showing the editor with a live preview           │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
├────────────────────────────────────────────────────────┤
│                                                        │
│  HOW IT WORKS (3 steps)                                │
│  ─────────────                                         │
│  1. Paste job description  →  2. We tailor your resume │
│  →  3. Export & apply                                  │
│                                                        │
├────────────────────────────────────────────────────────┤
│                                                        │
│  KEY FEATURES (grid)                                   │
│  ─────────────                                         │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  │
│  │ ATS     │  │ AI      │  │ GitHub  │  │ LaTeX   │  │
│  │ Scoring │  │ Copilot │  │ Import  │  │ Export  │  │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘  │
│                                                        │
├────────────────────────────────────────────────────────┤
│                                                        │
│  FOOTER: Links, Privacy, Terms                         │
│                                                        │
└────────────────────────────────────────────────────────┘
```

**Key changes:**
- Add a proper navigation bar with Logo, links, and CTA.
- Hero section with compelling copy and an app screenshot/mockup.
- "How It Works" section with 3 clear steps.
- Remove "No sign-up required" copy entirely.
- Add footer with proper links.

### 5.2 Dashboard (`/dashboard`) — NEW PAGE

**Purpose:** Resume management hub. Users see all their resumes and can create new ones.

```
┌────────────────────────────────────────────────────────┐
│  NAV: Logo    Dashboard    [User Avatar + Menu]        │
├────────────────────────────────────────────────────────┤
│                                                        │
│  Welcome back, [Name]                                  │
│                                                        │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐       │
│  │ + Create   │  │ Resume 1   │  │ Resume 2   │       │
│  │   New      │  │ SWE @Goog  │  │ PM @Meta   │       │
│  │  Resume    │  │ Score: 87% │  │ Score: 72% │       │
│  │            │  │ 2 hrs ago  │  │ 3 days ago │       │
│  └────────────┘  └────────────┘  └────────────┘       │
│                                                        │
│  Recent job targets:                                   │
│  ┌──────────────────────────────────────────────┐      │
│  │ Google — Senior SWE      [Create Resume →]  │      │
│  │ Meta — Product Manager   [Create Resume →]  │      │
│  └──────────────────────────────────────────────┘      │
│                                                        │
└────────────────────────────────────────────────────────┘
```

**Features:**
- Card grid of existing resumes with title, target role, ATS score, last edited.
- "Create New Resume" card that launches the onboarding wizard.
- Quick actions on each card: edit, duplicate, delete, export.
- Recent job targets section for quick resume creation.

### 5.3 Onboarding Wizard (`/editor/new`)

**Purpose:** Guided first-resume creation. Collect context before generating.

**Steps:**

| Step | Title | What happens |
|---|---|---|
| 1 | **Target Role** | User enters company name, role title. Optional: paste full job description. |
| 2 | **Your Background** | Quick form: name, email, phone, LinkedIn, years of experience. |
| 3 | **Import Context** | Optional: connect GitHub (public repos) or upload existing resume (PDF parse). |
| 4 | **Pick a Template** | Visual template picker with live thumbnail previews. |
| 5 | **Generate** | Show a progress animation while AI generates the initial tailored draft. |

**Design:** Full-page stepper with progress indicator. Clean, focused, one task per step. Back/Next navigation. Skip where optional.

### 5.4 Editor (`/editor/[id]`) — Complete Redesign

**Current problems to solve:**
- Header has too many controls (home, branding, ATS badge, copilot, preview toggle, export, sync toggle, user button, Visual/LaTeX tabs, template selector, sync buttons, sample data banner).
- Sidebar is hidden behind a sheet on all screen sizes.
- Visual/LaTeX sync buttons are confusing.
- No persistent section navigation.

**New layout:**

```
┌──────────────────────────────────────────────────────────────┐
│  HEADER (slim, 48px)                                         │
│  ← Dashboard   "Resume Title" (editable)   [Export] [Avatar] │
├──────────┬───────────────────────────┬───────────────────────┤
│          │                           │                       │
│ SIDEBAR  │     EDITOR PANEL          │    PREVIEW PANEL      │
│ (220px)  │                           │                       │
│          │  ┌─────────────────────┐  │  ┌─────────────────┐  │
│ SECTIONS │  │                     │  │  │                 │  │
│ ──────── │  │  Active section     │  │  │  Live PDF       │  │
│ Personal │  │  form editor        │  │  │  preview        │  │
│ Exprnce  │  │                     │  │  │                 │  │
│ Projects │  │  AI suggestions     │  │  │                 │  │
│ Educatn  │  │  appear inline      │  │  │                 │  │
│ Skills   │  │  within each field  │  │  │                 │  │
│          │  │                     │  │  │                 │  │
│ TOOLS    │  │                     │  │  │                 │  │
│ ──────── │  │                     │  │  │                 │  │
│ Job Trgt │  │                     │  │  │                 │  │
│ ATS      │  └─────────────────────┘  │  └─────────────────┘  │
│ Copilot  │                           │                       │
│ LaTeX    │                           │  Template: [selector] │
│          │                           │                       │
│ ──────── │                           │                       │
│ Settings │                           │                       │
│          │                           │                       │
└──────────┴───────────────────────────┴───────────────────────┘
```

**Key design decisions:**

1. **Persistent sidebar (desktop).** Visible by default on screens ≥1024px. Collapsible to icon-only mode. On mobile, becomes a bottom tab bar for sections + a hamburger for tools.

2. **Slim header.** Only 4 items: back to dashboard, editable resume title, export button, user avatar. Everything else moves to sidebar.

3. **No Visual/LaTeX tabs in the header.** LaTeX becomes a "tool" in the sidebar. When selected, the editor panel shows the Monaco editor. This is a power-user feature, not a primary tab.

4. **Auto-sync, no sync buttons.** When the user edits in visual mode, LaTeX regenerates automatically in the background (debounced). When the user edits LaTeX directly, visual data updates via AI parse on blur/save. No "Visual → LaTeX" or "LaTeX → Visual" buttons.

5. **Template selector lives in the preview panel header.** Small dropdown, always accessible.

6. **ATS score is a sidebar tool.** Click "ATS Score" in sidebar → editor panel shows the score breakdown with inline suggestions. Not a header badge that opens a sheet.

7. **Copilot is a sidebar tool.** Click "AI Copilot" in sidebar → editor panel shows the copilot interface. Not a header button that opens a sheet.

---

## 6. Component Architecture Cleanup

### Current issues
- `EditorScreen.tsx` is a 964-line god component with 20+ state variables.
- Sheets used for everything (sidebar, ATS, copilot, version history).
- Duplicate template selectors (one in toolbar, one in preview header).
- `/latex-editor` page duplicates editor functionality.

### Proposed component tree

```
src/
├── app/
│   ├── (marketing)/          # Public routes group
│   │   ├── layout.tsx        # Marketing layout with nav/footer
│   │   └── page.tsx          # Landing page
│   ├── (app)/                # Authenticated routes group
│   │   ├── layout.tsx        # App layout with slim header
│   │   ├── dashboard/
│   │   │   └── page.tsx      # Resume dashboard
│   │   └── editor/
│   │       ├── new/
│   │       │   └── page.tsx  # Onboarding wizard
│   │       └── [id]/
│   │           └── page.tsx  # Resume editor
│   ├── sign-in/
│   │   └── [[...sign-in]]/
│   │       └── page.tsx
│   ├── sign-up/
│   │   └── [[...sign-up]]/
│   │       └── page.tsx
│   ├── layout.tsx            # Root layout (ClerkProvider)
│   └── globals.css
├── components/
│   ├── marketing/            # Landing page components
│   │   ├── Navbar.tsx
│   │   ├── Hero.tsx
│   │   ├── HowItWorks.tsx
│   │   ├── Features.tsx
│   │   └── Footer.tsx
│   ├── dashboard/            # Dashboard components
│   │   ├── ResumeCard.tsx
│   │   ├── CreateResumeCard.tsx
│   │   └── RecentTargets.tsx
│   ├── onboarding/           # Wizard components
│   │   ├── OnboardingWizard.tsx
│   │   ├── StepTargetRole.tsx
│   │   ├── StepBackground.tsx
│   │   ├── StepImport.tsx
│   │   ├── StepTemplate.tsx
│   │   └── StepGenerate.tsx
│   ├── editor/               # Editor components (refactored)
│   │   ├── EditorLayout.tsx  # Orchestrator (replaces EditorScreen)
│   │   ├── EditorSidebar.tsx # Persistent sidebar
│   │   ├── EditorHeader.tsx  # Slim header
│   │   ├── PreviewPanel.tsx  # PDF preview + template selector
│   │   ├── sections/         # Section editors
│   │   │   ├── PersonalInfoEditor.tsx
│   │   │   ├── ExperienceEditor.tsx
│   │   │   ├── ProjectsEditor.tsx
│   │   │   ├── EducationEditor.tsx
│   │   │   └── SkillsEditor.tsx
│   │   ├── tools/            # Sidebar tool panels
│   │   │   ├── JobTargetPanel.tsx
│   │   │   ├── ATSScorePanel.tsx
│   │   │   ├── CopilotPanel.tsx
│   │   │   ├── LaTeXPanel.tsx
│   │   │   ├── GitHubImportPanel.tsx
│   │   │   └── SettingsPanel.tsx
│   │   └── shared/           # Shared editor components
│   │       ├── AIRewriteButton.tsx
│   │       ├── InlineSuggestion.tsx
│   │       └── SectionWrapper.tsx
│   └── ui/                   # shadcn components (unchanged)
```

### Component responsibility breakdown

| Component | Responsibility | Max state | Lines target |
|---|---|---|---|
| `EditorLayout.tsx` | Route params, active panel routing, auto-save orchestration | 5-6 state vars | <150 |
| `EditorSidebar.tsx` | Section/tool navigation, collapse state | 2 state vars | <100 |
| `EditorHeader.tsx` | Title editing, export trigger, back nav | 2 state vars | <80 |
| `PreviewPanel.tsx` | Template selection, preview iframe | 1 state var | <60 |
| Each section editor | Its own form state, AI actions for that section | Varies | <200 |
| Each tool panel | Its own tool-specific state | Varies | <200 |

---

## 7. Design System Overhaul

### Current issues
- Aggressive pink-purple-blue gradients everywhere (scrollbar, buttons, text, cards).
- Legacy CSS classes (`.ai-feature`, `.ai-badge`, `.ai-glow`) alongside newer ones (`.smart-feature`, `.feature-badge`).
- Dark-only theme hardcoded in layout.
- Gradient scrollbar thumb is distracting.

### New design direction

**Aesthetic:** Clean, professional, high-contrast dark theme. Inspired by Linear, Vercel Dashboard, and Notion. Subtle accent colors, no rainbow gradients.

### Color system

```css
:root {
  /* Neutral base — clean slate gray */
  --background: 0 0% 4%;         /* Near-black */
  --foreground: 0 0% 95%;        /* Near-white */
  --card: 0 0% 7%;               /* Slightly lifted */
  --card-foreground: 0 0% 95%;
  --muted: 0 0% 12%;
  --muted-foreground: 0 0% 55%;
  --border: 0 0% 14%;

  /* Single accent color — indigo/blue */
  --primary: 238 76% 67%;        /* Indigo-blue */
  --primary-foreground: 0 0% 100%;

  /* Semantic colors */
  --success: 142 71% 45%;        /* Green */
  --warning: 38 92% 50%;         /* Amber */
  --destructive: 0 84% 60%;      /* Red */
}
```

### Typography
- Keep Inter font family.
- Tighten heading weights: use 600 (semibold) for headings, 400 for body.
- Reduce font sizes slightly for a more refined feel.
- Increase letter-spacing on small labels/badges.

### Spacing & Layout
- Use consistent 4px grid (4, 8, 12, 16, 24, 32, 48, 64).
- More generous padding in cards and panels.
- Subtle shadows instead of glowing borders.

### What to remove
- All gradient text (`.gradient-text`) — replace with simple white or accent color.
- Rainbow gradient buttons (`.gradient-btn`) — replace with solid accent color.
- Gradient scrollbar — replace with subtle neutral scrollbar.
- All `.ai-*` and `.smart-*` legacy classes — replace with Tailwind utilities.
- Radial gradient body background — replace with solid or very subtle single-color gradient.
- All animation-heavy effects (`.smart-pulse` keyframes).

### What to add
- Subtle hover states with `transition-colors` (no `transform: translateY`).
- Focus-visible rings using Tailwind's ring utilities.
- Consistent border-radius: `rounded-lg` for cards, `rounded-md` for inputs.
- Skeleton loading placeholders for async content.

---

## 8. State Management Simplification

### Current issues
- `resumeStore.ts` is 550 lines managing everything: resume data, LaTeX, ATS scores, sync state, copilot state.
- Manual Visual↔LaTeX sync tracking with version numbers.
- Cloud sync has its own state (enabled, status, lastSyncedAt) mixed with resume data.

### Proposed store architecture

Split into focused stores:

```
stores/
├── resumeStore.ts        # Resume data only (personal info, experience, etc.)
├── editorStore.ts        # UI state (active section, active tool, sidebar collapsed)
├── previewStore.ts       # LaTeX code, selected template, compilation state
└── syncStore.ts          # Cloud sync status, auto-save orchestration
```

### Key simplifications

1. **Remove manual sync tracking.** No `visualDataVersion`, `latexVersion`, `lastSyncedLatex`, `isOutOfSync()`, `hasVisualChanges()`, `hasLatexChanges()`. Instead: when visual data changes, debounce-regenerate LaTeX automatically. One-way flow: visual → LaTeX (auto). LaTeX editing is an override that parses back on save.

2. **Always-on cloud sync.** Remove `cloudSyncEnabled` toggle, `setCloudSyncEnabled`. If authenticated, sync. The sync store manages debounced auto-save and status display.

3. **Extract copilot state** into a local `useState` within the copilot panel component, or a small dedicated store if needed across components.

4. **Keep Zustand persist** only for `editorStore` (UI preferences like sidebar state). Resume data comes from the server on mount.

---

## 9. Mobile-First Responsive Strategy

### Current: Desktop-only with afterthought mobile

### New approach: Three breakpoints

| Breakpoint | Layout | Navigation |
|---|---|---|
| **Mobile** (<768px) | Single panel, full-width editor. Preview behind a "Preview" tab. | Bottom tab bar with 5 items: sections (dropdown), tools (dropdown), preview, export, menu. |
| **Tablet** (768–1023px) | Two panels: sidebar (collapsed icons) + editor. Preview in a slide-over or tab. | Icon sidebar + editor. Preview toggleable. |
| **Desktop** (≥1024px) | Three panels: sidebar (220px) + editor + preview (40%). | Full sidebar + editor + preview. |

### Mobile-specific decisions

1. **Bottom navigation bar** (56px) with: Sections, Tools, Preview, Export.
2. **Sections and Tools** open as bottom sheets (not side sheets).
3. **Preview** becomes a full-screen overlay with a "Back to Editor" button.
4. **No LaTeX editor on mobile.** It's a power-user feature that requires a real keyboard.
5. **Touch-friendly inputs.** Minimum 44px touch targets. Larger text inputs.

---

## 10. Error Handling & Loading States

### Current issues
- `console.error` in many places with no user feedback.
- Generic "Failed to..." messages.
- No skeleton loading.
- No retry mechanisms.

### Standards to implement

**Loading states:**
- Skeleton components for every async panel (ATS score loading, copilot generating, etc.).
- Button loading states with spinners + disabled state.
- Full-page loading spinner for initial data fetch → replace with skeleton layout.
- Progress indicators for multi-step AI operations.

**Error states:**
- Inline error banners with specific messages and retry buttons.
- Toast notifications for transient errors (network issues, API timeouts).
- Form validation errors shown inline below each field.
- Graceful degradation: if LaTeX compilation fails, still allow editing; show error in preview panel.

**Empty states:**
- Dashboard with no resumes: illustration + "Create your first resume" CTA.
- Editor sections with no data: helpful placeholder text + quick-fill buttons.
- ATS score with no job description: prompt to add one.

**Retry patterns:**
- Auto-retry for cloud sync failures (exponential backoff, 3 attempts).
- Manual retry button for AI operations.
- Offline indicator when no internet connection.

---

## 11. Implementation Phases

### Phase 1: Auth Gate + Route Structure (2-3 days)

**Goal:** Mandatory auth, new route structure, basic dashboard.

| Task | Files | Effort |
|---|---|---|
| Add Clerk middleware for route protection | `middleware.ts` (new) | 1hr |
| Create sign-in/sign-up pages | `src/app/sign-in/`, `src/app/sign-up/` | 1hr |
| Create route groups `(marketing)` and `(app)` | Restructure `src/app/` | 2hr |
| Create basic dashboard page with resume list | `src/app/(app)/dashboard/page.tsx` | 3hr |
| Update Prisma schema for multi-resume support | `prisma/schema.prisma` | 1hr |
| Create resume CRUD server actions | `src/actions/resume.ts` (extend) | 2hr |
| Redirect `/editor` → `/editor/[id]` with param | Route restructure | 1hr |
| Remove "No sign-up required" copy, update landing page | `src/app/(marketing)/page.tsx` | 1hr |

### Phase 2: Landing Page Redesign (1-2 days)

**Goal:** Professional marketing page that converts visitors to sign-ups.

| Task | Files | Effort |
|---|---|---|
| Create `Navbar` component | `src/components/marketing/Navbar.tsx` | 1hr |
| Create `Hero` section | `src/components/marketing/Hero.tsx` | 2hr |
| Create `HowItWorks` section | `src/components/marketing/HowItWorks.tsx` | 1hr |
| Create `Features` grid | `src/components/marketing/Features.tsx` | 1hr |
| Create `Footer` | `src/components/marketing/Footer.tsx` | 1hr |
| Marketing layout with nav + footer | `src/app/(marketing)/layout.tsx` | 1hr |

### Phase 3: Design System Cleanup (1-2 days)

**Goal:** Clean, professional visual identity.

| Task | Files | Effort |
|---|---|---|
| Update CSS variables (new color palette) | `globals.css` | 1hr |
| Remove all gradient/legacy CSS classes | `globals.css` | 1hr |
| Update shadcn component styles if needed | `src/components/ui/*` | 1hr |
| Audit and update all component classNames | All components | 3hr |
| Remove unused icon imports | All components | 1hr |

### Phase 4: Editor Redesign (3-5 days)

**Goal:** Clean, three-panel editor with persistent sidebar.

| Task | Files | Effort |
|---|---|---|
| Create `EditorLayout.tsx` (orchestrator) | New component | 3hr |
| Create `EditorSidebar.tsx` (persistent) | New component | 2hr |
| Create `EditorHeader.tsx` (slim) | New component | 1hr |
| Create `PreviewPanel.tsx` | New component | 1hr |
| Refactor section editors into `sections/` dir | Move + refactor | 2hr |
| Create tool panels (ATS, Copilot, Job Target, LaTeX) | `tools/` dir | 4hr |
| Implement auto Visual→LaTeX sync (remove manual buttons) | Store + effects | 2hr |
| Implement always-on cloud auto-save | Store + effects | 2hr |
| Delete old `EditorScreen.tsx` | Delete | 0.5hr |
| Delete `/latex-editor` page (consolidate into editor) | Delete | 0.5hr |
| Mobile bottom nav + responsive panels | Layout CSS | 3hr |

### Phase 5: Onboarding Wizard (2-3 days)

**Goal:** Guided first-resume creation flow.

| Task | Files | Effort |
|---|---|---|
| Create `OnboardingWizard.tsx` with stepper | New component | 2hr |
| Step 1: Target role form | New component | 1hr |
| Step 2: Personal background form | New component | 1hr |
| Step 3: Import (GitHub / upload) | New component | 2hr |
| Step 4: Template picker with previews | New component | 2hr |
| Step 5: Generation progress + redirect | New component | 2hr |
| Server action: generate initial resume from context | `src/actions/generate.ts` | 3hr |

### Phase 6: Polish & QA (2-3 days)

**Goal:** Production-ready quality.

| Task | Effort |
|---|---|
| Add skeleton loading to all async panels | 2hr |
| Add proper error states with retry | 2hr |
| Add empty states with illustrations | 2hr |
| Accessibility audit (keyboard nav, ARIA labels, contrast) | 3hr |
| Mobile testing and fixes | 3hr |
| Performance audit (bundle size, lazy loading) | 2hr |

---

## 12. File Change Map

### Files to DELETE
- `src/app/latex-editor/page.tsx` — consolidated into editor
- `src/components/builder/EditorScreen.tsx` — replaced by `EditorLayout.tsx`
- `src/components/builder/SectionEditor.tsx` — replaced by sidebar routing
- `src/components/builder/ATSScoreCard.tsx` — replaced by `ATSScorePanel.tsx`
- `src/components/editor/ResumeForm.tsx` — replaced by new layout
- `src/components/editor/ResumeFormSidebar.tsx` — replaced by `EditorSidebar.tsx`
- `src/components/preview/ResumePreview.tsx` — replaced by `PreviewPanel.tsx`

### Files to CREATE
- `middleware.ts`
- `src/app/(marketing)/layout.tsx`
- `src/app/(marketing)/page.tsx`
- `src/app/(app)/layout.tsx`
- `src/app/(app)/dashboard/page.tsx`
- `src/app/(app)/editor/new/page.tsx`
- `src/app/(app)/editor/[id]/page.tsx`
- `src/app/sign-in/[[...sign-in]]/page.tsx`
- `src/app/sign-up/[[...sign-up]]/page.tsx`
- `src/components/marketing/Navbar.tsx`
- `src/components/marketing/Hero.tsx`
- `src/components/marketing/HowItWorks.tsx`
- `src/components/marketing/Features.tsx`
- `src/components/marketing/Footer.tsx`
- `src/components/dashboard/ResumeCard.tsx`
- `src/components/dashboard/CreateResumeCard.tsx`
- `src/components/onboarding/OnboardingWizard.tsx`
- `src/components/onboarding/Step*.tsx` (5 step components)
- `src/components/editor/EditorLayout.tsx`
- `src/components/editor/EditorSidebar.tsx`
- `src/components/editor/EditorHeader.tsx`
- `src/components/editor/PreviewPanel.tsx`
- `src/components/editor/tools/JobTargetPanel.tsx`
- `src/components/editor/tools/ATSScorePanel.tsx`
- `src/components/editor/tools/CopilotPanel.tsx`
- `src/components/editor/tools/LaTeXPanel.tsx`
- `src/components/editor/tools/SettingsPanel.tsx`
- `src/store/editorStore.ts`
- `src/store/previewStore.ts`
- `src/store/syncStore.ts`

### Files to SIGNIFICANTLY MODIFY
- `src/app/globals.css` — full design system overhaul
- `src/store/resumeStore.ts` — split and simplify
- `src/actions/resume.ts` — multi-resume CRUD
- `prisma/schema.prisma` — multi-resume support
- `src/app/layout.tsx` — remove hardcoded dark class, add metadata
- All section editors — move to `components/editor/sections/`, update styling

### Files UNCHANGED
- `src/actions/ai.ts` — server-side AI logic is fine
- `src/actions/copilot.ts` — copilot logic is fine
- `src/actions/github.ts` — GitHub fetch logic is fine
- `src/lib/rateLimit.ts` — rate limiting is fine
- `src/lib/prisma.ts` — Prisma client singleton
- `src/lib/utils.ts` — utility functions
- `src/templates/latex.ts` — LaTeX templates
- `src/components/ui/*` — shadcn components (style updates only via CSS vars)

---

## Summary

This plan transforms the app from a "neat side project" into a "professional SaaS product" by:

1. **Forcing authentication** — every user is known, data is owned, analytics work.
2. **Adding a dashboard** — multi-resume support, clear entry point.
3. **Guided onboarding** — no more landing on sample data with no direction.
4. **Cleaning up the editor** — persistent sidebar, slim header, auto-sync, no confusion.
5. **Professional design** — clean colors, no rainbow gradients, consistent spacing.
6. **Mobile-first** — bottom nav, responsive panels, touch-friendly.
7. **Proper architecture** — split stores, focused components, clear file structure.

Total estimated effort: **12-18 days** for a single developer, with Phase 1-3 delivering the most visible user-facing impact in the first week.
