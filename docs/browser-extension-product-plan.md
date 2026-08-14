# Browser Extension Product Plan

## Purpose
Build a Chrome extension that turns the existing resume-builder into a developer job application copilot.

The extension should:
- detect job application pages across major hiring platforms and custom company career sites
- autofill forms using the user's existing profile, experience, education, resume, and project data
- suggest high-quality answers for open-text application questions
- help the user decide whether a company and role are worth applying to
- reuse the current backend and product data model wherever possible instead of creating a parallel product

## What We Already Have
Current app capabilities that directly support the extension:
- user profile storage: `UserProfile`
- structured work history: `UserExperience`
- structured education: `UserEducation`
- project library with GitHub import: `UserProject`
- job target storage: `JobTarget`
- AI generation sessions and async progress: `GenerationSession`
- ATS scoring and keyword gap detection
- resume tailoring and copilot-style rewriting
- authenticated web app plus API key based `/api/v1/*` routes

This means the extension should be treated as a new client surface over the same profile, resume, and AI services.

## Product Vision
For a developer browsing jobs, the product becomes:
- find the right jobs
- understand the company quickly
- know if the role fits
- generate strong answers fast
- autofill safely
- track everything in one place

The experience should feel like:
- a calm assistant, not an aggressive auto-click bot
- trustworthy and transparent about where every answer came from
- helpful even on websites we do not fully support yet

## Product Principles
1. Human-in-the-loop first
Autofill should be reviewable, editable, and confidence-based. Never silently submit.

2. Reuse platform data
The extension should pull from the same profile, resume, project, and generation pipeline the web app already uses.

3. Graceful degradation
If a site is not fully supported, still provide value through side-panel suggestions, copied answers, job saving, and company insights.

4. Website-agnostic core, website-specific adapters
Core logic should live in shared field-detection, answer-generation, and ranking layers. Site adapters should only handle DOM quirks.

5. Explainability
Every suggestion should tell the user why it was suggested and which profile facts were used.

## Core Product Pillars

### 1. Smart Autofill
Fill common application inputs:
- name, email, phone, location
- LinkedIn, GitHub, portfolio
- work authorization
- visa sponsorship
- years of experience
- salary expectations
- notice period
- resume upload selection
- education and employment history
- tech stack and skills

### 2. AI Answer Suggestions
Generate draft answers for:
- "Why do you want to work here?"
- "Why are you a fit for this role?"
- "Tell us about yourself"
- "Describe a project you are proud of"
- "What is your experience with X?"
- "Why are you leaving your current company?"
- cover letter style text areas

### 3. Job and Company Intelligence
Show a compact "Should I apply?" layer:
- company size
- location and remote expectations
- funding stage
- revenue band when available
- employee review sentiment
- engineering signals
- common alma maters or pedigree signals
- role fit score based on the user's background
- likely stretch areas and missing requirements

### 4. Application Workspace
Each job application should become a lightweight workspace:
- saved JD
- extracted company and role data
- tailored answer drafts
- fit summary
- application status
- source URL and platform
- activity history

### 5. Cross-Surface Continuity
The user can start in browser and continue in web app:
- save job to dashboard
- open full tailor flow in web app
- generate targeted resume for this role
- reuse answers from past applications

## Extension Information Architecture

### Browser Surfaces
1. Side panel
Primary experience. Shows job summary, company intelligence, autofill actions, AI answers, and fit analysis.

2. Inline field controls
Small "Fill" or "Suggest answer" buttons near detected fields.

3. Toolbar popup
Quick status only:
- current page detected or not
- signed in or not
- quick jump to dashboard

4. Optional floating chip
A subtle launcher when a supported job page is detected.

## Primary User Flows

### Flow 1: User lands on a job page
Trigger:
- user opens a job application or job detail page on Workday, Greenhouse, Lever, LinkedIn, Indeed, Wellfound, or a custom careers site

System flow:
1. Extension detects page type:
   - job detail
   - application form
   - unsupported but relevant page
2. Extract visible page context:
   - company
   - role title
   - location
   - job description
   - application questions already present
   - platform type
