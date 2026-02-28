# Improvement Plan — Context Quality & Token Efficiency

**Date:** 2026-02-28
**Focus:** Maximize resume quality per JD by improving context gathering, reducing token waste, and strengthening the generation pipeline.

---

## Executive Summary

The current implementation covers all 8 planned phases. The pipeline works end-to-end. But the **quality ceiling** is limited by how context is gathered and how tokens are spent. The same JD gets embedded 6-7 times per generation. Raw JD noise pollutes semantic search. Paraphrasing gets the full kitchen sink in one prompt. The assembly step is purely deterministic with no AI finesse. This doc targets those structural gaps.

---

## 1. Critical Token Waste — Fix First

### 1.1 Duplicate Embedding of the Same JD Query

**Problem:** `searchQdrantByUser` calls `generateEmbedding` internally every time it's invoked. In `generateSmartResumePipeline`, it's called once for projects + once per knowledge type (achievement, certification, award, publication, custom, optionally oss_contribution). That's **6-7 separate embedding calls for the exact same JD text**.

**Current code path:**
```
searchQdrantByUser({ query: jdText, type: 'project' })   → generateEmbedding(jdText)
searchQdrantByUser({ query: jdText, type: 'achievement' }) → generateEmbedding(jdText)
searchQdrantByUser({ query: jdText, type: 'certification'})→ generateEmbedding(jdText)
... (4-5 more times)
```

**Fix:** Embed the JD query once, then pass the pre-computed vector to each Qdrant search. Add a `searchQdrantByVector` function that accepts a raw vector instead of text.

**Token savings:** ~85% reduction in embedding tokens per generation (from 7 calls to 1).

**Priority:** P0 — this is the single biggest token waste in the system.

---

### 1.2 Redundant JD in Paraphrasing Prompt

**Problem:** `paraphraseStaticData` sends both the parsed JD (structured JSON) AND the raw JD text. The parsed JD already contains all structured information. The raw JD adds ~500-2000 tokens of noise (company description, benefits, equal opportunity statement, application instructions).

**Current prompt sends:**
```
Parsed JD:\n${JSON.stringify(params.parsedJD, null, 2)}
Raw JD:\n${params.jobDescription}
```

**Fix:** Remove raw JD from the paraphrasing prompt. Use only parsed JD + a condensed "target context" line (role @ company, domain). If the parsed JD is good, the raw text adds no signal.

**Token savings:** ~500-2000 input tokens per generation.

---

### 1.3 JSON Pretty-Print Waste in Prompts

**Problem:** Multiple prompts use `JSON.stringify(data, null, 2)` which adds indentation whitespace that consumes tokens for zero signal.

**Affected calls:**
- `paraphraseStaticData` — experiences, projects, knowledge, parsedJD all pretty-printed
- `calculateATSScore` — full resume data pretty-printed
- `generateTailoredResume` (legacy) — full resume + repos pretty-printed
- `proposeResumePatch` in copilot — full resume pretty-printed

**Fix:** Use `JSON.stringify(data)` (no indentation) in all prompts. Or better, build a minimal text representation instead of raw JSON (see 2.5).

**Token savings:** ~15-25% reduction in input tokens on the largest prompts (paraphrasing, ATS scoring).

---

### 1.4 Double ATS Scoring on Low Scores

**Problem:** If the initial ATS score is below 70, `improveResumeForLowAts` adjusts skills ordering and then `calculateATSScore` is called a second time. But the improvement is purely deterministic (reorder skills to match JD). The second ATS call costs the same as the first.

**Fix:** After deterministic skill improvement, use only the deterministic ATS scorer (`computeAtsEstimate`) to verify improvement. Reserve the expensive AI ATS scoring for the final resume only. Or combine both into one call: send the improved resume to ATS scoring once.

**Token savings:** Eliminates one full ATS scoring call (~2000-4000 tokens) in ~30-40% of generations.

---

### 1.5 Clarification Flow Re-Generates from Scratch

**Problem:** `submitClarificationAnswers` calls `generateSmartResume` completely from scratch with the enriched JD. This re-runs JD parsing, semantic search (7 embedding calls), static data load, paraphrasing, assembly, validation, and ATS scoring. But only the paraphrasing and assembly steps should change — the JD structure, matched projects, and static data are the same.

