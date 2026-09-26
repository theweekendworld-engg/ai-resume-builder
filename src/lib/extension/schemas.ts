import { z } from 'zod';

export function normalizeExtensionRequestBody(value: unknown): unknown {
  if (value === null) return undefined;

  if (Array.isArray(value)) {
    return value.map((item) => normalizeExtensionRequestBody(item));
  }

  if (typeof value === 'object' && value) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nestedValue]) => nestedValue !== null)
        .map(([key, nestedValue]) => [key, normalizeExtensionRequestBody(nestedValue)])
    );
  }

  return value;
}

export const ExtensionPlatformSchema = z.enum([
  'linkedin',
  'greenhouse',
  'lever',
  'workday',
  'indeed',
  'wellfound',
  'generic',
]);

export const ExtensionPageKindSchema = z.enum([
  'job_detail',
  'application_form',
  'multi_step_application',
  'auth_gate',
  'unsupported',
  'unknown',
]);

export const ExtensionConfidenceBandSchema = z.enum(['high', 'medium', 'low']);

export const ExtensionReducedRegionSchema = z.object({
  id: z.string().max(255),
  kind: z.enum(['dialog', 'form', 'main', 'sidebar', 'section']),
  elementPath: z.preprocess(
    (value) => typeof value === 'string' && value.trim().length === 0 ? 'body' : value,
    z.string().min(1).max(5000)
  ),
  textSample: z.string().max(4000),
  visibleTextLength: z.number().int().min(0),
  interactiveCount: z.number().int().min(0),
  score: z.number().min(0).max(1),
});

export const ExtensionPageClassificationSchema = z.object({
  platform: ExtensionPlatformSchema,
  pageKind: ExtensionPageKindSchema,
  confidenceBand: ExtensionConfidenceBandSchema,
  confidenceScore: z.number().min(0).max(1),
  reasons: z.array(z.string().max(300)).default([]),
});

export const FieldLocatorSchema = z.object({
  cssPath: z.string().min(1).max(5000),
  name: z.string().max(500).optional(),
  id: z.string().max(500).optional(),
  nthIndex: z.number().int().min(0).optional(),
});

export const NormalizedFieldSchema = z.object({
  key: z.string().max(120).optional(),
  label: z.string().max(1000),
  inputType: z.enum(['text', 'email', 'tel', 'url', 'textarea', 'select', 'radio', 'checkbox', 'file', 'unknown']),
  required: z.boolean().default(false),
  confidenceBand: ExtensionConfidenceBandSchema,
  confidenceScore: z.number().min(0).max(1),
  reasons: z.array(z.string().max(300)).default([]),
  sectionHeading: z.string().max(500).optional(),
  options: z.array(z.string().max(500)).default([]),
  locator: FieldLocatorSchema,
});

export const NormalizedQuestionSchema = z.object({
  id: z.string().max(255),
  questionText: z.string().max(5000),
  typeHint: z.enum([
    'why_company',
    'why_role',
    'self_intro',
    'project_story',
    'experience_with_skill',
    'cover_letter',
    'eligibility',
    'compensation',
    'other',
  ]),
  answerMode: z.enum(['short_text', 'long_text', 'single_select', 'multi_select']),
  confidenceBand: ExtensionConfidenceBandSchema,
  confidenceScore: z.number().min(0).max(1),
  helperText: z.array(z.string().max(1000)).max(8).default([]),
  sectionHeading: z.string().max(500).optional(),
  locator: FieldLocatorSchema,
});

export const ExtensionJobMetadataSchema = z.object({
  companyName: z.string().max(500).optional(),
  roleTitle: z.string().max(500).optional(),
  location: z.string().max(500).optional(),
  employmentType: z.string().max(200).optional(),
  workplaceType: z.enum(['remote', 'hybrid', 'onsite', 'unknown']).optional(),
  compensationText: z.string().max(1000).optional(),
});

export const ExtensionJobDescriptionSchema = z.object({
  text: z.string().max(100000),
  confidenceBand: ExtensionConfidenceBandSchema,
  confidenceScore: z.number().min(0).max(1),
  sourceHint: z.string().max(300).optional(),
});

