# Browser Extension Parsing Engine

## Purpose
Design a parsing engine that can reliably extract:
- job description content
- company and role metadata
- application input fields
- custom application questions
- multi-step form state

The parser must be:
- fast on large pages
- deterministic
- resilient to DOM churn
- explainable in the UI
- safe when uncertain

The target is not perfect HTML understanding. The target is high-confidence extraction with graceful fallback.

## Core Principle
Do not parse the full webpage as raw HTML and send it to AI.

Instead:
1. classify the page
2. reduce the DOM to relevant visible regions
3. extract structured candidates
4. normalize them into shared schemas
5. score confidence
6. let adapters improve precision where needed
7. only then call backend services for analysis or generation

This keeps the system fast, cheap, and debuggable.

## Non-Goals
The parser should not:
- fully understand every custom website perfectly
- infer hidden state from framework internals
- auto-submit forms
- use LLMs to interpret large raw DOM blobs
- fill low-confidence legal or ambiguous fields automatically

## High-Level Architecture

### Pipeline
```text
DOM Snapshot
  -> Page Classifier
  -> DOM Reducer
  -> Region Segmenter
  -> Candidate Extractors
      - Job Metadata Extractor
      - JD Extractor
      - Field Extractor
      - Question Extractor
  -> Semantic Normalizer
  -> Confidence Scorer
  -> Adapter Overrides
  -> Fill Planner / UI Model
```

### Runtime Placement

#### Content Script
Runs in the page and does:
- page classification
- DOM reduction
- field scanning
- visible text extraction
- locator generation
- fill execution

#### Background Worker
Handles:
- auth
- backend calls
- per-tab session state
- caching

#### Side Panel
Renders:
- detected job info
- safe fills
- review-required fields
- custom questions
- extraction confidence

## Main Design Constraints

### 1. HTML Can Be Huge
Modern job sites often ship:
- React/Vue/Angular trees
- hidden templates
- modals
- portals
- repeated sidebar content
- analytics payloads

So we must never treat the whole document as meaningful content.

### 2. Forms Re-render Frequently
Workday and LinkedIn often replace or patch parts of the DOM after each interaction.

So the parser must support:
- incremental rescans
- rescoring changed regions only
- stable field identity across rerenders

### 3. Semantic Meaning Is Usually Nearby
The meaning of a field is usually recoverable from:
- its label
- its placeholder
- aria attributes
- helper text
- section heading
- nearby question text

This is better than looking at the raw tag alone.

## The Parsing Model

## 1. Page Classification

### Goal
Determine what kind of page we are on before deeper extraction.

### Output
```ts
type PageKind =
  | 'job_detail'
  | 'application_form'
  | 'multi_step_application'
  | 'auth_gate'
  | 'unsupported'
  | 'unknown';

type Platform =
  | 'linkedin'
  | 'greenhouse'
  | 'lever'
  | 'workday'
  | 'indeed'
  | 'wellfound'
  | 'generic';
```

### Signals Used
- `location.hostname`
- page title
- URL patterns
- existence of `form`
- count of visible interactive controls
- presence of platform-specific containers
- presence of headings like:
  - Apply
  - Application
  - Job description
  - Responsibilities
  - Requirements
  - Resume/CV

### Classification Strategy
Use weighted heuristics, not ML, for the first version.

Example:
- host contains `greenhouse.io` and has `#application_form` -> `application_form`, `greenhouse`
- host contains `myworkdayjobs.com` and visible stepper + many inputs -> `multi_step_application`, `workday`
- host contains `linkedin.com` and Easy Apply modal exists -> `application_form`, `linkedin`
- if large job text but no visible form -> `job_detail`

### Why This Matters
It narrows later work:
- job-detail pages prioritize JD extraction
- application forms prioritize field extraction
- multi-step pages need observers and progression state

## 2. DOM Reduction

### Goal
Shrink the page into a relevant working set before semantic extraction.

### Principle
Reduce first, interpret second.

### What To Keep
- visible `main`, `form`, `section`, `article`, dialog content
- visible headings `h1-h4`
- visible labels
- visible textareas, inputs, selects, radio groups, checkboxes
- visible buttons relevant to apply flow
- visible helper/error text