**Fix:** Store the pipeline artifacts from the first run in the `GenerationSession`. On clarification submission, load artifacts and resume from the paraphrasing step only, enriching the context with clarification answers.

**Token savings:** ~60-70% reduction in tokens for clarification-based regenerations.

---

## 2. Context Gathering Quality — Better Signal, Less Noise

### 2.1 Use Parsed JD Skills as Semantic Query, Not Raw JD

**Problem:** The full raw JD text is used as the Qdrant search query. JDs typically contain:
- 30-40% relevant content (role, skills, responsibilities)
- 60-70% noise (company overview, benefits, legal disclaimers, application instructions)

This noise dilutes the embedding and returns less relevant results.

**Fix:** Build a focused search query from the parsed JD output:
```
"{role}. {requiredSkills.join(', ')}. {keyResponsibilities.join('. ')}. {industryDomain}"
```

Optionally run a second query using `preferredSkills` for diversity. This produces a much tighter embedding that matches projects by actual relevance, not by noise overlap.

**Impact:** Significantly better project/achievement matching, especially for verbose JDs.

---

### 2.2 Skill-Group Semantic Searches

**Problem:** One broad semantic search for projects treats all JD requirements equally. A JD for "Full-Stack Engineer" might require both "React/TypeScript frontend" AND "PostgreSQL/Redis backend". A single embedding averages these signals, potentially missing projects that are highly relevant to one dimension.

**Fix:** Cluster JD skills into 2-3 groups (e.g., frontend, backend, infra) and run parallel Qdrant searches per group. Then merge results, ensuring coverage across all skill dimensions.

**Trade-off:** More Qdrant queries but same embedding if we use the pre-computed vector approach from 1.1. The skill grouping can be done during JD parsing (add a `skillGroups` field to ParsedJD) at zero extra cost.

---

### 2.3 JD Input Validation and Preprocessing

**Problem:** No validation on JD input quality. A user could paste a 3-word title, a URL, or garbage text. The pipeline will burn tokens parsing it, searching for it, and generating a low-quality resume.

**Fix:** Add a preprocessing step before JD parsing:
- **Minimum length check** (at least 100 chars, or ~20 words)
- **Strip boilerplate** — programmatically remove common noise sections ("Equal Opportunity Employer", "Benefits", "How to Apply", "About [Company]") before sending to the parser
- **Detect non-JD input** — if the text looks like a URL, a resume, or random text, return an error early
- **Normalize formatting** — strip HTML tags, excessive whitespace, unicode garbage

This is zero-token preprocessing that improves every downstream step.

---

### 2.4 Experience Relevance Scoring

**Problem:** All experiences are included in every resume and treated equally. For users with 5+ experiences, irrelevant ones dilute the resume and waste paraphrasing tokens.

**Fix:** Score each experience against the JD (keyword overlap + role similarity) and:
- Allocate more detail (longer descriptions) to high-relevance experiences
- Truncate or summarize low-relevance experiences to 1-2 lines
- Optionally omit very old, irrelevant experiences (with user consent via preferences)

Pass relevance scores to the paraphraser so it knows where to invest effort.

---

### 2.5 Structured Text Context Instead of Raw JSON

**Problem:** Passing raw JSON objects to the AI wastes tokens on field names, braces, brackets, and quotes that the model has to parse. Example:

```json
{"id":"abc","company":"Google","role":"SWE","startDate":"Jan 2022","description":"Built..."}
```

**Fix:** Build a human-readable text representation for AI prompts:
```
[Experience] Software Engineer at Google (Jan 2022 - Present, Mountain View)
• Built distributed caching layer reducing latency by 40%
• Led team of 5 engineers on search infrastructure
```

This is ~30-40% fewer tokens for the same information and easier for the model to reason about.

---

### 2.6 Richer Project Embedding Text

**Problem:** Project embedding text is `"{name}. {description}. Technologies: {tech}. {readme.slice(0, 2000)}"` but the actual search result only uses `readme.slice(0, 1200)` in `getProjectText()`. These inconsistencies mean the embedding might capture concepts from chars 1200-2000 of the README that never make it to the resume.