export const ExtensionParsedPageSchema = z.object({
  url: z.string().url().max(3000),
  visibleTitle: z.string().max(1000).optional(),
  heading: z.string().max(1000).optional(),
  classification: ExtensionPageClassificationSchema,
  metadata: ExtensionJobMetadataSchema,
  jobDescription: ExtensionJobDescriptionSchema.optional(),
  reducedRegions: z.array(ExtensionReducedRegionSchema).max(25).default([]),
  fields: z.array(NormalizedFieldSchema).max(250).default([]),
  questions: z.array(NormalizedQuestionSchema).max(50).default([]),
  stats: z.object({
    visibleFieldCount: z.number().int().min(0).default(0),
    requiredFieldCount: z.number().int().min(0).default(0),
    questionCount: z.number().int().min(0).default(0),
    reducedRegionCount: z.number().int().min(0).default(0),
  }),
  extractedAt: z.string().datetime().optional(),
});

export const ExtensionFillValueSourceSchema = z.object({
  type: z.enum(['profile', 'derived', 'manual', 'none']),
  path: z.string().max(255).optional(),
  label: z.string().max(255).optional(),
});

export const ExtensionFillActionSchema = z.object({
  id: z.string().max(255),
  action: z.enum(['auto_fill', 'review_required', 'manual_upload', 'skip']),
  fieldKey: z.string().max(120).optional(),
  fieldLabel: z.string().max(1000),
  inputType: z.enum(['text', 'email', 'tel', 'url', 'textarea', 'select', 'radio', 'checkbox', 'file', 'unknown']),
  locator: FieldLocatorSchema,
  value: z.string().max(5000).optional(),
  valuePreview: z.string().max(500).optional(),
  suggestedOption: z.string().max(500).optional(),
  canApply: z.boolean().default(false),
  reason: z.string().max(500),
  confidenceBand: ExtensionConfidenceBandSchema,
  confidenceScore: z.number().min(0).max(1),
  source: ExtensionFillValueSourceSchema,
});

export const ExtensionFillPlanSchema = z.object({
  generatedAt: z.string().datetime(),
  safeAutofillCount: z.number().int().min(0),
  reviewCount: z.number().int().min(0),
  skipCount: z.number().int().min(0),
  actions: z.array(ExtensionFillActionSchema).max(250),
});

export const ExtensionFillResultItemSchema = z.object({
  actionId: z.string().max(255),
  fieldLabel: z.string().max(1000),
  status: z.enum(['filled', 'focused', 'restored', 'skipped', 'failed']),
  reason: z.string().max(500).optional(),
});

export const ExtensionFillResultSchema = z.object({
  appliedCount: z.number().int().min(0).default(0),
  restoredCount: z.number().int().min(0).default(0),
  results: z.array(ExtensionFillResultItemSchema).max(250).default([]),
});

export const ExtensionAnalyzePageRequestSchema = z.object({
  url: z.string().url().max(3000),
  platformHint: ExtensionPlatformSchema.optional(),
  pageKindHint: ExtensionPageKindSchema.optional(),
  visibleTitle: z.string().max(1000).optional(),
  companyName: z.string().max(500).optional(),
  roleTitle: z.string().max(500).optional(),
  location: z.string().max(500).optional(),
  metadata: ExtensionJobMetadataSchema.optional(),
  jobDescription: z.string().min(20).max(100000).optional(),
  extractedJobDescription: ExtensionJobDescriptionSchema.optional(),
  normalizedPage: ExtensionParsedPageSchema.optional(),
  fields: z.array(NormalizedFieldSchema).max(250).default([]),
  questions: z.array(z.object({
    label: z.string().max(500),
    typeHint: z.string().max(120).optional(),
  })).max(50).default([]),
}).superRefine((value, ctx) => {
  const jobDescription = value.jobDescription
    || value.extractedJobDescription?.text
    || value.normalizedPage?.jobDescription?.text;

  if (!jobDescription || jobDescription.trim().length < 20) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A parsed job description with at least 20 characters is required.',
      path: ['jobDescription'],
    });
  }
});

export const ExtensionProfileBundleSchema = z.object({
  profile: z.object({
    fullName: z.string(),
    email: z.string(),
    phone: z.string(),
    location: z.string(),
    website: z.string(),
    linkedin: z.string(),
    github: z.string(),
    defaultTitle: z.string(),
    defaultSummary: z.string(),
    yearsExperience: z.string(),
    preferences: z.unknown(),
  }),
  experiences: z.array(z.object({
    id: z.string(),
    company: z.string(),
    role: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    current: z.boolean(),
    location: z.string(),
    description: z.string(),
    highlights: z.array(z.string()),
  })),
  education: z.array(z.object({
    id: z.string(),
    institution: z.string(),
    degree: z.string(),
    fieldOfStudy: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    current: z.boolean(),
  })),
  projects: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    url: z.string(),
    githubUrl: z.string().nullable(),
    technologies: z.array(z.string()),
    source: z.string(),
    updatedAt: z.date(),
  })),
});