### What To Exclude
- `script`, `style`, `noscript`, `svg`
- hidden nodes
- nav/header/footer boilerplate
- cookie banners
- chat widgets
- ad blocks
- repeated recommendation cards
- unrelated sidebars
- offscreen DOM templates

### Visible Check
Treat a node as relevant only if:
- not `display: none`
- not `visibility: hidden`
- not `aria-hidden=true`
- has non-zero box size or visible descendants
- is inside the viewport or near the active form/dialog region

### Reduction Strategy
Scan only from a bounded set of roots:
- active modal/dialog
- `form`
- `main`
- primary article container
- largest visible content column

If a modal apply flow exists, prefer it over the rest of the page.

### Output
```ts
type ReducedRegion = {
  id: string;
  kind: 'dialog' | 'form' | 'main' | 'sidebar' | 'section';
  elementPath: string;
  textSample: string;
  visibleTextLength: number;
  interactiveCount: number;
};
```

## 3. Region Segmentation

### Goal
Split the reduced DOM into meaningful extraction zones.

### Region Types
- header region
- job content region
- application form region
- question region
- review/submit region

### Why Segmentation Helps
The same page may contain:
- a full job description
- a short apply modal
- recommendations sidebar

Without segmentation, the parser mixes them together.

### Segmentation Heuristics
- nearest section heading
- container boundaries
- form group wrappers
- dialog root boundaries
- line-of-sight proximity for labels and inputs

## 4. Job Metadata Extraction

### Goal
Extract company, role, location, and related job metadata.

### Fields
```ts
type JobMetadata = {
  companyName?: string;
  roleTitle?: string;
  location?: string;
  employmentType?: string;
  workplaceType?: 'remote' | 'hybrid' | 'onsite' | 'unknown';
  compensationText?: string;
};
```

### Extraction Order
1. adapter-specific selectors
2. main page heading hierarchy
3. nearby labeled metadata rows
4. JSON-LD if present and trustworthy

### Role Title Strategy
Prefer:
- `h1` in main content
- modal title for application modal
- platform-specific title container

Reject candidates that:
- are too long
- contain many separators
- look like navigation text

### Company Strategy
Prefer:
- line near role title
- employer branding area
- labeled metadata rows

### Location Strategy
Prefer:
- metadata chips near top
- text matching city/state or remote tokens

## 5. JD Extraction

### Goal
Extract the actual job description container cleanly and efficiently.

### Hard Part
Job descriptions are often mixed with:
- benefits banners
- company overview
- recommended jobs
- applicant tips
- equal opportunity statements

### Approach
Use candidate container scoring, not full-page text dump.

### Candidate Generation
Generate JD candidates from:
- large visible `section`, `article`, `div`
- containers near headings:
  - About the job
  - Job description
  - Responsibilities
  - Qualifications
  - Requirements
  - What you’ll do

### Candidate Features
For each container score:
- visible text length
- number of bullet lists
- presence of JD keywords
- ratio of plain text to links/buttons
- proximity to title/meta area
- overlap with form region
- depth within main content

### JD Keyword Signals
Positive:
- responsibilities
- requirements
- qualifications
- experience
- skills
- preferred
- must have
- nice to have
- team
- role

Negative:
- recommended jobs
- people also viewed
- share
- sign in
- follow company

### Scoring Sketch
```ts
score =
  textDensity * 0.30 +
  keywordDensity * 0.25 +
  listDensity * 0.10 +
  mainRegionBoost * 0.15 +
  headerProximity * 0.10 +
  lowLinkRatioBoost * 0.10 -
  sidebarPenalty -
  unrelatedKeywordPenalty
```

### JD Post-Processing
After selecting the best container:
- normalize whitespace
- preserve bullets and section headers
- dedupe repeated lines
- remove CTA noise
- trim overly long repeated disclaimers

### Output
```ts
type JobDescriptionExtraction = {
  text: string;
  sourceRegionId: string;
  confidence: number;
  sectionHints: string[];
};
```

### Fallback
If no strong JD container exists:
- build JD from top 2-3 high-scoring text regions
- mark confidence lower

## 6. Field Extraction

### Goal
Find all relevant application controls and recover their meaning.

### Supported Controls
- `input`
- `textarea`
- `select`
- radio groups
- checkbox groups
- contenteditable text inputs only if clearly user-entered

