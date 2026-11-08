/**
 * Scout's contract: the input, the sections, and the shape of each section's
 * data (docs/impl/06-scout-agent.md).
 *
 * Every section's data type lives here, not beside its implementation, so the
 * dashboard, the Telegram/WhatsApp renderers and the section code can be built
 * against one definition. Change a shape here and every consumer is a type
 * error, which is the point.
 *
 * Conventions every section follows:
 *   - Every external claim carries `sourceUrl`, and that URL was fetched by the
 *     run (enforced by `SourceSet.keepCited`, not by trust).
 *   - Numbers are strings quoted from a source ("₹45–60 LPA"), never computed,
 *     converted or averaged across sources.
 *   - "Unknown" is a legal value everywhere. Absence is honest; a guess is not.
 */

import type { SourceRef } from '@/lib/agent/sources';
import type { PendingQuestion, StoredSection } from '@/lib/agent/run';

export const SCOUT_AGENT = 'scout';

// ───────────────────────────────────────────────────────────────── input

export type ScoutInputSource = 'dashboard' | 'telegram' | 'whatsapp' | 'extension';

/**
 * What the user wants done with a share, read from the line they added to it
 * ("apply for me", "worth it?", "who should I talk to", "save for later").
 * `src/lib/scout/goal.ts` decides it; no note means `evaluate`, which is what
 * a share always did (docs/impl/07-telegram-apply.md §5).
 */
export const SHARE_GOALS = ['apply', 'evaluate', 'people', 'save'] as const;
export type ShareGoal = (typeof SHARE_GOALS)[number];

/**
 * Where the apply chain for a run stands. Code owns every transition
 * (`src/services/applyChain.ts`); each one is a conditional write, so a
 * retried step or a double tap moves it once.
 *
 *   pending           waiting for the analysis (or an answer) to finish
 *   eligibility_hold  the fit found a blocking eligibility conflict; asked "Apply anyway?"
 *   tailoring         a resume is being made (`sessionId`)
 *   drafting          the resume is done; the application draft is being written
 *   drafted           PDF and draft sent; waiting for the user to send it themselves
 *   applied           the user said they sent it; the job is marked Applied
 *   declined          the user said No at the eligibility question
 *   stopped           something refused (no base resume, not a job, a failure): `reason`
 */
export const APPLY_STAGES = ['pending', 'eligibility_hold', 'tailoring', 'drafting', 'drafted', 'applied', 'declined', 'stopped'] as const;
export type ApplyStage = (typeof APPLY_STAGES)[number];

export type ApplyChainState = {
    stage: ApplyStage;
    /** When the stage was last set (ISO). */
    at: string;
    /** "Yes, apply anyway" over an eligibility conflict. */
    override?: boolean;
    /** The GenerationSession the chain started. */
    sessionId?: string | null;
    /** Skills the skipped resume questions asked about: not claimed on the resume. */
    skipped?: string[];
    /** Version 1 of the application draft. */
    draftId?: string | null;
    /** What holds it (`eligibility_hold`) or stopped it (`stopped`), in the user's words. */
    reason?: string | null;
    /** The refusing service's code, for the way forward (`nextStepFor`). */
    code?: string | null;
};

export type ScoutInput = {
    /** The shared link, when there was one. */
    url?: string | null;
    /** Pasted text, or page text the extension read in the user's own tab. */
    text?: string | null;
    /** Page title the extension saw, if any. */
    title?: string | null;
    /**
     * Post author as the extension saw them in the user's own tab. Lets the
     * network section name the poster as the first person to contact without
     * re-reading a page that may be behind a login wall.
     */
    author?: string | null;
    authorUrl?: string | null;
    source: ScoutInputSource;
    /**
     * Set by chat's `research_company` (docs/prd/10-chat.md): the user named a
     * company and asked about it, so there is nothing to classify. The run goes
     * straight to the `company_signal` plan (company facts, open roles).
     */
    intent?: 'company_research' | null;
    company?: string | null;
    /** What the user said the company is ("the project management software company"): disambiguates common-word names. */
    companyHint?: string | null;
    /** What the user asked for with the share. Absent means `evaluate`. Not part of the dedupe key. */
    goal?: ShareGoal | null;
    /** The apply chain's state, when `goal` is `apply`. Written by code only. */
    apply?: ApplyChainState | null;
};