3. Match against signed-in user profile.
4. Open side panel with:
   - role summary
   - "Fit score"
   - quick company snapshot
   - autofill readiness status
   - CTA: `Analyze this job`

User outcome:
- within seconds, user understands whether this role is worth deeper effort

### Flow 2: User runs job analysis
Trigger:
- user clicks `Analyze this job`

System flow:
1. Save page data as a `JobTarget` or new application object.
2. Parse JD using the same logic already used for resume tailoring.
3. Compare JD with:
   - profile
   - experience
   - education
   - projects
   - previous tailored resumes
4. Produce:
   - fit score
   - strengths
   - likely gaps
   - suggested projects to emphasize
   - recommended resume to use
   - company snapshot

Side panel output:
- `Good fit`, `Stretch`, or `Low fit`
- top reasons to apply
- top risks or gaps
- suggested resume strategy:
  - use existing resume
  - generate new tailored resume
  - answer questions manually before applying

User outcome:
- user gets a fast go/no-go decision instead of blindly filling forms

### Flow 3: Autofill profile fields
Trigger:
- user clicks `Fill basics` or `Autofill this page`

System flow:
1. DOM field detector maps page inputs to normalized field keys.
2. For each field, assign confidence:
   - high confidence: full name, email, phone, LinkedIn
   - medium confidence: location, salary, work authorization
   - low confidence: ambiguous custom text fields
3. Fill high-confidence fields automatically.
4. Queue medium-confidence items for confirmation.
5. Leave low-confidence fields untouched and surface suggestions.

Panel behavior:
- show `Filled`, `Needs review`, and `Need your input`
- allow undo by field or undo all

User outcome:
- repetitive work disappears, but trust stays high

### Flow 4: Answer custom application questions
Trigger:
- extension detects textarea or custom application prompts

Question types:
- motivational
- experience-based
- eligibility/compliance
- compensation/logistics
- portfolio/project proof

System flow:
1. Read label, placeholder, nearby helper text, and page context.
2. Classify question type.
3. Retrieve relevant user facts from:
   - `UserProfile`
   - `UserExperience`
   - `UserEducation`
   - `UserProject`
   - selected resume
   - saved answer memory
4. Generate 1-3 answer drafts with different tones:
   - concise
   - balanced
   - high-conviction
5. Show:
   - answer
   - confidence
   - source facts used
   - warning if the answer contains assumptions

User options:
- insert answer
- copy answer
- shorten
- make more technical
- make more human
- save as reusable answer

User outcome:
- open-text questions become fast, personalized, and safer

### Flow 5: Generate a tailored resume from the browser
Trigger:
- user sees poor fit or sees missing keyword opportunities and clicks `Tailor resume for this job`

System flow:
1. Send JD to existing generation pipeline.
2. Create `GenerationSession`.
3. Stream progress in extension side panel using the same step model as web app:
   - parsing job requirements
   - finding relevant experience and projects
   - rewriting bullets
   - ATS scoring
   - generating PDF
4. On completion:
   - attach generated resume to this application workspace
   - offer `Download`, `Use for upload`, and `Open in editor`

User outcome:
- job-specific resume creation is available without leaving the job page

### Flow 6: Company intelligence review
Trigger:
- user opens the `Company` tab in the side panel

Information shown:
- employee count
- hiring growth clues
- funding raised
- estimated stage
- estimated revenue range when available
- review sentiment summary
- engineering culture clues
- employee education distribution when data source exists
- location footprint

Interpretation layer:
- `Signal of trust`
- `Potential risk`
- `Good for learning`
- `High brand value`
- `Likely intense environment`

User outcome:
- users can apply more selectively and strategically

### Flow 7: Unsupported site fallback
Trigger:
- extension cannot safely map fields for a custom site

Fallback experience:
- still extract visible JD and company details if possible
- still compute fit summary
- still suggest answers for detected text questions
- still allow copy-to-clipboard answers
- still let user save job to dashboard

User outcome:
- product remains useful even before full adapter support

## Recommended MVP Scope
Do not start with "everything on every site."

### MVP Goals
- reliable page detection
- strong profile autofill
- safe answer suggestions
- basic fit scoring
- resume tailoring handoff

