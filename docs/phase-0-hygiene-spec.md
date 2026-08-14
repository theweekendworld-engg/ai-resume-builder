# Phase 0 — Pre-Rewrite Hygiene (Feature Spec)

## Header

| | |
| --- | --- |
| Status | Proposed |
| Owner | @jai0651 |
| Last updated | 2026-05-29 |
| Parent plan | [one-stop-platform-plan.md](./one-stop-platform-plan.md) |
| Successors | [phase-1-extension-rewrite-spec.md](./phase-1-extension-rewrite-spec.md) |
| Target duration | ~2 working days |

## 1. Problem Statement
Three coupled robustness fixes are sitting uncommitted in the working tree (`extension/parsers/utils.js`, `src/lib/extension/schemas.ts`, `src/lib/config.ts`). They are a coherent fix for a real bug: when the DOM reducer ran against `document.body` as a root, it produced an empty `elementPath`, which then failed schema validation when the page payload was POSTed to `/api/extension/page/analyze`.

Separately, Phase 1 is about to port the entire parser pipeline from JavaScript to TypeScript and restructure the extension into a Vite + React build. There is no parser test suite today. Doing a large refactor on an untested pipeline is unsafe — a regression in `jd-extractor.js` could silently downgrade JD confidence on every page and we would not notice until users reported it.

Phase 0 closes both gaps before Phase 1 starts.

## 2. Goals
1. Land the three in-flight fixes as one focused commit with regression tests for each.
2. Stand up a parser fixture test suite that exercises the full pipeline against four sanitized HTML snapshots (LinkedIn Easy Apply, Greenhouse, Lever, Workday step 1).
3. Wire those tests into the existing `bun test` script and CI so the Phase 1 branch cannot land a parser regression undetected.
4. Update `browser-extension-build-status.md` to reflect the new phase.

## 3. Non-Goals
- No parser behavior changes beyond the three fixes already in flight.
- No port to TypeScript. That is Phase 1.
- No new parser features, no new adapters, no schema additions.
- No CI infrastructure rework. We use whatever CI is already configured for the existing `bun test` invocations. If no CI is configured today, we add a single GitHub Actions workflow file; we do not redesign the org's CI.

## 4. Success Criteria
- [ ] Working tree clean: `git status` shows zero modified files at the end of the phase.
- [ ] `bun test` runs and passes locally, including the new extension parser tests.
- [ ] CI run on the merge commit shows the new extension tests executing and green.
- [ ] Four fixture HTML files exist under `extension/__fixtures__/` with assertions covering, at minimum: detected platform, detected page kind, JD presence and minimum text length, total field count within an expected range, and high-confidence semantic mapping for `email` and `full_name` (or `first_name` + `last_name`) on application form fixtures.
- [ ] `docs/browser-extension-build-status.md` lists Phase 0 as complete with each deliverable checked off.

## 5. The Three In-Flight Fixes (in scope, code already drafted)

### 5.1 `extension/parsers/utils.js` — `getElementPath` body/html guard
**Bug.** `getElementPath` walks up the parent chain and builds a `tagname:nth-of-type` path. When called on `document.body` or `document.documentElement`, the loop terminates immediately and returns an empty string, because the function only appends when there is a parent.

**Fix (already in the working tree).** Add early returns:
```js
if (element === document.body) return 'body';
if (element === document.documentElement) return 'html';
```

**Regression test to add.** A small Bun test that imports `getElementPath` (or invokes it via the parser module entry point) under a JSDOM environment and asserts the body/html paths come back as strings of length ≥ 1.

### 5.2 `src/lib/extension/schemas.ts` — `elementPath` empty-string coercion
**Bug.** Even with the parser fix above, older extension installs in the wild may still send empty `elementPath` strings until users update. The backend should accept and coerce rather than 400.

**Fix (already in the working tree).** `ExtensionReducedRegionSchema.elementPath` becomes a `z.preprocess` that maps blank strings to `'body'` before applying the `min(1).max(5000)` constraint.