### Raw Extraction Shape
```ts
type RawFieldCandidate = {
  tagName: string;
  inputType?: string;
  name?: string;
  id?: string;
  placeholder?: string;
  ariaLabel?: string;
  required: boolean;
  disabled: boolean;
  visible: boolean;
  options?: string[];
  labelTextCandidates: string[];
  helperTextCandidates: string[];
  sectionHeadingCandidates: string[];
  locator: FieldLocator;
};
```

### Label Recovery Algorithm
For each field, collect label candidates in this order:
1. explicit `<label for=...>`
2. wrapping label
3. `aria-label`
4. `aria-labelledby`
5. nearest preceding sibling text
6. same form-group text
7. placeholder

Each source gets a reliability weight.

### Context Recovery
Also collect:
- nearest section heading
- helper text below input
- validation/error text
- parent group legend
- surrounding question sentence

### Field Identity
Generate a stable locator:
```ts
type FieldLocator = {
  cssPath: string;
  xpathLikePath?: string;
  name?: string;
  id?: string;
  nthIndex?: number;
  framePath?: string[];
};
```

This is not for user-facing display. It is for:
- re-finding the field
- undo support
- resilience across rerenders

## 7. Field Normalization

### Goal
Map raw fields into known semantic field keys.

### Field Key Set
Start with a small controlled vocabulary:
- `full_name`
- `first_name`
- `last_name`
- `email`
- `phone`
- `current_location`
- `linkedin_url`
- `github_url`
- `portfolio_url`
- `resume_upload`
- `cover_letter`
- `work_authorization`
- `visa_sponsorship_required`
- `salary_expectation`
- `notice_period`
- `years_of_experience`
- `school_name`
- `degree`
- `company_name`
- `job_title`
- `start_date`
- `end_date`
- `custom_question`

### Matching Signals
Use weighted matching from:
- label text
- placeholder
- `name`
- `id`
- select option vocabulary
- section heading
- input type

Example:
- label contains `email address` + input type email -> `email` high confidence
- label contains `portfolio`, `personal website`, `website` -> `portfolio_url`
- textarea under `why do you want to work here` -> `custom_question`, not generic cover letter

### Matching Engine
Use a deterministic ruleset:
- synonym dictionary
- regex patterns
- disambiguation rules

Example:
```ts
if (/email/i.test(labelOrName) && inputType === 'email') key = 'email';
if (/(linkedin)/i.test(labelOrName)) key = 'linkedin_url';
if (/(authorized to work|work authorization)/i.test(context)) key = 'work_authorization';
```

Do not use embeddings or AI in the browser for this step.

## 8. Custom Question Detection

### Goal
Identify when a field is not a basic profile field but an actual application question.

### Common Cases
- textareas
- long text inputs
- radio groups about motivation or eligibility
- fields under prompts like:
  - Why do you want to join us?
  - Describe your experience with X
  - Tell us about a project

### Question Detection Signals
- field is textarea
- label ends with `?`
- helper text looks like a prompt
- surrounding text length exceeds basic field labels
- section heading implies essay/free response

### Output
```ts
type NormalizedQuestion = {
  id: string;
  questionText: string;
  fieldLocator: FieldLocator;
  answerMode: 'short_text' | 'long_text' | 'single_select' | 'multi_select';
  typeHint:
    | 'why_company'
    | 'why_role'
    | 'self_intro'
    | 'project_story'
    | 'experience_with_skill'
    | 'eligibility'
    | 'compensation'
    | 'other';
  confidence: number;
};
```

### Important Rule
Not every textarea is a custom AI-answer field.

Examples:
- cover letter upload note -> not a question
- freeform salary expectation -> structured/logistics
- address line 2 -> not a question

## 9. Confidence Scoring

### Goal
Explicitly model uncertainty so the UI can behave safely.

### Confidence Bands
- `high`: safe to autofill automatically after user clicks fill
- `medium`: suggest and confirm
- `low`: show only, no autofill

### Confidence Inputs

#### For Job Metadata
- selector quality
- heading proximity
- platform match
- text plausibility

#### For JD
- candidate score margin over second-best container
- text length sufficiency
- JD keyword density
- main-region confidence

#### For Fields
- label reliability
- semantic match strength
- input-type compatibility
- section consistency
- ambiguity penalty