### MVP Site Coverage
Start with:
- LinkedIn Easy Apply
- Greenhouse
- Lever
- Workday

Why:
- high volume
- repeatable DOM patterns
- enough complexity to validate adapter architecture

### MVP Feature Set
1. Detect supported job/application pages
2. Pull user profile and core resume facts from current backend
3. Autofill basic fields
4. Suggest answers for textareas
5. Save job target from browser
6. Show simple fit score plus top strengths and gaps
7. Trigger tailored resume generation
8. Open full editor in web app

## Post-MVP Expansion

### Phase 2
- reusable answer memory
- auto-detect duplicate applications
- job tracker with applied status
- per-platform adapter improvements
- one-click reuse of previously tailored resumes

### Phase 3
- company intelligence enrichment
- role desirability scoring
- compensation benchmarking
- alumni and employee background signals
- review sentiment summarization

### Phase 4
- agentic application workflows with strict review gates
- multi-step application assistance across tabs
- interview prep generated from the exact application

## UX Details That Matter

### Confidence Model
Every action should carry confidence:
- high: safe to fill
- medium: confirm before fill
- low: suggest only

This is important for trust and legal safety.

### Provenance
For AI answers, show:
- facts used
- whether the answer was directly grounded in profile/resume data
- what part was inferred

### Review Before Insert
For non-trivial text answers:
- preview first
- insert second

### Do Not Over-Automate
Never:
- auto-submit applications
- fabricate visa, salary, dates, or legal answers
- invent projects, metrics, titles, or company names

## Architecture Direction

### Reuse Existing Backend
Extension should use existing backend entities where possible:
- `UserProfile`
- `UserExperience`
- `UserEducation`
- `UserProject`
- `JobTarget`
- `GenerationSession`

### New Backend Entities To Add

#### 1. ApplicationWorkspace
Purpose:
- represent one real job application session

Suggested fields:
- id
- userId
- sourcePlatform
- sourceUrl
- companyName
- roleTitle
- location
- employmentType
- compensationText
- jobDescription
- applicationStatus
- fitScore
- fitSummary
- companySnapshot
- selectedResumeId
- selectedGeneratedPdfId
- createdAt
- updatedAt

#### 2. ApplicationQuestion
Purpose:
- store detected questions and generated answers

Suggested fields:
- id
- workspaceId
- questionText
- normalizedQuestionType
- fieldLocatorMetadata
- answerDraft
- answerFinal
- confidence
- sourceFacts
- createdAt
- updatedAt

#### 3. CompanyInsight
Purpose:
- cache enrichment and avoid repeated fetch/generation

Suggested fields:
- id
- normalizedCompanyName
- website
- employeeCount
- fundingTotal
- revenueEstimate
- reviewSummary
- educationSignals
- engineeringSignals
- confidence
- rawData
- updatedAt

#### 4. ReusableAnswer
Purpose:
- build memory for recurring questions

Suggested fields:
- id
- userId
- questionFingerprint
- canonicalQuestion
- answerText
- usageCount
- lastUsedAt

### New API Surface
Add authenticated browser-friendly endpoints for:
- current user profile bundle
- application page analysis
- answer suggestion generation
- application workspace create/update
- field mapping save
- company insight fetch
- extension session auth

Important:
- avoid shipping raw API keys in the extension
- use session-based auth or short-lived extension tokens

## Frontend Extension Architecture

### Components
1. Content script
- detects pages
- reads DOM
- injects inline controls
- writes values into fields

2. Background service worker
- manages auth/session state
- handles API communication
- stores temporary tab/session data

3. Side panel app
- main React UI for analysis, suggestions, and company insights

4. Site adapter layer
- `linkedinAdapter`
- `greenhouseAdapter`
- `leverAdapter`
- `workdayAdapter`
- `genericFormAdapter`

5. Normalized schema layer
- `NormalizedJobPage`
- `NormalizedField`
- `NormalizedQuestion`
- `FillAction`

## Domain Model For Field Detection
Normalize every field into a shared shape:
- field key
- label
- type
- value
- required or optional
- confidence
- selector metadata
- platform-specific metadata