**Regression test to add.** Append to `src/lib/extension/schemas.test.ts`:
- valid payload with `elementPath: ''` parses successfully and `elementPath` is `'body'` in the parsed output.
- valid payload with `elementPath: '   '` (whitespace) parses successfully and `elementPath` is `'body'`.
- valid payload with a real selector path is unchanged after parsing.

### 5.3 `src/lib/config.ts` — embedding size resolution
**Bug.** Embedding size was a literal `Number(process.env.OPENAI_EMBEDDING_SIZE || 3072)`. When the env var was set to an empty string or a non-numeric value, `Number('')` returns `0`, which would later cause downstream vector store inserts to fail with confusing errors.

**Fix (already in the working tree).** Extract `resolveEmbeddingSize(model, override)` that:
- returns a positive parsed override when present
- otherwise returns a model-specific default (`text-embedding-3-small` → 1536, `text-embedding-3-large` → 3072, `text-embedding-ada-002` → 1536)
- defaults to 3072 for unknown models

**Regression test to add.** New file `src/lib/config.test.ts`:
- `resolveEmbeddingSize('text-embedding-3-small', undefined)` → 1536
- `resolveEmbeddingSize('text-embedding-3-large', undefined)` → 3072
- `resolveEmbeddingSize('text-embedding-3-small', '')` → 1536 (blank override ignored)
- `resolveEmbeddingSize('text-embedding-3-small', 'not-a-number')` → 1536 (invalid override ignored)
- `resolveEmbeddingSize('text-embedding-3-small', '768')` → 768 (valid override honored)
- `resolveEmbeddingSize('some-future-model', undefined)` → 3072 (fallback)

The test file must not import or initialize the full `config` object (which reads `process.env.OPENAI_API_KEY`); it should import `resolveEmbeddingSize` directly. That requires exporting it from `config.ts` — either as a named export, or by extracting it into a small helper file and re-exporting. Recommended: export it as a named export from `config.ts` directly, with a comment that it is exported for testing.

## 6. Parser Fixture Test Suite

### 6.1 Why this matters
The parser pipeline has six modules (`page-classifier`, `dom-reducer`, `jd-extractor`, `field-detector`, `utils`, `index`) totaling ~1,000 lines. Phase 1 ports every one of those to TypeScript and inevitably reshapes the call surface. A pure unit-test suite is not enough because the bugs we care about are emergent — they only show up when the whole pipeline runs end-to-end against a realistic DOM. Hence: fixture-based integration tests.

### 6.2 Test runner choice
Use `bun test` to stay consistent with the rest of the codebase. Bun's test runner has a built-in happy-dom-compatible environment via `--preload`. The simplest setup uses `happy-dom` as the DOM environment (already a transitive of next or installable directly) and a small bootstrap file that creates a fresh document per test.

Alternative considered: Playwright. Rejected for this phase because we want fast unit-style tests, not a browser harness. Playwright is appropriate later for end-to-end side-panel testing in Phase 1.

### 6.3 Directory layout
```text
extension/
  __fixtures__/
    README.md
    linkedin-easy-apply.html
    linkedin-easy-apply.expected.json
    greenhouse-standard.html
    greenhouse-standard.expected.json
    lever-multi-step.html
    lever-multi-step.expected.json
    workday-step-1.html
    workday-step-1.expected.json
  __tests__/
    parsers/
      pipeline.fixture.test.js
      utils.test.js
```

`__fixtures__/README.md` documents how each fixture was captured (date, URL category — never the actual URL or PII, scrubbing steps applied).

