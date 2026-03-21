import { z } from 'zod';

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
  elementPath: z.string().min(1).max(5000),
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
  sourceType: z.enum(['profile', 'experience', 'project', 'education', 'job_context']),
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
});

export const ExtensionQuestionSaveRequestSchema = z.object({
  questionId: z.string().min(1).max(255),
  finalAnswer: z.string().min(1).max(5000),
  selectedTone: ExtensionQuestionToneSchema.optional(),
});

export const ExtensionQuestionSaveResponseSchema = z.object({
  success: z.literal(true),
  questionId: z.string(),
  savedAt: z.string().datetime(),
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