Example normalized keys:
- `full_name`
- `email`
- `phone`
- `current_location`
- `linkedin_url`
- `github_url`
- `portfolio_url`
- `work_authorization`
- `visa_sponsorship_required`
- `salary_expectation`
- `notice_period`
- `years_of_experience`
- `cover_letter`
- `why_company`
- `why_role`

## Detailed Interaction Model

### Side Panel Tabs
Recommended tabs:
- Overview
- Fill Form
- Answers
- Resume
- Company

### Overview Tab
Shows:
- role
- company
- fit score
- strengths
- gaps
- recommended next action

### Fill Form Tab
Shows:
- detected fields grouped by section
- fill status
- confidence
- edit controls
- `Fill all safe fields`

### Answers Tab
Shows:
- detected custom questions
- suggested drafts
- tone controls
- copy/insert/save actions

### Resume Tab
Shows:
- selected resume
- ATS hints
- `Generate tailored resume`
- generation progress

### Company Tab
Shows:
- company snapshot
- trust signals
- concerns
- employee/review/funding summary

## User Journey States

### First-Time User
1. Installs extension
2. Signs in
3. Guided setup imports or confirms:
   - personal info
   - LinkedIn/GitHub/portfolio
   - work authorization preferences
   - salary and relocation preferences
4. Visits first supported application page
5. Uses `Analyze this job`
6. Fills a few fields manually where confidence is low
7. Leaves with trust because nothing surprising happened

### Power User
1. Opens job page
2. Fit score appears immediately
3. Clicks `Fill all safe fields`
4. Reviews 2-3 generated answers
5. Generates tailored resume if needed
6. Saves application status automatically

## Important Product Gaps To Solve Before Build
Current repo is strong on resume generation but weaker on application automation data. We need to add:
- normalized user preferences for legal/logistics questions
- answer memory
- application tracking object
- browser authentication flow
- company enrichment pipeline
- source attribution for generated answers

## Risk Areas

### Technical
- DOM instability across hiring platforms
- anti-automation behaviors on some sites
- resume upload handling differences
- auth/session complexity inside extension

### Product
- users may distrust auto-generated answers
- company insights can look authoritative even when confidence is low
- low-quality autofill on unsupported sites can hurt trust fast

### Legal and Safety
- never fabricate protected/legal answers
- clearly mark estimated company data
- respect platform terms and user consent

## Success Metrics

### Activation
- extension install to sign-in rate
- sign-in to first analyzed job rate
- sign-in to first autofill rate

### Engagement
- average applications assisted per user
- average questions answered per application
- resume generation rate from extension

### Quality
- autofill acceptance rate
- suggestion edit rate
- undo rate
- user-reported wrong-fill rate

### Outcome
- application completion time saved
- apply-through rate after fit analysis
- repeat weekly usage

## Recommended Build Order
1. Shared backend contract for extension profile bundle and job analysis
2. Chrome extension shell with auth and side panel
3. Generic normalized field detection system
4. MVP adapters for LinkedIn, Greenhouse, Lever, Workday
5. Safe autofill for basics
6. Answer suggestion engine with provenance
7. Browser-triggered resume tailoring
8. Application workspace persistence
9. Company intelligence enrichment

## Suggested Internal Milestones

### Milestone 1: Extension Foundation
- auth
- side panel
- page detection
- profile fetch

### Milestone 2: Autofill MVP
- normalized field schema
- safe fills
- adapter coverage for 2-3 sites

### Milestone 3: Answers MVP
- question detection
- grounded answer generation
- insert/copy/save

### Milestone 4: Resume + Tracker
- tailored resume trigger
- application workspace
- dashboard continuity

### Milestone 5: Company Intelligence
- enrichment providers
- trust and fit summaries
- confidence labels

## Practical Recommendation
The smartest path is not "build a giant extension."

It is:
- build a strong browser side panel
- make autofill safe and narrow first
- make answer generation grounded and explainable
- turn every application into a saved workspace
- add company intelligence only after autofill and answer quality are trusted

That ordering matches the strengths already present in this codebase and reduces product risk.