// ────────────────────────────────────────────────────────────── sections

export const SCOUT_SECTIONS = [
    'ingest',
    'classify',
    'jd',
    'fit',
    'company',
    'comp',
    'interviews',
    'network',
    'talent',
    'openings',
    'digest',
    'capture',
    'track',
] as const;

export type ScoutSectionName = (typeof SCOUT_SECTIONS)[number];

/** Human labels, in timeline order. Shared by dashboard and channels. */
export const SCOUT_SECTION_LABELS: Record<ScoutSectionName, string> = {
    ingest: 'Reading the link',
    classify: 'Working out what it is',
    jd: 'Extracting the job description',
    fit: 'Checking fit against your record and preferences',
    company: 'Company size, funding and hiring',
    comp: 'Compensation from public sources',
    interviews: 'Interview experiences',
    network: 'Who to talk to',
    talent: 'Who works there',
    openings: 'Open roles at the companies mentioned',
    digest: 'Key takeaways',
    capture: 'Adding it to your Work Log',
    track: 'Adding it to your job tracker',
};

// ─── ingest

export type LinkKind =
    | 'linkedin_job'
    | 'linkedin_post'
    | 'linkedin_article'
    | 'linkedin_company'
    | 'linkedin_profile'
    | 'ats_job'
    | 'web'
    | 'text';

export type FetchVia = 'guest_job_api' | 'public_html' | 'ats_api' | 'provided_text' | 'extension';

export type IngestData = {
    sourceUrl: string | null;
    linkKind: LinkKind;
    fetchVia: FetchVia;
    title: string | null;
    /** Post author or job poster, when visible. */
    author: string | null;
    authorUrl: string | null;
    companyName: string | null;
    location: string | null;
    postedAt: string | null;
    /** e.g. "101 applicants" — quoted, not parsed. */
    applicantsText: string | null;
    /** Main text: the JD body or the post body. Plain text. */
    text: string;
    truncated: boolean;
};

// ─── classify

/**
 * `work_note` is the user telling us about THEIR OWN work ("shipped the retry
 * queue today, p99 down 40%"). It becomes a Work Log Win draft: the capture
 * loop is the product's moat, and a chat message is the lowest-friction way in.
 */
export type ScoutKind = 'job_posting' | 'hiring_post' | 'company_signal' | 'knowledge' | 'work_note' | 'other';

export type ClassifyData = {
    kind: ScoutKind;
    /** 0–1, from the model. Below 0.5 the dashboard says "I think this is…". */
    confidence: number;
    /** Company names mentioned, most relevant first. */
    companies: string[];
    roleTitle: string | null;
    /** One sentence, shown to the user. */
    reason: string;
};

// ─── jd

export type WorkMode = 'remote' | 'hybrid' | 'onsite' | 'unknown';

export type ScoutRequirement = {
    id: string;
    text: string;
    kind: 'must' | 'nice' | 'responsibility';
};

export type JdData = {
    role: string;
    company: string;
    seniority: string;
    domain: string;
    location: string | null;
    workMode: WorkMode;
    employmentType: string | null;
    /** Quoted from the posting, when it states pay. */
    compensationText: string | null;
    /** Quoted, e.g. "3+ years". */
    experienceText: string | null;
    requirements: ScoutRequirement[];
    skills: string[];
    responsibilities: string[];
    applyUrl: string | null;
    /**
     * Addresses the posting says to apply to ("send resumes to jobs@x.com"),
     * best first. Read from the posting text by code
     * (`src/lib/drafts/applyEmail.ts`), never from a model. Absent on runs
     * stored before it existed; read it through `applyEmailsOf`.
     */
    applyEmails?: string[];
};

// ─── fit

export type FitVerdict = 'strong' | 'possible' | 'stretch' | 'not_a_fit' | 'unknown';

export type PreferenceKey =
    /** Citizenship, clearance, Public Trust, work authorization (`fit/eligibility.ts`). */
    | 'eligibility'
    | 'role'
    | 'seniority'
    | 'work_mode'
    | 'location'
    | 'compensation'
    | 'sponsorship'
    | 'company_size';

export type PreferenceCheck = {
    key: PreferenceKey;
    status: 'match' | 'conflict' | 'unknown';
    /** e.g. "Onsite in Pune; you prefer remote". */
    detail: string;
};