### 6.4 Fixture capture and sanitization rules
Each `.html` fixture is a sanitized snapshot of a real ATS page. Sanitization rules, to be applied by hand once per fixture:
1. Replace all human names, emails, phone numbers with placeholder values (`Jane Doe`, `jane.doe@example.com`, `+1-555-0100`).
2. Replace all company-identifying URLs in JSON-LD or hidden form data with `example.com`.
3. Strip `<script>`, `<noscript>`, and `<style>` content except where the test depends on the presence of a tag.
4. Strip analytics pixels, beacons, and embedded tracking iframes.
5. Keep all visible job-description text. Keep all form labels, placeholders, ARIA attributes, and required markers.
6. Keep the original tag hierarchy and class names so adapter heuristics still match.
7. File size limit: 500 KB per fixture. If a snapshot exceeds this, prune sidebars and recommendation cards (not the form or JD).

### 6.5 Expected-output schema
Each fixture has a sibling `.expected.json` describing what the parser must produce. Shape:
```json
{
  "platform": "greenhouse",
  "pageKind": "application_form",
  "jobDescription": {
    "present": true,
    "minTextLength": 800,
    "mustContainKeywords": ["responsibilities", "qualifications"]
  },
  "metadata": {
    "companyNameContains": "Example",
    "roleTitleContains": "Engineer"
  },
  "fields": {
    "minCount": 8,
    "maxCount": 30,
    "semanticKeysPresent": ["email", "first_name", "last_name", "resume_upload"],
    "highConfidenceSemanticKeys": ["email"]
  },
  "questions": {
    "minCount": 0
  }
}
```

`expected.json` is intentionally tolerant. We assert `mustContain` and ranges, not exact strings, because parsers improve over time and we do not want to lock in a specific text extraction artifact.

### 6.6 Pipeline harness
`extension/__tests__/parsers/pipeline.fixture.test.js`:
```js
import { describe, test, expect, beforeEach } from 'bun:test';
import { Window } from 'happy-dom';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Load parser modules. They expect `document`/`window` globals.
function loadParsers(window) {
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Element = window.Element;
  globalThis.Node = window.Node;
  // The current parser files attach to `window.PatronusParsers`.
  // Source them via fs+eval so we don't need a bundler in Phase 0.
  const root = new URL('../../parsers/', import.meta.url).pathname;
  for (const file of [
    'utils.js',
    'page-classifier.js',
    'dom-reducer.js',
    'jd-extractor.js',
    'field-detector.js',
    'index.js',
  ]) {
    const code = readFileSync(join(root, file), 'utf8');
    // The parsers use IIFE form attaching to window.PatronusParsers.
    // Evaluating in the same global context populates that namespace.
    // eslint-disable-next-line no-new-func
    new Function(code).call(globalThis);
  }
  return globalThis.window.PatronusParsers;
}

const fixturesDir = new URL('../../__fixtures__/', import.meta.url).pathname;

const fixtures = readdirSync(fixturesDir)
  .filter(f => f.endsWith('.html'))
  .map(f => f.replace(/\.html$/, ''));

describe('parser pipeline against ATS fixtures', () => {
  for (const name of fixtures) {
    test(name, () => {
      const html = readFileSync(join(fixturesDir, `${name}.html`), 'utf8');
      const expected = JSON.parse(
        readFileSync(join(fixturesDir, `${name}.expected.json`), 'utf8')
      );

      const window = new Window({ url: 'https://example.com/' });
      window.document.documentElement.innerHTML = html;
      const parsers = loadParsers(window);

      const result = parsers.parseCurrentPage(window.document);

      expect(result.platform).toBe(expected.platform);
      expect(result.pageKind).toBe(expected.pageKind);

      if (expected.jobDescription.present) {
        expect(result.jobDescription).toBeTruthy();
        expect(result.jobDescription.text.length).toBeGreaterThanOrEqual(
          expected.jobDescription.minTextLength
        );
        for (const kw of expected.jobDescription.mustContainKeywords) {
          expect(result.jobDescription.text.toLowerCase()).toContain(kw);
        }
      }

      if (expected.metadata?.companyNameContains) {
        expect(result.metadata?.companyName ?? '').toContain(
          expected.metadata.companyNameContains
        );
      }
      if (expected.metadata?.roleTitleContains) {
        expect(result.metadata?.roleTitle ?? '').toContain(
          expected.metadata.roleTitleContains
        );
      }

      expect(result.fields.length).toBeGreaterThanOrEqual(expected.fields.minCount);
      expect(result.fields.length).toBeLessThanOrEqual(expected.fields.maxCount);

      const keys = new Set(result.fields.map(f => f.semanticKey).filter(Boolean));
      for (const k of expected.fields.semanticKeysPresent) {
        expect(keys.has(k)).toBe(true);
      }
      const highKeys = new Set(
        result.fields
          .filter(f => f.confidence?.band === 'high')
          .map(f => f.semanticKey)
          .filter(Boolean)
      );
      for (const k of expected.fields.highConfidenceSemanticKeys) {
        expect(highKeys.has(k)).toBe(true);
      }

      expect(result.questions.length).toBeGreaterThanOrEqual(
        expected.questions.minCount
      );
    });
  }
});
```