### Example Field Confidence Formula
```ts
fieldConfidence =
  labelReliability * 0.35 +
  semanticPatternScore * 0.30 +
  inputTypeCompatibility * 0.15 +
  sectionContextScore * 0.10 +
  platformBoost * 0.10 -
  ambiguityPenalty
```

### Ambiguity Examples
- `Website` could mean company site or personal site
- `Profile` could mean LinkedIn or internal profile
- `Current company` in a demographic section might not be application-critical

### Output Model
```ts
type ConfidenceBand = 'high' | 'medium' | 'low';

type ConfidenceExplanation = {
  score: number;
  band: ConfidenceBand;
  reasons: string[];
};
```

## 10. Adapter Overrides

### Goal
Improve precision for high-value platforms without rewriting the core parser.

### Adapter Contract
```ts
type PlatformAdapter = {
  platform: Platform;
  detect(): boolean;
  getPreferredRoots?(doc: Document): Element[];
  extractMetadataOverrides?(): Partial<JobMetadata>;
  extractFieldOverrides?(): Partial<NormalizedField>[];
  extractJDOverride?(): Partial<JobDescriptionExtraction> | null;
  beforeFill?(field: NormalizedField): NormalizedField;
};
```

### Adapter Responsibilities
Adapters should only handle:
- known stable selectors
- known modal roots
- known form-group structures
- known stepper patterns
- platform-specific quirks

Adapters should not replace the full generic pipeline unless necessary.

### Recommended Adapter Priorities

#### LinkedIn
Handle:
- Easy Apply modal root
- job title/company extraction inside modal/page
- textarea prompts in modal

#### Greenhouse
Handle:
- standard application blocks
- explicit labels
- predictable field names

#### Lever
Handle:
- application form wrappers
- cleaner metadata extraction

#### Workday
Handle:
- multi-step forms
- changing root containers
- grouped structured fields

### Override Rule
Generic parser runs first.
Adapter may:
- supply better roots
- replace specific fields
- raise or lower confidence
- resolve conflicts

## 11. Incremental Parsing and DOM Churn

### Goal
Stay efficient on reactive pages.

### Mechanism
Use a `MutationObserver` with debounced rescans.

### Strategy
1. Observe:
   - active modal
   - main form container
   - stepper container
2. Collect changed subtrees.
3. Debounce for 200-500ms.
4. Re-parse only affected regions.
5. Diff old and new normalized models.

### State To Cache
- page classification
- current platform
- root region IDs
- field locators
- normalized field map
- last JD hash
- last question hash

### Why Diffing Matters
The UI should show:
- 2 new fields detected
- current step changed
- previous filled fields still mapped

Instead of flashing and rebuilding everything.

## 12. Performance Strategy

### Hard Limits
Set internal caps:
- max text scanned per region
- max regions scored for JD extraction
- max nearby context nodes per field
- max rescans per second

### Efficiency Rules
- never stringify full DOM
- never recurse all nodes blindly on huge pages
- prefer `TreeWalker` or bounded queries
- stop scanning if active modal already provides strong context
- hash region text to skip unchanged extraction

### Suggested Caps
- top 20 candidate JD containers
- top 200 visible interactive elements
- top 8 context strings per field
- top 5 headings per field

These can be tuned later.

## 13. UI Model: What We Show The User

### Goal
Make the parser’s understanding visible so the user trusts the system.

### Side Panel Overview
Show:
- detected platform
- page type
- company
- role
- JD extraction status
- number of fields detected
- number safe to fill
- number requiring review
- number of custom questions found

### Field UI
For each field show:
- detected meaning
- proposed value
- confidence badge
- why it matched

Example:
```text
Email
Value: jai@example.com
Confidence: High
Reason: label matched "Email address" and input type=email
```

### JD UI
Show:
- JD found
- confidence
- source region hint such as `main content` or `application modal`

### Question UI
Show:
- detected question text
- type hint
- confidence
- answer action

### Uncertainty UI
If confidence is low:
- do not hide it
- tell user exactly why it is uncertain

Example:
```text
Possible field: Portfolio URL
Confidence: Low
Reason: label only says "Website", which is ambiguous
```

## 14. Fill Planner

### Goal
Convert extracted fields into safe user actions.