export const ExtensionSuggestedProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  score: z.number(),
  matchReason: z.string(),
});

export const ExtensionAnalyzePageResponseSchema = z.object({
  success: z.literal(true),
  metadata: ExtensionJobMetadataSchema,
  parsedJD: z.object({
    role: z.string(),
    company: z.string(),
    requiredSkills: z.array(z.string()),
    preferredSkills: z.array(z.string()),
    experienceLevel: z.string(),
    keyResponsibilities: z.array(z.string()),
    industryDomain: z.string(),
    skillGroups: z.array(z.object({
      name: z.string(),
      skills: z.array(z.string()),
    })),
    seniorityLevel: z.string(),
    isRemote: z.boolean(),
    softSkills: z.array(z.string()),
  }),
  fitScore: z.number().int().min(0).max(100),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  matchedSkills: z.array(z.string()),
  missingSkills: z.array(z.string()),
  suggestedProjects: z.array(ExtensionSuggestedProjectSchema),
  recommendedNextAction: z.enum([
    'fill_basics',
    'tailor_resume',
    'review_before_applying',
  ]),
  summary: z.string(),
});

export const ExtensionQuestionToneSchema = z.enum([
  'concise',
  'balanced',
  'high_conviction',
]);

export const ExtensionQuestionClassificationSchema = z.object({
  type: NormalizedQuestionSchema.shape.typeHint,
  confidenceBand: ExtensionConfidenceBandSchema,
  confidenceScore: z.number().min(0).max(1),
  reasons: z.array(z.string().max(300)).default([]),
});

export const ExtensionQuestionContextSchema = z.object({
  workspaceId: z.string().max(255).optional(),
  sourceUrl: z.string().url().max(3000).optional(),
  platform: ExtensionPlatformSchema.optional(),
  pageKind: ExtensionPageKindSchema.optional(),
  visibleTitle: z.string().max(1000).optional(),
  companyName: z.string().max(500).optional(),
  roleTitle: z.string().max(500).optional(),
  location: z.string().max(500).optional(),
  jobDescription: z.string().max(100000).optional(),
});

export const ExtensionQuestionInputSchema = z.object({
  id: z.string().max(255).optional(),
  questionText: z.string().min(3).max(5000),
  helperText: z.array(z.string().max(1000)).max(8).default([]),
  typeHint: NormalizedQuestionSchema.shape.typeHint.optional(),
  answerMode: NormalizedQuestionSchema.shape.answerMode.default('long_text'),
  sectionHeading: z.string().max(500).optional(),
  locator: FieldLocatorSchema.optional(),
});

export const ExtensionAnswerSourceFactSchema = z.object({
  id: z.string().max(255),
  sourceType: z.enum(['profile', 'preferences', 'experience', 'project', 'education', 'job_context']),
  title: z.string().max(500),
  detail: z.string().max(2000),
});

export const ExtensionQuestionAnswerDraftSchema = z.object({
  tone: ExtensionQuestionToneSchema,
  answer: z.string().min(1).max(5000),
  confidence: z.number().min(0).max(1),
  sourceFactsUsed: z.array(ExtensionAnswerSourceFactSchema).max(8).default([]),
  warnings: z.array(z.string().max(500)).max(6).default([]),
});

export const ExtensionQuestionSuggestRequestSchema = z.object({
  selectedTone: ExtensionQuestionToneSchema.default('balanced'),
  question: ExtensionQuestionInputSchema,
  context: ExtensionQuestionContextSchema.optional(),
});