This harness is deliberately framework-light. It runs the existing JS parsers as-is, in a happy-dom global context. Phase 1 will replace this harness with a proper imported TS module; the fixtures stay.

### 6.7 Initial fixture set
| Fixture | Source category | Why |
| --- | --- | --- |
| `greenhouse-standard.html` | Greenhouse hosted form on `boards.greenhouse.io/<company>` | Standard, predictable labels. Easiest baseline. |
| `lever-multi-step.html` | Lever job apply page | Different label conventions, common second platform. |
| `linkedin-easy-apply.html` | LinkedIn Easy Apply modal HTML (snapshot of the modal DOM only) | Modal-as-form pattern, tests modal preference in DOM reducer. |
| `workday-step-1.html` | Workday step 1 (My Information) | Iframed forms, complex labels, tests Workday adapter. |

Each fixture also has a sibling `.expected.json` with the assertions above.

### 6.8 Test commands
Add to `package.json`:
```json
{
  "scripts": {
    "test": "bun test",
    "test:extension": "bun test extension/__tests__/"
  }
}
```

`test:extension` is the focused command developers run locally during parser changes. CI runs the full `test`.

## 7. CI Integration

### 7.1 Minimum viable CI
If the repo does not already have CI configured for `bun test`, add `.github/workflows/test.yml`:
```yaml
name: test
on:
  push:
    branches: [main]
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: '1.3.1'
      - run: bun install --frozen-lockfile
      - run: bun test
```

If CI already exists for `bun test`, no change is needed; the new tests are picked up automatically.

### 7.2 Required status check
Once green, mark `test` as a required status check on the `main` branch protection rules. (Out of band — done in repo settings, not code.)

## 8. Implementation Plan

| # | Task | Owner | Est. | Depends on |
| --- | --- | --- | --- | --- |
| T0.1 | Open PR with the three in-flight fixes (no tests yet) | @jai0651 | 30 min | — |
| T0.2 | Add regression test for `getElementPath` body/html | @jai0651 | 45 min | T0.1 |
| T0.3 | Add regression tests in `schemas.test.ts` for blank `elementPath` | @jai0651 | 30 min | T0.1 |
| T0.4 | Export `resolveEmbeddingSize`, add `config.test.ts` | @jai0651 | 30 min | T0.1 |
| T0.5 | Decide DOM env (happy-dom vs JSDOM); add to devDeps | @jai0651 | 30 min | T0.1 |
| T0.6 | Capture and sanitize Greenhouse fixture + `.expected.json` | @jai0651 | 1 hr | T0.5 |
| T0.7 | Capture and sanitize Lever fixture + `.expected.json` | @jai0651 | 1 hr | T0.5 |
| T0.8 | Capture and sanitize LinkedIn Easy Apply fixture + `.expected.json` | @jai0651 | 1.5 hr | T0.5 |
| T0.9 | Capture and sanitize Workday step 1 fixture + `.expected.json` | @jai0651 | 1.5 hr | T0.5 |
| T0.10 | Implement pipeline harness `pipeline.fixture.test.js` | @jai0651 | 2 hr | T0.5 |
| T0.11 | Iterate fixtures + harness until all four green | @jai0651 | 2-3 hr | T0.6-T0.10 |
| T0.12 | Add `test:extension` script to `package.json` | @jai0651 | 5 min | T0.10 |
| T0.13 | Add CI workflow if missing | @jai0651 | 30 min | T0.11 |
| T0.14 | Update `browser-extension-build-status.md` | @jai0651 | 15 min | T0.13 |