### Fill Plan Output
```ts
type FillPlan = {
  safe: PlannedFill[];
  needsReview: PlannedFill[];
  unsupported: NormalizedField[];
};

type PlannedFill = {
  field: NormalizedField;
  value: string | boolean | string[];
  source: 'profile' | 'preferences' | 'resume' | 'workspace';
  confidence: ConfidenceExplanation;
};
```

### Rules
- only `safe` fields fill automatically
- `needsReview` fields must be approved
- `unsupported` fields are surfaced with no action

## 15. Error Handling and Fallbacks

### If No JD Found
- fallback to top visible text regions
- mark low confidence
- allow manual `Analyze selected text`

### If No Field Labels Found
- rely on placeholder/name/id
- lower confidence

### If Platform Adapter Fails
- generic parser still runs

### If DOM Is Too Dynamic
- freeze parser on current stable step
- prompt user to reopen panel after navigation if needed

## 16. Testing Plan For The Parser

### Unit Tests
- field label matching
- synonym mapping
- confidence scoring
- JD candidate scoring
- question type hints

### Fixture Tests
Store sanitized HTML snapshots for:
- LinkedIn Easy Apply
- Greenhouse
- Lever
- Workday
- generic careers site

Assert:
- role extraction
- company extraction
- JD container selection
- field count
- field semantic mapping

### Regression Tests
Whenever a production parsing failure is reported:
- save sanitized fixture
- add failing case to tests

## 17. Implementation Modules

### Extension Content Layer
- `pageClassifier.ts`
- `domReducer.ts`
- `regionSegmenter.ts`
- `jobMetadataExtractor.ts`
- `jdExtractor.ts`
- `fieldExtractor.ts`
- `fieldNormalizer.ts`
- `questionExtractor.ts`
- `confidenceScorer.ts`
- `fillPlanner.ts`
- `mutationManager.ts`

### Adapters
- `adapters/linkedin.ts`
- `adapters/greenhouse.ts`
- `adapters/lever.ts`
- `adapters/workday.ts`

### Shared Types
- `types/normalized.ts`
- `types/locator.ts`
- `types/confidence.ts`

## 18. Pseudocode Sketch

```ts
async function parseCurrentPage(doc: Document): Promise<NormalizedPageModel> {
  const platform = detectPlatform(doc, location);
  const adapter = getAdapter(platform);

  const pageKind = classifyPage(doc, adapter);
  const roots = getPreferredRoots(doc, adapter, pageKind);
  const reducedRegions = reduceDom(roots);
  const segmented = segmentRegions(reducedRegions);

  const metadata = extractJobMetadata(segmented, adapter);
  const jd = extractJobDescription(segmented, adapter);
  const rawFields = extractRawFields(segmented, adapter);
  const normalizedFields = normalizeFields(rawFields, adapter);
  const questions = extractQuestions(normalizedFields, segmented);

  const scoredMetadata = scoreMetadata(metadata);
  const scoredJd = scoreJd(jd);
  const scoredFields = scoreFields(normalizedFields);
  const scoredQuestions = scoreQuestions(questions);

  return {
    platform,
    pageKind,
    metadata: scoredMetadata,
    jobDescription: scoredJd,
    fields: scoredFields,
    questions: scoredQuestions,
  };
}
```

## 19. Recommended Rollout Order

### Step 1
Implement:
- page classifier
- DOM reducer
- metadata extractor
- JD extractor

No autofill yet.

### Step 2
Implement:
- raw field extractor
- field normalization
- confidence scoring

Still no filling, only UI visualization.

### Step 3
Implement:
- fill planner
- safe-fill executor
- undo

### Step 4
Implement:
- question extraction
- question type hints
- backend answer generation hookup

### Step 5
Implement:
- adapters for LinkedIn, Greenhouse, Lever, Workday
- multi-step observer improvements

## 20. Final Recommendation
The parser should be built like a browser-native semantic extraction engine, not like a raw HTML scraper and not like an AI black box.

The winning formula is:
- reduce aggressively
- normalize deterministically
- score confidence explicitly
- let adapters improve precision
- show the parser’s reasoning in the UI
- only automate what is safe

That is the only realistic way to handle large, messy, dynamic job application pages without making the product slow or brittle.