export const ExtensionQuestionSuggestResponseSchema = z.object({
  success: z.literal(true),
  questionId: z.string(),
  classification: ExtensionQuestionClassificationSchema,
  drafts: z.array(ExtensionQuestionAnswerDraftSchema).max(3).default([]),
  warnings: z.array(z.string().max(500)).max(8).default([]),
  suggestedTone: ExtensionQuestionToneSchema,
  reusableAnswer: z.object({
    id: z.string(),
    canonicalQuestion: z.string(),
    answerText: z.string(),
    usageCount: z.number().int().min(0),
    autoUse: z.boolean().default(false),
    matchReason: z.string(),
  }).optional(),
  preferenceAnswer: z.object({
    key: z.enum([
      'work_authorization',
      'sponsorship',
      'relocation',
      'work_mode',
      'desired_compensation',
      'notice_period',
    ]),
    label: z.string(),
    answerText: z.string(),
    confidence: z.number().min(0).max(1),
    sourceSummary: z.string(),
  }).optional(),
});

export const ExtensionQuestionSaveRequestSchema = z.object({
  questionId: z.string().min(1).max(255),
  finalAnswer: z.string().min(1).max(5000),
  selectedTone: ExtensionQuestionToneSchema.optional(),
  saveAsReusable: z.boolean().default(false),
  alwaysUseForSimilar: z.boolean().default(false),
});

export const ExtensionQuestionSaveResponseSchema = z.object({
  success: z.literal(true),
  questionId: z.string(),
  savedAt: z.string().datetime(),
  reusableAnswerSaved: z.boolean().default(false),
  reusableAnswerId: z.string().optional(),
});

/**
 * The saved-answer library (`ReusableAnswer`).
 *
 * These answers are matched to new questions by `questionFingerprint`, not by
 * exact text, which is what lets one saved answer serve "Why do you want to
 * work here?" and "What draws you to this role?". The library view therefore
 * has to show the CANONICAL question the answer was saved against, or a user
 * cannot reason about why it fired somewhere unexpected.
 */
export const ExtensionSavedAnswerSchema = z.object({
  id: z.string(),
  canonicalQuestion: z.string(),
  answerText: z.string(),
  questionType: z.string().nullable(),
  answerMode: z.string().nullable(),
  /** How many applications this answer has served. The trust signal. */
  usageCount: z.number().int().min(0),
  /** When true this answer is applied automatically to matching questions. */
  autoUse: z.boolean(),
  lastUsedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
});

export const ExtensionSavedAnswerListResponseSchema = z.object({
  success: z.literal(true),
  answers: z.array(ExtensionSavedAnswerSchema),
});

/** Every field optional: the UI edits one thing at a time. */
export const ExtensionSavedAnswerUpdateRequestSchema = z
  .object({
    answerText: z.string().min(1).max(5000).optional(),
    autoUse: z.boolean().optional(),
  })
  .refine((v) => v.answerText !== undefined || v.autoUse !== undefined, {
    message: 'Provide answerText or autoUse',
  });

export const ExtensionSavedAnswerUpdateResponseSchema = z.object({
  success: z.literal(true),
  answer: ExtensionSavedAnswerSchema,
});

export const ExtensionSavedAnswerDeleteResponseSchema = z.object({
  success: z.literal(true),
  deletedId: z.string(),
});

export const ExtensionWorkspaceStatusSchema = z.enum([
  'discovered',
  'analyzed',
  'in_progress',
  'applied',
  'archived',
]);

