# Builder Phase 2 — Template Gallery + Design System (Feature Spec)

## Header

| | |
| --- | --- |
| Status | Proposed, blocked on Builder Phase 1 |
| Owner | @jai0651 |
| Last updated | 2026-05-29 |
| Parent plan | [resume-builder-experience-plan.md](./resume-builder-experience-plan.md) |
| Predecessor | [builder-phase-1-free-checker-spec.md](./builder-phase-1-free-checker-spec.md) |
| Successor | Builder Phase 3 (builder craft + AI polish) — not yet specced |
| Downstream dependency | [phase-2-smarter-brain-spec.md](./phase-2-smarter-brain-spec.md) §6.4 — `ResumeTheme` introduced here is consumed by the extension's tailor flow |
| Target duration | ~8 working days |

## 1. Problem Statement
The builder today ships three hardcoded LaTeX templates with a single accent color (`mainblue = #1f4e79`). The `PreviewPanel.tsx` is 36 lines and shows a static rendered PDF. There is no template gallery, no theme model, no design controls, and no way for a user to change the look of their resume short of editing the LaTeX generator.

This contradicts the product principle "the builder is a design tool, not a form." A first-time user converting from the free checker (Builder Phase 1) ends up in a builder that lets them edit content but not how it looks. That's a documents-app, not a design tool.

Builder Phase 2 makes the builder feel like a design tool by introducing a data-driven `ResumeTheme` (template + accent + font + density + section order), a visual template gallery with honest user-data previews, a design control bar in the editor, and a live preview that reflects theme changes near-instantly.

It does **not** rewrite the LaTeX render backend. The existing generators in `src/templates/latex.ts` get parameterized to read theme variables instead of hardcoding them.

This phase also unblocks the extension's Phase 2 tailor flow (`phase-2-smarter-brain-spec.md §6.4`), which inherits `ResumeTheme` from the source resume onto every tailored variant.

## 2. Goals
1. Data-driven `ResumeTheme` model attached to each `Resume`.
2. Refactor `src/templates/latex.ts` so colors, fonts, density, and section order are derived from `ResumeTheme`, not hardcoded.
3. Ship 4 distinct, ATS-parseable templates: clean single-column, modern two-column-aware, classic serif, minimal/whitespace-forward.
4. A visual template gallery where each thumbnail is rendered with the **user's own data** (no lorem ipsum).
5. A design control bar in the editor: accent color (curated palette + custom), font family (curated embeddable set), density, section ordering.
6. A live preview that updates near-instantly on theme changes — without waiting for a full LaTeX recompile per keystroke.
7. Backward-compat for existing resumes: a default `ResumeTheme` is applied during migration, no visual regression.

## 3. Non-Goals
- No new PDF render engine. LaTeX stays.
- No custom CSS / per-section custom styling. The contract is a small, curated set of design knobs, not full themability.
- No template marketplace, no user-uploaded templates.
- No real-time collaborative editing on theme changes.
- No A/B test infrastructure for templates.
- No font upload by the user. We ship a curated, license-cleared set.

## 4. Success Criteria
- [ ] A user can pick from 4 distinct, named templates and see the change reflected in the preview within 2 seconds.
- [ ] A user can change accent color, font family, density, and section order from the editor's design control bar; each change reflects in the preview within 2 seconds.
- [ ] Each thumbnail in the gallery is rendered with the user's own resume data (not placeholder text).
- [ ] Exported PDF for any (template, accent, font, density, section order) combination renders without LaTeX compile errors across 20 representative resumes.
- [ ] All 4 templates pass an ATS-parse smoke (extract back to text via `pdf-parse`, assert presence of name/email/phone/experience headers).
- [ ] Existing resumes load with their assigned default `ResumeTheme` and render identically to pre-migration (verified with snapshot comparison on 3 representative existing resumes).
- [ ] Extension Phase 2 tailor flow inherits `ResumeTheme` from source resume onto generated resume — verified with one end-to-end run.

## 5. User-Facing Experience