export type FitData = {
    /** 0–100, deterministic (see `computeFitScore`). Null when not computable. */
    score: number | null;
    verdict: FitVerdict;
    /** `partial`: the line shows something close but weaker, or is self-description. */
    matched: { requirementId: string; text: string; evidence: string; strength: 'direct' | 'partial' }[];
    gaps: { requirementId: string; text: string; severity: 'blocking' | 'minor' }[];
    preferenceChecks: PreferenceCheck[];
    /** Present and non-empty exactly when verdict is `not_a_fit` or `stretch`. */
    notFitReasons: string[];
    /** Two or three sentences, written from the fields above only. */
    summary: string;
    /**
     * Traits the posting asks for ("hustle", "customer-centric"). Shown, never
     * scored: no record can evidence them, and counting them as gaps made a
     * working engineer look unqualified.
     */
    softRequirements: string[];
    /**
     * A question that refines the fit without holding it back (the pay
     * floor, `NON_BLOCKING_QUESTIONS`). Shown after the fit; answering it
     * re-runs the fit. Absent on runs stored before it existed.
     */
    followUp?: PendingQuestion | null;
};

// ─── company

export type CitedFact = {
    label: string;
    /** Quoted as the source phrased it. */
    value: string;
    sourceUrl: string;
    sourceTitle: string | null;
    /** Publication date when known, else when we read it. */
    asOf: string | null;
};

export type CompanyData = {
    name: string;
    website: string | null;
    employeeCount: number | null;
    employeeCountRange: string | null;
    fundingText: string | null;
    latestFundingStage: string | null;
    revenueText: string | null;
    industry: string | null;
    headquarters: string | null;
    foundedYear: number | null;
    /** Where each headline figure came from: provider, job page, or a cited page. */
    provenance: Record<string, string>;
    /** Observed-postings hiring signal statement, when there is one. */
    hiringStatement: string | null;
    /** Web-research facts (funding rounds, revenue, layoffs, growth). */
    facts: CitedFact[];
    /** One-line growth read, written from `facts` only. Null when facts are thin. */
    growthNote: string | null;
};

// ─── comp

export type CompFigure = {
    /** What the figure is, e.g. "SDE II total compensation, Bengaluru". */
    label: string;
    /** Quoted exactly as the source states it. */
    value: string;
    /**
     * The sentence or table row the value sits in, copied from the page. The
     * proof that the number is FOR this role, not merely near its name.
     */
    context?: string | null;
    sourceUrl: string;
    sourceTitle: string | null;
    asOf: string | null;
};

export type CompData = {
    figures: CompFigure[];
    /** Radar band from postings we observed, when n ≥ MIN_OBSERVATIONS. */
    observedBand: { statement: string; n: number } | null;
    /** Always shown: these are self-reported or scraped figures, not offers. */
    caveat: string;
};

// ─── interviews

export type InterviewSourceKind = 'reddit' | 'leetcode' | 'youtube' | 'glassdoor' | 'geeksforgeeks' | 'blind' | 'medium' | 'other';

export type InterviewLink = {
    url: string;
    title: string;
    source: InterviewSourceKind;
    publishedAt: string | null;
    /** Quoted from the page, not paraphrased into new claims. */
    snippet: string;
    /** Why it is relevant: role, level, recency. */
    relevance: string;
};

export type InterviewsData = {
    links: InterviewLink[];
    /** Recurring rounds/topics, only those stated in at least one linked page. */
    themes: string[];
};

// ─── network

/**
 * `ex_colleague` and `alumni` are reserved: LinkedIn's export carries only a
 * connection's CURRENT company and no school, so neither can be asserted about
 * a person today. Both are served as code-built people-search links instead.
 */
/** `found`: a public profile from a web search, cited (`src/lib/research/people.ts`). */
export type NetworkTier = 'poster' | 'first_degree' | 'ex_colleague' | 'alumni' | 'search' | 'found';

export type NetworkTarget = {
    contactId: string | null;
    fullName: string;
    position: string | null;
    company: string | null;
    profileUrl: string | null;
    tier: NetworkTier;
    /** Why this person, e.g. "1st-degree · Senior SDE at Amazon since 2024". */
    why: string;
    /** For `found` people: who they are for this role, which picks the draft. */
    role?: 'recruiter' | 'hiring_manager';
    /** For `found` people: the page the search returned, and when it was read. */
    citation?: { url: string; title: string; foundAt: string };
};