export const ExtensionWorkspaceSnapshotSchema = z.object({
  id: z.string(),
  userId: z.string(),
  sourcePlatform: ExtensionPlatformSchema.or(z.literal('generic')).nullable().optional(),
  sourceUrl: z.string().url().max(3000),
  companyName: z.string().nullable().optional(),
  roleTitle: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  employmentType: z.string().nullable().optional(),
  compensationText: z.string().nullable().optional(),
  jobDescription: z.string().nullable().optional(),
  applicationStatus: ExtensionWorkspaceStatusSchema,
  fitScore: z.number().int().min(0).max(100).nullable().optional(),
  fitSummary: z.string().nullable().optional(),
  companySnapshot: z.unknown().nullable().optional(),
  linkedJobTargetId: z.string().nullable().optional(),
  latestGenerationSessionId: z.string().nullable().optional(),
  selectedResumeId: z.string().nullable().optional(),
  selectedGeneratedPdfId: z.string().nullable().optional(),
  questionCount: z.number().int().min(0).default(0),
  answeredQuestionCount: z.number().int().min(0).default(0),
  lastViewedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const ExtensionWorkspaceUpsertRequestSchema = z.object({
  workspaceId: z.string().max(255).optional(),
  sourcePlatform: ExtensionPlatformSchema.optional(),
  sourceUrl: z.string().url().max(3000),
  companyName: z.string().max(500).optional(),
  roleTitle: z.string().max(500).optional(),
  location: z.string().max(500).optional(),
  employmentType: z.string().max(200).optional(),
  compensationText: z.string().max(1000).optional(),
  jobDescription: z.string().max(100000).optional(),
  applicationStatus: ExtensionWorkspaceStatusSchema.optional(),
  fitScore: z.number().int().min(0).max(100).optional(),
  fitSummary: z.string().max(4000).optional(),
  companySnapshot: z.unknown().optional(),
  linkedJobTargetId: z.string().max(255).optional(),
  latestGenerationSessionId: z.string().max(255).optional(),
  selectedResumeId: z.string().max(255).optional(),
  selectedGeneratedPdfId: z.string().max(255).optional(),
});

export const ExtensionWorkspaceResponseSchema = z.object({
  success: z.literal(true),
  workspace: ExtensionWorkspaceSnapshotSchema,
  matchedBy: z.enum(['id', 'source_url', 'company_role', 'created']),
});

export const ExtensionResumeGenerateRequestSchema = z.object({
  workspaceId: z.string().max(255).optional(),
  sourceResumeId: z.string().max(255).optional(),
  companyName: z.string().max(500).optional(),
  roleTitle: z.string().max(500).optional(),
  sourceUrl: z.string().url().max(3000).optional(),
  jobDescription: z.string().min(20).max(100000).optional(),
}).superRefine((value, ctx) => {
  if (!value.workspaceId && !value.jobDescription) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide a workspace ID or a job description to start resume generation.',
      path: ['jobDescription'],
    });
  }
});

/**
 * What the resume answers, compact enough for a 400px side panel.
 *
 * Without this the panel showed `atsScore: 71` and nothing else — a bare
 * number with no way to know what it measured or what is missing. That is the
 * same problem the editor had before the Job Match panel, and the extension is
 * where someone is standing on the job page with the posting open in front of
 * them, which is the best possible moment to be told what they have not
 * answered.
 *
 * Deliberately trimmed: unanswered must-haves and unevidenced skills only. The
 * full report is one tap away in the editor.
 */
export const ExtensionJobMatchSchema = z.object({
  score: z.number().int().min(0).max(100).nullable(),
  role: z.string(),
  company: z.string(),
  /** Stated requirements nothing on the resume answers, in the employer's words. */
  unanswered: z.array(z.string()).max(6),
  /** Named by the posting, evidenced nowhere — so left off the document. */
  skillGaps: z.array(z.string()).max(8),
});

export const ExtensionGenerationSessionStatusSchema = z.object({
  id: z.string(),
  status: z.enum(['pending', 'awaiting_clarification', 'generating', 'completed', 'failed']),
  currentStep: z.string(),
  stageLabel: z.string(),
  progressPercent: z.number().int().min(0).max(100),
  atsScore: z.number().int().min(0).max(100).nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  resumeId: z.string().nullable().optional(),
  editorUrl: z.string().url().optional(),
  pdfId: z.string().optional(),
  pdfUrl: z.string().url().optional(),
  elapsedMs: z.number().int().min(0),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable().optional(),
  /** Present once a v2 generation has finished. See the schema above. */
  match: ExtensionJobMatchSchema.optional(),
});

export const ExtensionResumeGenerateResponseSchema = z.object({
  success: z.literal(true),
  session: ExtensionGenerationSessionStatusSchema,
  workspace: ExtensionWorkspaceSnapshotSchema.optional(),
});

export const ExtensionCompanyInsightRequestSchema = z.object({
  workspaceId: z.string().max(255).optional(),
  companyName: z.string().max(500).optional(),
  roleTitle: z.string().max(500).optional(),
  sourceUrl: z.string().url().max(3000).optional(),
  jobDescription: z.string().max(100000).optional(),
  /**
   * Which geography the hiring question is about. Defaults to India because
   * that is the question this was built for; the machinery is not India-specific
   * (see GEOGRAPHY_BUCKETS in `src/lib/enrichment/hiring.ts`).
   */
  geography: z.string().max(64).optional(),
  forceRefresh: z.boolean().default(false),
}).superRefine((value, ctx) => {
  if (!value.workspaceId && !value.companyName && !value.sourceUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide a workspace ID or a company hint to load company intelligence.',
      path: ['companyName'],
    });
  }
});