### 5.1 Opening a resume in the editor
- Editor renders with current preview based on the resume's `ResumeTheme`.
- New right-side **Design** tab (alongside existing Content tab).
- Design tab contains:
  - Template gallery (4 thumbnails of the user's own resume in each template).
  - Accent color picker (8-12 curated colors + custom hex input).
  - Font picker (4-6 curated families).
  - Density slider (compact / normal / roomy).
  - Section order editor (drag handles to reorder Experience / Projects / Education / Skills / Custom sections).

### 5.2 Changing template
- User clicks a template thumbnail → instant client-side approximate preview update (~200ms) → background server-side LaTeX recompile to final PDF in ~2-4s → preview swaps to the final PDF when ready.
- Subtle "Rendering final PDF..." indicator during the recompile.
- If a user clicks again during recompile, the in-flight job is cancelled and a new one started.

### 5.3 Changing accent color
- Picker shows curated palette (e.g. Patronus Blue, Forest, Burgundy, Slate, Indigo, Sand, Ink) + a "Custom" swatch that opens a hex input.
- Same client-side approximate + server-side definitive flow as template changes.
- Hex input validates and falls back to the previous color on invalid input.

### 5.4 Changing font
- Picker shows 4-6 curated families with a short preview ("AaBbCc") rendered in each.
- Same update flow.

### 5.5 Changing density
- Slider: Compact / Normal / Roomy.
- Affects line height and section spacing in the generated LaTeX.

### 5.6 Reordering sections
- Existing `SectionOrderEditor` (per parent plan) gets wired into `ResumeTheme.sectionOrder`.
- Drag to reorder; preview updates.

### 5.7 Export
- Existing PDF export uses the resume's current `ResumeTheme`.
- Filename pattern unchanged.

### 5.8 First-time discovery
- First time a user opens the new Design tab, a brief onboarding popover highlights the template gallery: "Pick a look. Your resume content stays the same."
- Dismissible.

## 6. Technical Design

### 6.1 `ResumeTheme` model

```ts
type ResumeTheme = {
  templateId: TemplateId;
  accentColor: string;        // hex, e.g. "#1f4e79"
  fontFamily: FontFamilyId;
  density: 'compact' | 'normal' | 'roomy';
  sectionOrder: SectionKey[];  // ordered list of canonical section keys
};

type TemplateId = 'clean_single' | 'modern_two_col_aware' | 'classic_serif' | 'minimal_whitespace';

type FontFamilyId =
  | 'inter'
  | 'source_sans'
  | 'ibm_plex_sans'
  | 'lora'
  | 'merriweather'
  | 'jet_brains_mono';

type SectionKey = 'summary' | 'experience' | 'projects' | 'education' | 'skills' | 'certifications' | 'awards' | 'publications' | 'custom';
```

### 6.2 Data model changes

```prisma
model Resume {
  // ...existing fields
  theme   Json?     // serialized ResumeTheme; null for legacy rows until migration runs
}
```

Storing as `Json` instead of dedicated columns keeps the schema flexible and matches how `content` is stored. Backed by a zod schema for validation at the boundary.

#### 6.2.1 Migration strategy
- Migration 1: add `theme Json?` column (nullable).
- Backfill: a one-shot script (`scripts/backfill-resume-theme.ts`) sets `theme = DEFAULT_THEME` on all rows where `theme IS NULL`.
- After backfill completes, a follow-up migration tightens the column to `Json @default(DEFAULT_THEME_JSON)` so new rows always have a theme.
- `DEFAULT_THEME`:
  ```ts
  const DEFAULT_THEME: ResumeTheme = {
    templateId: 'clean_single',
    accentColor: '#1f4e79',   // matches current mainblue
    fontFamily: 'inter',
    density: 'normal',
    sectionOrder: ['summary', 'experience', 'projects', 'education', 'skills'],
  };
  ```
  This default reproduces today's visual output for `clean_single` and the existing accent color, so existing users see no visual change.

### 6.3 Zod schema

```ts
// src/lib/themeSchemas.ts
export const ResumeThemeSchema = z.object({
  templateId: z.enum(['clean_single', 'modern_two_col_aware', 'classic_serif', 'minimal_whitespace']),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  fontFamily: z.enum(['inter', 'source_sans', 'ibm_plex_sans', 'lora', 'merriweather', 'jet_brains_mono']),
  density: z.enum(['compact', 'normal', 'roomy']),
  sectionOrder: z.array(z.enum(['summary', 'experience', 'projects', 'education', 'skills', 'certifications', 'awards', 'publications', 'custom'])).min(1),
});
```

Validation happens at any API boundary that accepts a theme. Internal code trusts the type.

### 6.4 LaTeX generator refactor

Current state: `src/templates/latex.ts` has 489 lines with multiple hardcoded `\definecolor` and font-family declarations. Recipes per template exist as separate functions.

#### 6.4.1 New shape
```text
src/templates/
  index.ts                   # exports renderResume(resumeData, theme) entry
  latexBase.ts               # common preamble pieces (hyperref, geometry, glyphs)
  themeToLatex.ts            # theme → preamble fragments (color, font, density)
  templates/
    cleanSingle.ts           # template-specific body layout
    modernTwoColAware.ts
    classicSerif.ts
    minimalWhitespace.ts
  sections/
    summary.ts
    experience.ts
    projects.ts
    education.ts
    skills.ts
    certifications.ts
    awards.ts
    publications.ts
    custom.ts
```

`renderResume(resumeData, theme)` composes:
1. Common preamble.
2. Theme-driven preamble fragments (color, font, density).
3. Template-driven body layout (which determines whether sections render full-width or split).
4. Section renderers, ordered by `theme.sectionOrder`.

Hardcoded `mainblue` is replaced with `\\definecolor{accent}{HTML}{${theme.accentColor.slice(1)}}` and references swap from `mainblue` → `accent`. Existing function bodies that reference colors via interpolation get updated.

#### 6.4.2 Font handling
Templates pull from a curated `FONT_REGISTRY`:
```ts
const FONT_REGISTRY: Record<FontFamilyId, FontFamilyDef> = {
  inter:        { latexFamily: 'Inter', usepackage: '\\setmainfont{Inter}', textmode: 'sans' },
  source_sans:  { latexFamily: 'Source Sans Pro', usepackage: '\\setmainfont{Source Sans Pro}', textmode: 'sans' },
  ibm_plex_sans:{ latexFamily: 'IBM Plex Sans', usepackage: '\\setmainfont{IBM Plex Sans}', textmode: 'sans' },
  lora:         { latexFamily: 'Lora', usepackage: '\\setmainfont{Lora}', textmode: 'serif' },
  merriweather: { latexFamily: 'Merriweather', usepackage: '\\setmainfont{Merriweather}', textmode: 'serif' },
  jet_brains_mono: { latexFamily: 'JetBrains Mono', usepackage: '\\setmainfont{JetBrains Mono}', textmode: 'mono' },
};
```

Render uses `xelatex` (or `lualatex`) to enable `\\setmainfont`. If today's pipeline is `pdflatex`, this is a render-engine swap — see Open Question 1.

All fonts are SIL-OFL or OFL-compatible licenses, embeddable in PDF without restriction.

#### 6.4.3 Density
Density translates to `\\linespread` and section spacing constants:
```ts
const DENSITY: Record<ResumeTheme['density'], { linespread: number; sectionSkip: string }> = {
  compact: { linespread: 0.95, sectionSkip: '6pt' },
  normal:  { linespread: 1.05, sectionSkip: '10pt' },
  roomy:   { linespread: 1.20, sectionSkip: '14pt' },
};
```

#### 6.4.4 Templates
Each template module exports:
```ts
export type TemplateModule = {
  id: TemplateId;
  name: string;
  description: string;
  thumbnailHints: { columns: 1 | 2; serif: boolean; accentUsage: 'subtle' | 'medium' | 'bold' };
  renderBody(resume: ResumeData, theme: ResumeTheme): string;
};
```

##### `cleanSingle`
- Single column.
- Compact section headers with accent color, uppercase, bold.
- Highly ATS-parseable.
- Matches today's primary look.

##### `modernTwoColAware`
- Left column ~30% width: contact, skills, links.
- Right column ~70%: summary, experience, projects, education.
- The "two-col aware" matters because some ATSes choke on multi-column. We use LaTeX's `\\columnbreak` carefully and keep the headers in a parseable order. The fallback test (§9.1.5) confirms ATS extraction still finds all sections.

##### `classicSerif`
- Single column with serif font defaulting (`lora` or `merriweather`).
- Smaller accent footprint (rules under section headers, no color blocks).
- Conservative, mature.

##### `minimalWhitespace`
- Single column.
- More generous whitespace, lighter accent usage.
- Smaller font sizes, more roomy density baseline.

#### 6.4.5 Section order
`theme.sectionOrder` drives the ordering of rendered sections. If a section key has no data in the resume, it is skipped silently. Sections not in `sectionOrder` are not rendered — explicitly opting in is the contract.

### 6.5 Live preview architecture

The preview needs to feel instant on theme changes but the LaTeX render takes 2-4s. Two-tier rendering:

#### 6.5.1 Tier 1: client-side approximate preview
A lightweight web preview rendered in the editor (not a PDF). Uses HTML/CSS that approximates the LaTeX output:
- Same fonts (loaded via Google Fonts or local @font-face).
- Same accent color.
- Same density (line-height / margin maps).
- Same section order.
- Same template layout (two-col vs single-col CSS grid).

Implemented as a React component `<ApproximatePreview resume={...} theme={...} />` that takes ~150ms to render and reflects theme changes instantly.

It is **not** pixel-perfect with the PDF. It is good enough to give immediate feedback. A subtle banner says "Preview approximate — final PDF rendered in background."

#### 6.5.2 Tier 2: server-side definitive PDF
On each theme change (debounced 800ms), the server compiles a new PDF via the existing render pipeline. When ready, the preview swaps from the approximate HTML to the PDF embed (using `<embed>` or `<iframe>` of the PDF blob URL).

#### 6.5.3 Render endpoint
`POST /api/resume/:id/render` already exists or is added; it takes the current resume + theme and returns a PDF URL. We treat this as the preview endpoint too. Cached server-side by `(resumeHash, themeHash)` for 5 minutes — repeated identical previews are free.

#### 6.5.4 Cancellation
The `<PreviewPanel>` keeps an `AbortController` per in-flight render. New theme change → abort previous → start new. The server cancels in-flight LaTeX compilation when the request is aborted.

### 6.6 Template gallery thumbnails

Thumbnails are **real renders** of the user's own resume, not static images. Why: an honest preview converts. A user seeing their resume in the gallery picks better and trusts the choice.

#### 6.6.1 Strategy
- Lazy-render thumbnails as the user opens the Design tab.
- For each of 4 templates, request a render at `width=200, dpi=72` (small, fast).
- Cache server-side per `(resumeHash, templateId)` for 1 hour.
- First gallery open may take ~10s total (4 renders, parallel). Subsequent opens are instant from cache.

#### 6.6.2 Concurrency
Server-side render queue uses the existing `generationQueue.ts` patterns if available; otherwise a small Upstash-backed queue with concurrency=2 to avoid LaTeX server overload.

#### 6.6.3 Fallback
If a thumbnail render fails (e.g. font missing on the LaTeX server), the gallery shows a placeholder card with the template's `thumbnailHints` rendered as a static illustration plus "Preview unavailable — pick to try."

### 6.7 Design control bar

`<DesignControlBar>` component in the editor, vertical layout on desktop, collapsible on narrow viewports.

#### 6.7.1 Sub-components
- `<TemplateGallery>`: grid of 4 thumbnails.
- `<AccentColorPicker>`: curated swatch grid + custom hex.
- `<FontPicker>`: dropdown or radio group.
- `<DensitySlider>`: 3-position slider.
- `<SectionOrderEditor>`: existing component, now wired to `ResumeTheme.sectionOrder`.

#### 6.7.2 State management
The editor's existing state (Zustand store) gains a `theme` slice with:
- `theme: ResumeTheme`
- `setTemplate(id)`, `setAccent(hex)`, `setFont(id)`, `setDensity(d)`, `setSectionOrder(order)`
- All setters debounce-persist to the backend via `PATCH /api/resume/:id` and trigger preview re-render.

#### 6.7.3 Optimistic UI
Setters update the store immediately so the approximate preview re-renders without waiting for the server.

### 6.8 API additions

| Route | Method | Purpose |
| --- | --- | --- |
| `PATCH /api/resume/:id` | PATCH | Existing route extended to accept `theme` field |
| `POST /api/resume/:id/render` | POST | Render resume to PDF with current or provided theme; cached |
| `POST /api/resume/:id/thumbnails` | POST | Pre-render gallery thumbnails for current resume |

All authenticated as the resume owner.

### 6.9 Extension coordination

When the extension Phase 2 tailor flow generates a new resume from this user's source resume, it must:
1. Read the source resume's `theme`.
2. Pass the same `theme` (or a copy) onto the new generated `Resume` row.
3. The extension's `ResumePicker` (extension Phase 2 §6.4.4) reads the theme and shows the theme chip.

This is enforced server-side in the extension's tailor route — the new resume row inherits theme atomically with content insertion. The extension does not need to know about theme details, only that it copies forward.

## 7. UI Spec

### 7.1 Design tab layout
```
+--------------------------------+
| Templates                      |
| [thumb] [thumb]                |
| [thumb] [thumb]                |
+--------------------------------+
| Accent color                   |
| ● ● ● ● ● ● ●  + Custom        |
+--------------------------------+
| Font                           |
| ( ) Inter      Aa              |
| ( ) Lora       Aa              |
| ...                            |
+--------------------------------+
| Density                        |
| Compact  o——●——o  Roomy        |
+--------------------------------+
| Section order                  |
| ≡ Experience                   |
| ≡ Projects                     |
| ≡ Education                    |
| ...                            |
+--------------------------------+
```

### 7.2 Thumbnails
- 200×283 (A4 aspect).
- Slight hover lift; selected state has a 2px accent border.
- Template name label below.
- "Selected" pill on the currently active template.

### 7.3 Approximate preview banner
- Small muted strip across the top of the preview: "Approximate preview — final PDF rendering..."
- Disappears when the final PDF is ready.

### 7.4 Empty / error states
- Thumbnail render error → static placeholder with "Try selecting".
- PDF render error → preview pane shows the last good PDF with a small warning toast "Couldn't render preview — your last good preview shown."

## 8. Implementation Plan

| # | Task | Est. | Depends on |
| --- | --- | --- | --- |
| BP2.1 | Define `ResumeTheme` type + zod schema + `DEFAULT_THEME` | 2h | — |
| BP2.2 | Prisma migration: add `theme Json?` to Resume | 1h | BP2.1 |
| BP2.3 | Backfill script `scripts/backfill-resume-theme.ts` + tighten migration | 3h | BP2.2 |
| BP2.4 | Refactor `src/templates/latex.ts` into the new `src/templates/` shape | 1d | BP2.1 |
| BP2.5 | Implement `themeToLatex.ts` (color, font, density preamble generation) | 4h | BP2.4 |
| BP2.6 | Implement `cleanSingle` template (port from existing, fully theme-aware) | 4h | BP2.5 |
| BP2.7 | Implement `modernTwoColAware` template + ATS-parse smoke test | 1d | BP2.6 |
| BP2.8 | Implement `classicSerif` template | 4h | BP2.6 |
| BP2.9 | Implement `minimalWhitespace` template | 4h | BP2.6 |
| BP2.10 | Set up `xelatex` font support in render pipeline (or confirm existing) | 4h | BP2.5 |
| BP2.11 | Update `PATCH /api/resume/:id` to accept `theme` | 2h | BP2.2 |
| BP2.12 | Implement `POST /api/resume/:id/render` with theme-aware caching | 4h | BP2.4 |
| BP2.13 | Implement `POST /api/resume/:id/thumbnails` with concurrent rendering + cache | 4h | BP2.12 |
| BP2.14 | `<ApproximatePreview>` React component (HTML/CSS approximation) | 1d | BP2.1 |
| BP2.15 | Rewrite `<PreviewPanel>` to use two-tier rendering | 4h | BP2.14 |
| BP2.16 | `<TemplateGallery>` component + lazy thumbnail fetching | 4h | BP2.13 |
| BP2.17 | `<AccentColorPicker>`, `<FontPicker>`, `<DensitySlider>` | 4h | BP2.1 |
| BP2.18 | Wire `<SectionOrderEditor>` to `theme.sectionOrder` | 2h | BP2.1 |
| BP2.19 | `<DesignControlBar>` assembly + Design tab in editor | 4h | BP2.16, BP2.17, BP2.18 |
| BP2.20 | Editor state slice for `theme` with optimistic updates | 4h | BP2.11 |
| BP2.21 | Telemetry events for template/accent/font/density/order changes | 2h | BP2.20 |
| BP2.22 | Snapshot tests: 3 existing real resumes pre/post migration produce identical PDFs | 4h | BP2.4, BP2.6 |
| BP2.23 | ATS-parse round-trip tests for all 4 templates | 4h | BP2.7, BP2.8, BP2.9 |
| BP2.24 | Manual QA on 5 real resumes across all theme dimensions | 1d | BP2.19 |
| BP2.25 | Coordinate with extension Phase 2: confirm tailor flow inherits theme | 2h | BP2.11 |
| BP2.26 | Update build status doc | 30m | BP2.24 |

Total estimate: ~8 working days.

### 8.1 Sequencing recommendation
- Day 1: BP2.1 → BP2.2 → BP2.3 (foundations + safe migration path).
- Day 2: BP2.4 → BP2.5 (LaTeX refactor — biggest risk, do early).
- Day 3: BP2.6 → BP2.7 (port + first new template with ATS validation).
- Day 4: BP2.8 → BP2.9 → BP2.10 (remaining templates + font pipeline).
- Day 5: BP2.11 → BP2.13 (API surface).
- Day 6: BP2.14 → BP2.16 (UI scaffolds).
- Day 7: BP2.17 → BP2.21 (controls + state + telemetry).
- Day 8: BP2.22 → BP2.26 (tests + QA + coordinate + ship).

## 9. Testing Strategy

### 9.1 Unit
- `ResumeThemeSchema` validation table.
- `themeToLatex` mapping: input theme → exact LaTeX fragment substrings expected.
- Default-theme migration: function produces identical bytes for a known input resume across pre/post migration code paths.

### 9.2 Integration
- Render every (template × density × fontFamily × accentColor sample) combination from a small matrix; assert no LaTeX errors. ~24 combinations.
- Thumbnail render concurrency: 4 simultaneous requests do not deadlock or exceed memory ceilings.

### 9.3 ATS-parse round-trip (BP2.23)
For each template:
- Render a known sample resume.
- Pass the PDF back through `pdfParser.ts`.
- Assert: name, email, phone, all experience titles, all section headers extract back as readable text.

### 9.4 Snapshot regression (BP2.22)
- 3 real resumes pre/post migration produce byte-identical PDFs in `clean_single` template at default theme.
- This proves migration safety for existing users.

### 9.5 Manual QA (BP2.24)
- 5 real resumes (varied length, varied content).
- For each resume:
  - Switch through all 4 templates, all 4-6 fonts, 3 densities, 7+ accent colors.
  - Verify preview updates within 2s.
  - Export final PDF and visually inspect.
  - Run extracted PDF through `pdf-parse` and confirm core data extracts cleanly.
- Edge case: a resume with a custom section. Verify section ordering edit works.

## 10. Rollout

### 10.1 Migration order
1. Ship `theme Json?` migration.
2. Ship the LaTeX refactor reading from theme (default theme makes this a no-op for legacy rows).
3. Ship backfill script to populate `theme` on legacy rows.
4. Ship the new Design tab UI.

This order means at no point is the system in a broken state — legacy rows render correctly even before the backfill runs (the renderer treats `theme = null` as `DEFAULT_THEME`).

### 10.2 Feature flag
`RESUME_THEME_UI_ENABLED` gates the Design tab. The data model and renderer ship regardless (they need to be on so the extension tailor flow can pass theme through), but the UI is flagged so we can ship the backend and UI on different days.

### 10.3 Extension Phase 2 readiness
This phase is complete when the extension's Phase 2 owner can confirm:
- A new resume row created via the extension's tailor route receives a `theme` matching the source resume.
- The extension's `ResumePicker` reads `theme.templateId` and `theme.accentColor` from the resume row to display the theme chip.

A 30-minute integration call (BP2.25) verifies this.

## 11. Open Questions
1. **Render engine.** Today's pipeline may be `pdflatex`. To support custom fonts (`\\setmainfont`), we need `xelatex` or `lualatex`. Confirm during T BP2.10. If a swap is needed, that's a bigger lift; budget +2 days.
2. **Font licensing audit.** All listed fonts are OFL/SIL-cleared. Confirm with the file headers of the actual font files before shipping. Document the audit in `docs/font-licensing.md`.
3. **Thumbnail rendering cost.** 4 thumbnails per gallery open is ~4× the per-resume LaTeX cost. If users open the Design tab repeatedly, cache hits should dominate. Monitor in production.
4. **"Custom hex" accent input.** Validation rejects malformed input, but we should also enforce a minimum contrast against background to keep PDFs accessible. Spike during T BP2.17; punt full WCAG compliance to a later phase.
5. **`sectionOrder` for legacy resumes with unknown sections.** Some legacy resumes have a `custom` section with a user-defined name. Section order treats `custom` as a single bucket today. Decide whether to support multiple custom sections in the order — recommendation: yes, with `custom:<name>` keys.
6. **Two-column template + ATS reality check.** Some ATSes (Workday's parser, Greenhouse's) handle two-column resumes well; others (older Taleo) do not. Document that `modern_two_col_aware` is "modern ATS-safe but check your target system" in the gallery copy. Don't oversell.
7. **Approximate preview drift.** The HTML approximation will never match the LaTeX PDF perfectly. How close is close enough? Aim: section ordering correct, fonts close enough, color exact, density approximately matched.

## 12. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| LaTeX refactor breaks existing resumes | Medium | High | Snapshot regression test (BP2.22). Default theme reproduces today's output exactly. |
| `xelatex` swap breaks server build | Medium | High | Confirm engine version early (BP2.10). Containerized render server keeps the swap isolated. |
| Render server overload from thumbnails | Medium | Medium | Concurrency cap 2 per user. Server-side cache. Per-resume cache invalidates only on theme/content change. |
| Approximate preview misleads users | Medium | Low | "Approximate preview" banner explicit. Final PDF always rendered in background and shown when ready. |
| Font missing on render server | Low | Medium | Font files installed via Dockerfile / explicit registration. Server boot fails fast if a font is missing. |
| User picks wild accent color, PDF unreadable | Low | Low | Visual contrast not enforced in Phase 2. Document as a limitation; address later. |
| Migration backfill takes too long | Low | Low | Default-theme renderer handles null `theme` natively, so the backfill is not on the critical path. |
| Section reorder corrupts content | Low | High | `sectionOrder` is purely presentational. Content lives in `Resume.content` and is untouched by reorder. Test confirms PDFs differ only in order, not in section bodies. |

## 13. References
- [resume-builder-experience-plan.md](./resume-builder-experience-plan.md)
- [builder-phase-1-free-checker-spec.md](./builder-phase-1-free-checker-spec.md)
- [phase-2-smarter-brain-spec.md](./phase-2-smarter-brain-spec.md) §6.4 — consumes the `ResumeTheme` model defined here
- Existing code: `src/templates/latex.ts`, editor at `src/app/(app)/editor/[id]/`, `PreviewPanel.tsx`, `SectionOrderEditor`
- OFL license: https://scripts.sil.org/OFL
- `xelatex` font setup: https://en.wikibooks.org/wiki/LaTeX/Fonts