Total estimate: 12-14 hours of focused work, intended to fit in two working days.

## 9. Testing Strategy

### 9.1 What we test
- The three in-flight fixes have direct unit tests.
- The full parser pipeline runs end-to-end against four sanitized fixtures.
- Assertions are tolerant on text content (uses `contains`, ranges) and strict on platform/pageKind/semanticKey identity.

### 9.2 What we deliberately do not test
- Adapter heuristics per supported platform beyond what the fixture-level assertions catch. Detailed adapter unit tests come later.
- Mutation observer behavior. That requires a more elaborate harness and is Phase 1 territory.
- Backend handlers consuming parser output beyond the schema-level tests already in place.

### 9.3 Local developer loop
```bash
bun test:extension            # full extension test suite
bun test:extension --watch    # iterate on a fixture
```

### 9.4 Adding a new fixture later
Documented in `extension/__fixtures__/README.md`:
1. Capture page DOM via Chrome devtools "Copy outerHTML" of `<html>`.
2. Apply sanitization rules (§6.4).
3. Save under `__fixtures__/<short-name>.html`.
4. Create `<short-name>.expected.json` with the schema in §6.5.
5. Run `bun test:extension`; iterate the expected ranges until green.

## 10. Telemetry & Observability
Out of scope for this phase. Telemetry instrumentation lands in Phase 1 alongside the rewrite.

## 11. Rollout
Trivial. No user-facing changes. Merging the PR is the rollout.

## 12. Open Questions
1. **happy-dom vs JSDOM.** happy-dom is faster but JSDOM has wider compatibility. Default to happy-dom; fall back to JSDOM if a fixture exercises an API happy-dom does not implement (most likely candidate: complex iframe traversal in the Workday fixture).
2. **Fixture provenance.** We are capturing public-facing application form pages. Confirm that snapshots of public pages with all PII scrubbed are safe to commit. Default assumption: yes, since the markup itself is not copyrightable user data and we only commit the DOM, not screenshots or proprietary CSS. If legal flags this later, we can keep fixtures in a private repo and point the test harness at a local path.
3. **Workday iframe.** Workday step 1 is often inside an iframe with a separate same-origin document. The captured fixture should be the iframe's document, not the parent. Note in the fixture README.

## 13. Risks & Mitigations
| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Fixtures rot when ATS HTML changes | Medium | Medium | Fixtures are sanitized snapshots, not live pages — they never rot. The risk is the parser drifting away from reality. Mitigated by also re-capturing fixtures every quarter as a maintenance task. |
| Tests take too long to write | Low | Low | Hard cap on Phase 0 at two working days. If we cannot capture all four fixtures in that window, ship with three. |
| happy-dom missing an API the parser uses | Medium | Low | Detect early during T0.5. Fall back to JSDOM. |
| `getElementPath` fix breaks a downstream consumer | Low | Medium | The function only ever returned a non-empty string when there was a real ancestor chain. Adding `body`/`html` returns can only widen the input domain. Mitigated by the schema preprocessor: empty strings still get coerced to `body`. |

## 14. References
- [one-stop-platform-plan.md](./one-stop-platform-plan.md) — parent plan that introduced this phase
- [browser-extension-parsing-engine.md](./browser-extension-parsing-engine.md) — parser architecture this phase preserves
- [browser-extension-build-status.md](./browser-extension-build-status.md) — live tracker (gets updated when phase completes)
- happy-dom: https://github.com/capricorn86/happy-dom
- Bun test runner: https://bun.com/docs/cli/test