/**
 * The observed-hiring answer, or an explained refusal.
 *
 * A discriminated union rather than a nullable signal, because "we do not have
 * enough postings to say" and "they do not hire there" are different answers
 * and the client must not be able to render one as the other. The `reason` is
 * carried so the UI can say why it declined rather than showing a blank.
 */
export const ExtensionHiringSignalSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    geography: z.string(),
    verdict: z.enum(['hires_there', 'no_observed_hiring']),
    matched: z.number().int().min(0),
    placeable: z.number().int().min(0),
    total: z.number().int().min(0),
    share: z.number().min(0).max(1),
    windowStart: z.string().datetime(),
    windowEnd: z.string().datetime(),
    latestMatchAt: z.string().datetime().nullable(),
    buckets: z.array(z.object({ bucket: z.string(), n: z.number().int().min(0) })).default([]),
    citations: z.array(z.object({
      title: z.string(),
      location: z.string().nullable(),
      absoluteUrl: z.string(),
      postedAt: z.string().datetime().nullable(),
    })).default([]),
    /** What the claim is scoped to. Must be rendered with a negative verdict. */
    scope: z.literal('observed_public_boards'),
    /** Ready-to-send sentence with the n, window and scope already inside it. */
    statement: z.string(),
  }),
  z.object({
    ok: z.literal(false),
    geography: z.string(),
    reason: z.enum(['no_postings', 'no_placeable_locations', 'insufficient_for_absence']),
    total: z.number().int().min(0),
    placeable: z.number().int().min(0),
    needed: z.number().int().min(0).optional(),
    statement: z.string(),
  }),
]);

/** Field name → where that field came from. See `src/lib/enrichment/types.ts`. */
export const ExtensionFieldProvenanceSchema = z.record(
  z.string(),
  z.object({
    source: z.enum(['job_page', 'provider', 'observed_postings']),
    provider: z.string().optional(),
    observedAt: z.string().datetime(),
  }),
);

export const ExtensionCompanyInsightResponseSchema = z.object({
  success: z.literal(true),
  insight: z.object({
    id: z.string(),
    normalizedCompanyName: z.string(),
    companyName: z.string(),
    website: z.string().nullable().optional(),
    employeeCount: z.number().int().nullable().optional(),
    fundingTotal: z.string().nullable().optional(),
    revenueEstimateText: z.string().nullable().optional(),
    reviewSummary: z.string().nullable().optional(),
    engineeringSummary: z.string().nullable().optional(),
    alumniSignalSummary: z.string().nullable().optional(),
    confidence: z.number().min(0).max(1),
    freshnessDate: z.string().datetime(),
    freshnessLabel: z.string(),
    facts: z.array(z.string()).default([]),
    interpretation: z.array(z.string()).default([]),
    sourceSummary: z.string(),
    /** Per-field attribution. Absent on rows written before enrichment. */
    provenance: ExtensionFieldProvenanceSchema.optional(),
  }),
  fit: z.object({
    fitScore: z.number().int().min(0).max(100).nullable().optional(),
    summary: z.string().nullable().optional(),
    strengths: z.array(z.string()).default([]),
    gaps: z.array(z.string()).default([]),
    matchedSkills: z.array(z.string()).default([]),
    missingSkills: z.array(z.string()).default([]),
  }).optional(),
  workspace: ExtensionWorkspaceSnapshotSchema.optional(),
  /** Absent when no geography was asked about. */
  hiring: ExtensionHiringSignalSchema.optional(),
});