export type NetworkData = {
    targets: NetworkTarget[];
    /** Code-built LinkedIn people-search links. Always safe, never scraped. */
    searchLinks: { label: string; url: string }[];
    /** False means: suggest importing Connections.csv. */
    hasContactsImported: boolean;
};

// ─── talent ("elite workplace fit")

export type TalentData = {
    /** Cited qualitative note, e.g. "Engineering hires skew to IIT/BITS per …". */
    note: string | null;
    confidence: 'low' | 'medium' | 'high';
    facts: CitedFact[];
};

// ─── openings (company-signal posts)

export type OpeningsData = {
    companies: {
        name: string;
        openings: { title: string; location: string | null; url: string; postedAt: string | null }[];
        /** Radar already watches this company's board. */
        tracked: boolean;
        /** Why there are no openings, when there are none. */
        note: string | null;
    }[];
};

// ─── digest (knowledge posts)

export type DigestData = {
    title: string;
    takeaways: string[];
    tags: string[];
    savedInsightId: string | null;
};

// ─── capture (work notes → Work Log)

export type CaptureData = {
    /** The draft Win, or the existing Win this note would merge into. */
    winId: string;
    title: string;
    narrative: string;
    category: string;
    skills: string[];
    /**
     * `draft`: a new draft awaiting the user's Confirm (confirming is what
     * writes Evidence — CLAUDE.md rule 5; capture never confirms on its own).
     * `merge_proposed`: near-duplicate of `duplicateOfWinId`.
     */
    status: 'draft' | 'merge_proposed';
    duplicateOfWinId: string | null;
    /** True when the numeric guard had to strip a quantity the note did not state. */
    degraded: boolean;
};

// ─── track (jobs → the job tracker)

/** ApplicationStatus values, as strings so client bundles need no Prisma. */
export type TrackedStatus =
    | 'discovered' | 'analyzed' | 'drafting' | 'in_progress' | 'submitted' | 'applied'
    | 'in_review' | 'interview' | 'offer' | 'rejected' | 'ghosted' | 'archived';

export type TrackData = {
    workspaceId: string;
    status: TrackedStatus;
    /** False when the job was already in the tracker (e.g. from the extension). */
    created: boolean;
};

export type ScoutSectionData = {
    ingest: IngestData;
    classify: ClassifyData;
    jd: JdData;
    fit: FitData;
    company: CompanyData;
    comp: CompData;
    interviews: InterviewsData;
    network: NetworkData;
    talent: TalentData;
    openings: OpeningsData;
    digest: DigestData;
    capture: CaptureData;
    track: TrackData;
};

export type ScoutSections = { [K in ScoutSectionName]?: StoredSection<ScoutSectionData[K]> };

// ─────────────────────────────────────────────────────────────── drafts

export type DraftTarget = 'poster' | 'recruiter' | 'hiring_manager' | 'referral' | 'alumni';
export type DraftFormat = 'linkedin_note' | 'linkedin_message' | 'email';

/** LinkedIn connection notes are capped at 300 characters. */
export const LINKEDIN_NOTE_MAX = 300;

export type OutreachDraft = {
    id: string;
    target: DraftTarget;
    format: DraftFormat;
    /** The person, when a specific one was chosen. */
    recipientName: string | null;
    subject: string | null;
    body: string;
    createdAt: string;
};

// ───────────────────────────────────────────────────────────── the view

/** What the dashboard and channels render. Built by `src/services/scout.ts`. */
export type ScoutRunView = {
    id: string;
    status: 'queued' | 'running' | 'awaiting_input' | 'succeeded' | 'partial' | 'failed';
    kind: ScoutKind | null;
    input: ScoutInput;
    channel: string;
    sections: ScoutSections;
    /** Timeline order for the kind; sections not yet run are `pending`. */
    plan: ScoutSectionName[];
    pendingQuestion: PendingQuestion | null;
    drafts: OutreachDraft[];
    headline: string;
    createdAt: string;
    finishedAt: string | null;
    error: string | null;
};

export type ScoutRunSummary = {
    id: string;
    status: ScoutRunView['status'];
    kind: ScoutKind | null;
    headline: string;
    url: string | null;
    createdAt: string;
};

export type { SourceRef };