**Fix:**
- Standardize README truncation to the same limit in both embedding and retrieval
- Add GitHub topics/tags to embedding text (they're already fetched but not embedded)
- For GitHub projects, include the repo's primary language and star count as signals
- Consider embedding a "project impact summary" generated once at import time, rather than raw README text

---

## 3. Resume Generation Quality — Better Output

### 3.1 System Prompts for All AI Calls

**Problem:** All OpenAI calls use only `user` role messages. No `system` prompt sets the AI's persona, constraints, or output quality expectations.

**Fix:** Add system prompts to every AI call:
- JD Parser: "You are a job description parser. Extract structured information accurately. Never infer information not present in the text."
- Paraphraser: "You are an expert resume writer with 15 years of ATS optimization experience. You rewrite content to match job requirements while preserving all factual claims. You never fabricate metrics or experiences."
- ATS Scorer: "You are an ATS (Applicant Tracking System) simulator. Score resumes objectively based on keyword match, skills alignment, and relevance."

System prompts improve output quality significantly and cost only ~50-100 extra tokens per call.

---

### 3.2 AI-Powered Resume Assembly (Replace Deterministic Slot-Fill)

**Problem:** `buildBaseResume` is purely deterministic — it slots profile data, paraphrased experiences, selected projects, and skills into a fixed structure. There's no intelligence in how sections flow, how the narrative builds, or how bullet points are ordered within each experience.

**The gap:** The plan calls for "AI to generate the resume, but constrained to only user's real data" (Phase 3, Step 4). The current implementation skips this — it uses the paraphraser for individual rewrites but assembles the final document mechanically.

**Fix:** Add an AI assembly step after paraphrasing that:
- Receives all prepared content (paraphrased experiences, selected projects, skills, profile)
- Optimizes bullet point ordering within each experience (most relevant to JD first)
- Ensures the professional summary ties into the experience and projects narrative
- Adjusts section proportions (more detail for relevant experience, less for others)
- Ensures consistent tone and style across all sections
- Adds a "tailored to" signal in the summary that naturally incorporates key JD terms

Constrain the prompt with: "ONLY use the provided content. Do not add new achievements, metrics, or claims."

**Token cost:** ~2000-3000 tokens for the assembly call, but dramatic quality improvement.

---

### 3.3 Per-Experience Paraphrasing with JD Relevance Context

**Problem:** One paraphrasing call handles ALL experiences + summary + skill ordering simultaneously. For resumes with 4+ experiences, this is a lot for the model to handle well in one shot, leading to:
- Later experiences getting less attention
- Inconsistent quality across experiences
- Lost metrics or details for experiences deep in the prompt

**Fix (tiered approach):**
- **For ≤3 experiences:** Keep single-call paraphrasing (current approach, sufficient quality)
- **For 4+ experiences:** Split into high-relevance batch (top 2-3 by JD match) and low-relevance batch. Paraphrase high-relevance with more detail. Low-relevance get a lighter touch or keep original descriptions.

This improves quality where it matters most while controlling token costs.

---

### 3.4 Project Description Tailoring

**Problem:** `toResumeProject` passes project descriptions as-is from the database. For GitHub imports, this is often a raw README excerpt that reads like documentation, not a resume bullet.

**Fix:** During the paraphrasing step, also tailored-rewrite the top 3-4 selected project descriptions to:
- Highlight the aspects most relevant to the JD
- Use resume-appropriate language (impact-focused, concise)
- Mention specific technologies from the JD
- Add quantifiable impact if present in the source data

This can be rolled into the existing paraphrasing call by adding a `projects` field to the paraphrase schema output.

---

### 3.5 Resume Length Awareness

**Problem:** No awareness of target resume length. A generated resume might have 8 experiences with 5 bullets each, producing a 3-page resume that ATS systems and recruiters will deprioritize.

**Fix:** Add to user preferences:
```typescript
targetLength: '1-page' | '2-page' | 'auto';
```

Then enforce constraints:
- **1-page:** Max 3 experiences (3-4 bullets each), max 3 projects (1-2 lines each), max 15 skills
- **2-page:** Max 5 experiences (4-5 bullets each), max 4 projects, max 20 skills
- **auto:** Based on years of experience — <5 years = 1 page, 5+ = 2 pages

Pass these constraints to the paraphraser and assembly steps.

---

### 3.6 Smarter Claim Validation

**Problem:** Current claim validation uses token overlap with a 22% threshold and 3-word minimum. This is very loose:
- "Increased revenue by 500%" would pass if the source says "increased revenue by 15%" (overlapping tokens: "increased", "revenue", "by")
- Short, fabricated bullets can pass if they share enough common words with source data

**Fix:**
- **Metric integrity check:** Extract all numbers and their associated verbs/nouns. Verify each `{verb} {noun} by {number}` triple exists in source data, not just the individual tokens.
- **Semantic claim validation (optional, higher quality):** For the top 5-10 claims in the resume, use a lightweight AI call: "Does claim X accurately reflect source data Y? Answer yes/no with brief reasoning." This catches paraphrasing that changes meaning.
- **Increase overlap threshold** to 30% with 4-word minimum for medium-length claims.

---

### 3.7 Iterative Refinement on Low ATS

**Problem:** If ATS score is low and claim validation removes bullets, the resume can end up thin. No mechanism to add content back or regenerate weak sections.

**Fix:** After claim sanitization + ATS improvement, check for "thin sections" (experience with <2 bullets, empty project descriptions). If found:
- Pull the next-best projects/achievements from the ranked list
- Re-paraphrase only the thin sections (not the full resume)
- Re-validate claims only on the new content

Limit this to 1 refinement iteration to cap costs.

---

## 4. Architecture & Infrastructure Improvements

### 4.1 Cached JD Parsing Across Sessions

**Problem:** JD cache is an in-memory `Map` that's lost on every server restart or serverless function cold start. Same JD from different users or sessions re-parses every time.

**Fix:** Cache parsed JDs in Postgres keyed by JD content hash:
```prisma
model ParsedJDCache {
  id        String   @id @default(cuid())
  jdHash    String   @unique
  parsedJD  Json
  createdAt DateTime @default(now())
  expiresAt DateTime

  @@index([jdHash])
}
```

TTL of 7 days. This saves one AI call per generation for repeated/similar JDs.

---

### 4.2 Pre-computed Query Embeddings for Common Roles

**Problem:** Each generation embeds the JD query. For common roles (e.g., "Software Engineer", "Product Manager"), the core semantic signal is similar across JDs.

**Fix:** Pre-compute and cache embeddings for the top 50-100 common role titles + skill combinations. When a new JD is parsed, check if the role+skills match a cached query embedding with >90% similarity. If yes, use the cached embedding for Qdrant search.

**Token savings:** Eliminates embedding calls for repeat role types.

---

### 4.3 Embedding Once on Item Create, Search Multiple Times Free

**Problem (adjacent):** The current architecture is correct — embed on create, search at generation time. But search still requires embedding the query. With fix 1.1 (embed query once), the only remaining cost is that one query embedding per generation.

**Optimization:** Consider using Qdrant's `recommend` API instead of `search` for projects. You can pass existing point IDs (projects the user has flagged as relevant) as positive examples and get recommendations without any embedding call at all.

---

### 4.4 Smarter Model Selection Per Operation

**Problem:** All AI calls use `config.openai.model` (gpt-4o-mini). But not all operations need the same intelligence level:
- JD parsing is structured extraction → gpt-4o-mini is fine
- Paraphrasing requires nuance → gpt-4o would be significantly better
- ATS scoring is analytical → gpt-4o-mini is fine
- Resume assembly (if AI-powered, see 3.2) needs creativity → gpt-4o would help

**Fix:** Add per-operation model config:
```typescript
models: {
  jdParse: 'gpt-4o-mini',
  paraphrase: 'gpt-4o',       // higher quality for the core value-add
  atsScore: 'gpt-4o-mini',
  assembly: 'gpt-4o',          // if AI-powered
  claimValidation: 'gpt-4o-mini',
}
```

Use the heavier model only where quality directly impacts the output users see. The cost difference is small compared to the quality gain.

---

### 4.5 Streaming Pipeline Progress

**Problem:** The generation pipeline can take 15-30 seconds. The user sees no progress indication of which step is running or how far along it is.

**Fix:** The `onStepStart`/`onStepComplete` hooks already exist. Wire them to a server-sent events (SSE) endpoint or WebSocket so the UI can show:
```
✓ Parsing job description...
✓ Finding relevant projects...
✓ Loading your experience data...
→ Tailoring descriptions for this role...
  Validating claims...
  Scoring ATS compatibility...
  Generating PDF...
```

No token impact, but significant UX improvement.

---

## 5. Missing Features vs Plan

### 5.1 Blob PDF Storage (Partial)

`storeBlobPdf()` in `pdfStorage.ts` throws "Blob storage not implemented". Only local filesystem works. For production this needs Vercel Blob, S3, or R2.

### 5.2 WhatsApp & Email Channels

Models and enums exist but no handlers. Low priority if Telegram + web cover the user base.

### 5.3 Bulk Re-Embed Orchestration

Only item-level `reEmbedProject` and `reEmbedKnowledgeItem` exist. No bulk "rebuild all embeddings for user" with progress tracking and rate limiting.

### 5.4 Resume Reuse with Semantic Similarity

Current reuse check uses token overlap on resume metadata (`title`, `targetRole`, `targetCompany`, `atsSummary`). Could be much stronger by embedding the new JD and comparing against embeddings of previously generated resumes' JD contexts.

### 5.5 Cron-Based Usage Summary Aggregation

`upsertAllUserUsageSummaries` exists but there's no cron job or scheduled trigger to call it. The admin dashboard likely reads stale data.

---

## 6. Priority Implementation Order

### Phase A — Token Efficiency (Do First, Immediate ROI)
1. **[P0] Fix duplicate JD embedding** (1.1) — single biggest win
2. **[P0] JD input validation/preprocessing** (2.3) — prevents wasted generations
3. **[P1] Remove raw JD from paraphrasing prompt** (1.2)
4. **[P1] Drop JSON pretty-print in prompts** (1.3)
5. **[P1] Fix double ATS scoring** (1.4)

### Phase B — Context Quality (Better Input = Better Output)
6. **[P0] Use parsed JD as semantic query** (2.1)
7. **[P1] Structured text context for prompts** (2.5)
8. **[P1] Standardize README truncation** (2.6)
9. **[P2] Experience relevance scoring** (2.4)
10. **[P2] Skill-group searches** (2.2)

### Phase C — Output Quality (Better Generation)
11. **[P0] System prompts on all AI calls** (3.1)
12. **[P1] Project description tailoring** (3.4)
13. **[P1] Resume length awareness** (3.5)
14. **[P2] AI-powered assembly** (3.2)
15. **[P2] Smarter claim validation** (3.6)
16. **[P2] Per-experience paraphrasing** (3.3)

### Phase D — Infrastructure
17. **[P1] Persistent JD parse cache** (4.1)
18. **[P1] Streaming pipeline progress** (4.5)
19. **[P2] Per-operation model selection** (4.4)
20. **[P2] Clarification artifacts reuse** (1.5)
21. **[P3] Pre-computed role embeddings** (4.2)

---

## 7. Estimated Token Budget Per Generation (Current vs Improved)

| Step | Current Tokens (est.) | After Improvements |
|---|---|---|
| JD Parsing | ~1,500 | ~1,500 (same) |
| Query Embedding | ~1,400 (7 calls × 200) | ~200 (1 call) |
| Paraphrasing (input) | ~4,000-8,000 | ~2,500-4,000 |
| Resume Assembly | 0 (deterministic) | ~3,000 (if AI-powered) |
| Claim Validation | 0 (deterministic) | 0 (keep deterministic) |
| ATS Scoring | ~3,000-5,000 | ~2,000-3,000 |
| ATS Re-score (if low) | ~3,000-5,000 | 0 (use deterministic) |
| **Total** | **~13,000-21,000** | **~9,000-14,000** |

Net reduction: **~30-45% fewer tokens** while producing **higher quality output** through better context.

---

## 8. Key Files to Modify

| File | Changes |
|---|---|
| `src/actions/embed.ts` | Add `searchQdrantByVector()`, decouple embedding from search |
| `src/actions/generateResume.ts` | Embed JD once, build focused queries, structured text prompts, system prompts, project tailoring, length awareness |
| `src/actions/ai.ts` | System prompts, drop pretty-print JSON, remove legacy `generateTailoredResume` usages |
| `src/actions/clarify.ts` | Reuse pipeline artifacts instead of regenerating from scratch |
| `src/actions/generationPipeline.ts` | Wire SSE/streaming for pipeline progress |
| `src/lib/config.ts` | Per-operation model config, resume length preferences |
| `src/lib/usageTracker.ts` | No changes needed (already solid) |
| `src/types/resume.ts` | Add `targetLength` to preferences type |
