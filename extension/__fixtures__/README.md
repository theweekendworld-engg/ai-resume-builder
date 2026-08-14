# Parser Fixtures

Sanitized HTML snapshots of ATS application pages. Each fixture is paired with an `.expected.json` that the pipeline harness (`extension/__tests__/parsers/pipeline.fixture.test.js`) asserts against.

## Current state

The four fixtures in this directory are **synthetic placeholders**:
- `greenhouse-synthetic.html`
- `lever-synthetic.html`
- `linkedin-easy-apply-synthetic.html`
- `workday-step-1-synthetic.html`

They use realistic DOM structure (selectors, labels, headings) so the parser pipeline exercises end-to-end, but they are not real captures. Every fixture carries a top-level `<!-- SYNTHETIC FIXTURE -->` comment and `_synthetic: true` in its expected JSON.

**Replace each one with a real sanitized capture from a live application page** to harden the test suite. The synthetic files give a working baseline so the harness, prototype overrides, and CI gate land before fixture capture starts.

## Capturing a real fixture

1. Open the target page in Chrome (Greenhouse, Lever, LinkedIn Easy Apply modal, or a Workday first step).
2. DevTools → Elements → right-click `<html>` → **Copy outerHTML**.
3. Paste into a new file in this directory. Keep the same filename as the synthetic version, minus the `-synthetic` suffix (e.g. `greenhouse.html`).
4. Apply the sanitization rules below.
5. Update or create the matching `.expected.json` with assertions tuned to the captured content.
6. Run `bun test:extension` and iterate until green.
7. Delete the corresponding `-synthetic.html` and `-synthetic.expected.json`.

## Sanitization rules

Apply in order:

1. **Names + emails + phones** → placeholders (`Jane Doe`, `jane.doe@example.com`, `+1-555-0100`).
2. **Company identifiers** in JSON-LD or hidden form data → `example.com`. Job-board host (e.g. `boards.greenhouse.io`) stays, since the parser routes on hostname.
3. **`<script>`, `<noscript>`, `<style>`** → strip contents (leave the tags if the parser depends on their presence).
4. **Analytics pixels and embedded tracking iframes** → strip.
5. **Visible JD text** → keep verbatim.
6. **Form labels, placeholders, ARIA attributes, required markers** → keep verbatim.
7. **Tag hierarchy and class names** → keep, so adapter heuristics still match.
8. **File-size cap: 500 KB.** If a snapshot exceeds it, prune sidebars and recommendation cards — never the form or JD.

## Workday note

Workday often hosts the application form inside a same-origin iframe. Capture the **inner iframe's** document, not the parent, otherwise the form won't be in the snapshot.

## Expected.json schema

Tolerant by design. Use `contains` / range assertions, not exact strings.

```json
{
  "_synthetic": false,
  "url": "https://boards.greenhouse.io/example/jobs/123",
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

## Running

```bash
bun test:extension                    # all extension tests
bun test:extension --watch            # iterate
DEBUG_FIXTURE=1 bun test:extension    # see parser output per fixture
```

## Maintenance

Re-capture fixtures every quarter to catch ATS DOM drift. When a production parser regression is reported, add the failing case as a new fixture before fixing the parser.