export type ExtensionPlatform = z.infer<typeof ExtensionPlatformSchema>;
export type ExtensionPageKind = z.infer<typeof ExtensionPageKindSchema>;
export type ExtensionProfileBundle = z.infer<typeof ExtensionProfileBundleSchema>;
export type ExtensionAnalyzePageRequest = z.infer<typeof ExtensionAnalyzePageRequestSchema>;
export type ExtensionAnalyzePageResponse = z.infer<typeof ExtensionAnalyzePageResponseSchema>;
export type ExtensionParsedPage = z.infer<typeof ExtensionParsedPageSchema>;
export type ExtensionFillPlan = z.infer<typeof ExtensionFillPlanSchema>;
export type ExtensionFillAction = z.infer<typeof ExtensionFillActionSchema>;
export type ExtensionFillResult = z.infer<typeof ExtensionFillResultSchema>;
export type ExtensionQuestionTone = z.infer<typeof ExtensionQuestionToneSchema>;
export type ExtensionQuestionSuggestRequest = z.infer<typeof ExtensionQuestionSuggestRequestSchema>;
export type ExtensionQuestionSuggestResponse = z.infer<typeof ExtensionQuestionSuggestResponseSchema>;
export type ExtensionQuestionSaveRequest = z.infer<typeof ExtensionQuestionSaveRequestSchema>;
export type ExtensionQuestionSaveResponse = z.infer<typeof ExtensionQuestionSaveResponseSchema>;
export type ExtensionWorkspaceUpsertRequest = z.infer<typeof ExtensionWorkspaceUpsertRequestSchema>;
export type ExtensionWorkspaceResponse = z.infer<typeof ExtensionWorkspaceResponseSchema>;
export type ExtensionWorkspaceSnapshot = z.infer<typeof ExtensionWorkspaceSnapshotSchema>;
export type ExtensionResumeGenerateRequest = z.infer<typeof ExtensionResumeGenerateRequestSchema>;
export type ExtensionResumeGenerateResponse = z.infer<typeof ExtensionResumeGenerateResponseSchema>;
export type ExtensionJobMatch = z.infer<typeof ExtensionJobMatchSchema>;
export type ExtensionCompanyInsightRequest = z.infer<typeof ExtensionCompanyInsightRequestSchema>;
export type ExtensionCompanyInsightResponse = z.infer<typeof ExtensionCompanyInsightResponseSchema>;
export type ExtensionHiringSignal = z.infer<typeof ExtensionHiringSignalSchema>;
export type ExtensionSavedAnswer = z.infer<typeof ExtensionSavedAnswerSchema>;
export type ExtensionSavedAnswerListResponse = z.infer<typeof ExtensionSavedAnswerListResponseSchema>;
export type ExtensionSavedAnswerUpdateRequest = z.infer<typeof ExtensionSavedAnswerUpdateRequestSchema>;
export type ExtensionSavedAnswerUpdateResponse = z.infer<typeof ExtensionSavedAnswerUpdateResponseSchema>;
export type ExtensionSavedAnswerDeleteResponse = z.infer<typeof ExtensionSavedAnswerDeleteResponseSchema>;

// ─────────────────────────────────────────────────────────── Scout (send page)
//
// "Send to Patronus" (docs/impl/06-scout-agent.md §4). The extension reads the
// page in the user's own logged-in tab — the reliable path for LinkedIn posts,
// which often refuse a logged-out fetch — and hands the text to Scout.

export const ExtensionScoutKindHintSchema = z.enum([
  'linkedin_post',
  'linkedin_job',
  'linkedin_article',
  'job_page',
  'page',
]);

export const ExtensionScoutSendRequestSchema = z.object({
  /**
   * The post's permalink when the extension found one, else the page URL.
   * Optional on purpose: on a LinkedIn feed with no resolvable permalink, the
   * page URL is `/feed/` for every post, and sending it would dedupe every post
   * the user ever shares into one run. Without a URL the run is keyed on text.
   */
  url: z.string().url().max(3000).optional(),
  title: z.string().max(500).optional(),
  text: z.string().trim().max(100_000).optional(),
  kindHint: ExtensionScoutKindHintSchema.optional(),
  /** Post author as shown in the user's tab; the network section's first target. */
  author: z.string().trim().max(200).optional(),
  authorUrl: z.string().url().max(1000).optional(),
}).superRefine((value, ctx) => {
  if (!value.url && !value.text) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Send a url or the page text', path: ['text'] });
  }
});

export const ExtensionScoutSendResponseSchema = z.object({
  success: z.literal(true),
  runId: z.string(),
  /** False when this link was already analysed: the same run is returned, uncharged. */
  created: z.boolean(),
  status: z.enum(['queued', 'running', 'awaiting_input', 'succeeded', 'partial', 'failed']),
  headline: z.string(),
  dashboardUrl: z.string().url(),
});

export type ExtensionScoutKindHint = z.infer<typeof ExtensionScoutKindHintSchema>;
export type ExtensionScoutSendRequest = z.infer<typeof ExtensionScoutSendRequestSchema>;
export type ExtensionScoutSendResponse = z.infer<typeof ExtensionScoutSendResponseSchema>;
