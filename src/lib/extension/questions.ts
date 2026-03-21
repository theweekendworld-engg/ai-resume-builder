import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { parseWithRetry } from '@/lib/aiSchemas';
import { config } from '@/lib/config';
import { buildQuestionFingerprint } from '@/lib/extension/questionIdentity';
import { prisma } from '@/lib/prisma';
import { checkAiRateLimit } from '@/lib/rateLimit';
import { parseUserGenerationPreferences } from '@/lib/userPreferences';
import type {
  ExtensionProfileBundle,
  ExtensionQuestionSaveRequest,
  ExtensionQuestionSaveResponse,
  ExtensionQuestionSuggestRequest,
  ExtensionQuestionSuggestResponse,
  ExtensionQuestionTone,
} from '@/lib/extension/schemas';
import { trackedChatCompletion } from '@/lib/usageTracker';

type QuestionType = 'why_company' | 'why_role' | 'self_intro' | 'project_story' | 'experience_with_skill' | 'cover_letter' | 'eligibility' | 'compensation' | 'other';
type SourceType = 'profile' | 'preferences' | 'experience' | 'project' | 'education' | 'job_context';

type GroundingFact = {
  id: string;
  sourceType: SourceType;
  title: string;
  detail: string;
  score: number;
};

type PreferenceAnswer = NonNullable<ExtensionQuestionSuggestResponse['preferenceAnswer']>;

const GeneratedDraftPayloadSchema = z.object({
  drafts: z.array(z.object({
    tone: z.enum(['concise', 'balanced', 'high_conviction']),
    answer: z.string().min(1).max(5000),
    confidence: z.number().min(0).max(1),
    sourceFactIds: z.array(z.string()).max(8).default([]),
    warnings: z.array(z.string().max(500)).max(6).default([]),
  })).min(1).max(3),
});

function normalizeText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9+#./\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const trimmed = String(value || '').trim();
    const normalized = normalizeText(trimmed);
    if (!trimmed || !normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(trimmed);
  }

  return output;
}

function buildPreferenceAnswer(
  questionFingerprint: string,
  preferences: ReturnType<typeof parseUserGenerationPreferences>
): PreferenceAnswer | null {
  const workModes = preferences.preferredWorkModes;

  if (questionFingerprint === 'eligibility:work_authorization') {
    const parts = uniqueStrings([
      preferences.workAuthorization,
      preferences.requiresSponsorship === 'no' ? 'I do not require visa sponsorship.' : '',
      preferences.requiresSponsorship === 'yes' ? 'I require visa sponsorship.' : '',
      preferences.requiresSponsorship === 'case_by_case' ? 'My sponsorship needs depend on the role and location.' : '',
    ]);

    if (parts.length === 0) return null;

    return {
      key: 'work_authorization',
      label: 'Work authorization',
      answerText: parts.join(' '),
      confidence: 0.94,
      sourceSummary: 'Built from your saved work authorization and sponsorship preferences.',
    };
  }

  if (questionFingerprint === 'eligibility:sponsorship') {
    const answerText = preferences.requiresSponsorship === 'no'
      ? 'No, I do not require visa sponsorship.'
      : preferences.requiresSponsorship === 'yes'
        ? 'Yes, I require visa sponsorship.'
        : preferences.requiresSponsorship === 'case_by_case'
          ? 'My sponsorship needs depend on the role, location, and visa context.'
          : '';

    if (!answerText) return null;

    return {
      key: 'sponsorship',
      label: 'Sponsorship',
      answerText,
      confidence: 0.97,
      sourceSummary: 'Built from your saved sponsorship preference.',
    };
  }

  if (questionFingerprint === 'compensation:relocation') {
    const answerText = preferences.willingToRelocate === 'yes'
      ? 'Yes, I am open to relocation.'
      : preferences.willingToRelocate === 'no'
        ? 'No, I am not looking to relocate at this time.'
        : preferences.willingToRelocate === 'case_by_case'
          ? 'I am open to relocation on a case-by-case basis.'
          : '';

    if (!answerText) return null;

    return {
      key: 'relocation',
      label: 'Relocation',
      answerText,
      confidence: 0.95,
      sourceSummary: 'Built from your saved relocation preference.',
    };
  }

  if (questionFingerprint === 'compensation:work_mode') {
    if (workModes.length === 0) return null;

    return {
      key: 'work_mode',
      label: 'Work mode',
      answerText: `My preferred work modes are ${workModes.join(', ')}.`,
      confidence: 0.9,
      sourceSummary: 'Built from your saved work-mode preference.',
    };
  }

  if (questionFingerprint === 'compensation:desired_compensation' || questionFingerprint === 'compensation:general') {
    if (!preferences.desiredCompensation.trim()) return null;

    return {
      key: 'desired_compensation',
      label: 'Desired compensation',
      answerText: `My target compensation range is ${preferences.desiredCompensation.trim()}.`,
      confidence: 0.92,
      sourceSummary: 'Built from your saved compensation preference.',
    };
  }

  if (questionFingerprint === 'compensation:notice_period') {
    if (!preferences.noticePeriod.trim()) return null;

    return {
      key: 'notice_period',
      label: 'Notice period',
      answerText: `My notice period is ${preferences.noticePeriod.trim()}.`,
      confidence: 0.93,
      sourceSummary: 'Built from your saved notice-period preference.',
    };
  }

  return null;
}

function toConfidenceBand(score: number): 'high' | 'medium' | 'low' {
  if (score >= 0.8) return 'high';
  if (score >= 0.55) return 'medium';
  return 'low';
}

function scoreTextOverlap(text: string, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const normalized = normalizeText(text);
  let score = 0;

  for (const token of tokens) {
    if (!token) continue;
    if (normalized.includes(token)) score += token.length > 6 ? 1.4 : 1;
  }

  return score;
}

function classifyQuestion(input: ExtensionQuestionSuggestRequest) {
  const combinedText = [
    input.question.questionText,
    ...(input.question.helperText ?? []),
    input.question.sectionHeading ?? '',
  ].join(' ');
  const normalized = normalizeText(combinedText);
  const reasons: string[] = [];
  let type: QuestionType = input.question.typeHint ?? 'other';
  let score = input.question.typeHint ? 0.72 : 0.46;

  if (input.question.typeHint) {
    reasons.push(`Page parser hinted ${input.question.typeHint}.`);
  }

  const rules: Array<{ type: QuestionType; match: RegExp; score: number; reason: string }> = [
    { type: 'cover_letter', match: /cover letter|motivation letter|application statement/, score: 0.96, reason: 'Prompt reads like a cover-letter request.' },
    { type: 'why_company', match: /why.*(company|here|us|join)|what interests you about/, score: 0.95, reason: 'Prompt asks for company motivation.' },
    { type: 'why_role', match: /why.*(role|position|job)|why are you a fit|why should we hire you/, score: 0.93, reason: 'Prompt asks for role fit.' },
    { type: 'self_intro', match: /tell us about yourself|introduce yourself|self intro|walk us through your background/, score: 0.94, reason: 'Prompt asks for a personal introduction.' },
    { type: 'project_story', match: /project|build|ship|proud of|accomplishment|achievement/, score: 0.88, reason: 'Prompt asks for project or accomplishment proof.' },
    { type: 'experience_with_skill', match: /experience with|worked with|familiar with|how have you used|used .* in production/, score: 0.9, reason: 'Prompt asks for specific skill evidence.' },
    { type: 'eligibility', match: /authorized|eligible|citizen|visa|sponsorship|require sponsorship/, score: 0.96, reason: 'Prompt appears to be an eligibility question.' },
    { type: 'compensation', match: /salary|compensation|pay range|desired pay|notice period|start date/, score: 0.95, reason: 'Prompt appears to be a compensation or logistics question.' },
  ];

  for (const rule of rules) {
    if (rule.match.test(normalized) && rule.score > score) {
      type = rule.type;
      score = rule.score;
      reasons.push(rule.reason);
    }
  }

  if (type === 'other' && input.question.answerMode === 'long_text') {
    score = Math.max(score, 0.58);
    reasons.push('Long-form text area is likely to need a custom answer.');
  }

  return {
    type,
    confidenceScore: Math.min(0.99, score),
    confidenceBand: toConfidenceBand(score),
    reasons: uniqueStrings(reasons).slice(0, 4),
  };
}

function buildGroundingFacts(bundle: ExtensionProfileBundle, input: ExtensionQuestionSuggestRequest, classification: ReturnType<typeof classifyQuestion>): GroundingFact[] {
  const context = input.context;
  const preferences = parseUserGenerationPreferences(bundle.profile.preferences);
  const queryTokens = uniqueStrings([
    ...tokenize(input.question.questionText),
    ...tokenize((input.question.helperText ?? []).join(' ')),
    ...tokenize(context?.roleTitle ?? ''),
    ...tokenize(context?.companyName ?? ''),
    ...tokenize((context?.jobDescription ?? '').slice(0, 2200)),
  ]);

  const facts: GroundingFact[] = [];
  const profileSnippets = uniqueStrings([
    bundle.profile.defaultTitle,
    bundle.profile.defaultSummary,
    bundle.profile.yearsExperience ? `${bundle.profile.yearsExperience} years of experience` : '',
    bundle.profile.location,
  ]).filter(Boolean);

  if (profileSnippets.length > 0) {
    facts.push({
      id: 'profile-summary',
      sourceType: 'profile',
      title: bundle.profile.fullName ? `${bundle.profile.fullName} profile` : 'Profile summary',
      detail: profileSnippets.join(' | '),
      score: 2.8 + scoreTextOverlap(profileSnippets.join(' '), queryTokens),
    });
  }

  const preferenceSnippets = uniqueStrings([
    preferences.workAuthorization,
    preferences.requiresSponsorship !== 'unknown' ? `Sponsorship: ${preferences.requiresSponsorship}` : '',
    preferences.willingToRelocate !== 'unknown' ? `Relocation: ${preferences.willingToRelocate}` : '',
    preferences.preferredWorkModes.length > 0 ? `Preferred work modes: ${preferences.preferredWorkModes.join(', ')}` : '',
    preferences.desiredCompensation ? `Desired compensation: ${preferences.desiredCompensation}` : '',
    preferences.noticePeriod ? `Notice period: ${preferences.noticePeriod}` : '',
  ]);

  if (preferenceSnippets.length > 0) {
    facts.push({
      id: 'preferences',
      sourceType: 'preferences',
      title: 'Application preferences',
      detail: preferenceSnippets.join(' | '),
      score: 1.8 + scoreTextOverlap(preferenceSnippets.join(' '), queryTokens),
    });
  }

  if (context?.roleTitle || context?.companyName || context?.jobDescription) {
    facts.push({
      id: 'job-context',
      sourceType: 'job_context',
      title: [context.companyName, context.roleTitle].filter(Boolean).join(' - ') || 'Job context',
      detail: uniqueStrings([
        context.roleTitle ?? '',
        context.companyName ?? '',
        context.location ?? '',
        (context.jobDescription ?? '').slice(0, 600),
      ]).join(' | '),
      score: 2.4 + scoreTextOverlap([
        context.roleTitle ?? '',
        context.companyName ?? '',
        context.jobDescription ?? '',
      ].join(' '), queryTokens),
    });
  }

  for (const experience of bundle.experiences) {
    const detail = uniqueStrings([
      `${experience.role} at ${experience.company}`,
      experience.description,
      ...(experience.highlights ?? []).slice(0, 3),
    ]).join(' | ');

    if (!detail) continue;
    facts.push({
      id: `experience:${experience.id}`,
      sourceType: 'experience',
      title: `${experience.role} at ${experience.company}`,
      detail,
      score: 1.2 + scoreTextOverlap(detail, queryTokens),
    });
  }

  for (const project of bundle.projects) {
    const detail = uniqueStrings([
      project.description,
      ...(project.technologies ?? []).slice(0, 8),
      project.url,
      project.githubUrl ?? '',
    ]).join(' | ');

    if (!detail) continue;
    facts.push({
      id: `project:${project.id}`,
      sourceType: 'project',
      title: project.name,
      detail,
      score: 1 + scoreTextOverlap(`${project.name} ${detail}`, queryTokens),
    });
  }

  for (const education of bundle.education) {
    const detail = uniqueStrings([
      education.degree,
      education.fieldOfStudy,
      education.institution,
    ]).join(' | ');

    if (!detail) continue;
    facts.push({
      id: `education:${education.id}`,
      sourceType: 'education',
      title: education.institution,
      detail,
      score: 0.4 + scoreTextOverlap(detail, queryTokens),
    });
  }

  const boosted = facts.map((fact) => {
    let bonus = 0;

    if (classification.type === 'self_intro' && fact.sourceType === 'profile') bonus += 1.5;
    if (classification.type === 'cover_letter' && fact.sourceType === 'job_context') bonus += 1.1;
    if (classification.type === 'project_story' && fact.sourceType === 'project') bonus += 1.2;
    if (classification.type === 'experience_with_skill' && (fact.sourceType === 'experience' || fact.sourceType === 'project')) bonus += 1.1;
    if (classification.type === 'why_role' && fact.sourceType === 'job_context') bonus += 1;
    if ((classification.type === 'eligibility' || classification.type === 'compensation') && fact.sourceType === 'preferences') bonus += 1.8;

    return {
      ...fact,
      score: fact.score + bonus,
    };
  });

  return boosted
    .sort((left, right) => right.score - left.score)
    .slice(0, 6);
}

function getToneOrder(selectedTone: ExtensionQuestionTone): ExtensionQuestionTone[] {
  const tones: ExtensionQuestionTone[] = ['concise', 'balanced', 'high_conviction'];
  return [selectedTone, ...tones.filter((tone) => tone !== selectedTone)];
}

function buildFallbackDrafts(selectedTone: ExtensionQuestionTone, facts: GroundingFact[], questionText: string) {
  const topFacts = facts.slice(0, 3);
  const factSummary = topFacts.map((fact) => fact.detail).join(' ');
  const answerBase = factSummary
    ? `Based on my background, ${factSummary}`
    : `I can answer "${questionText}" more accurately after reviewing the details on this application.`;

  const drafts: ExtensionQuestionSuggestResponse['drafts'] = [{
    tone: selectedTone,
    answer: answerBase.slice(0, 2200),
    confidence: topFacts.length > 0 ? 0.56 : 0.28,
    sourceFactsUsed: topFacts.map((fact) => ({
      id: fact.id,
      sourceType: fact.sourceType,
      title: fact.title,
      detail: fact.detail,
    })),
    warnings: topFacts.length > 0 ? ['This fallback draft is grounded but may need polishing before you insert it.'] : ['Not enough grounded profile detail was available to draft a strong answer automatically.'],
  }];

  return drafts;
}

async function generateDrafts(params: {
  userId: string;
  input: ExtensionQuestionSuggestRequest;
  classification: ReturnType<typeof classifyQuestion>;
  facts: GroundingFact[];
}): Promise<ExtensionQuestionSuggestResponse['drafts']> {
  const toneOrder = getToneOrder(params.input.selectedTone);
  const prompt = `You write grounded job-application answers.

QUESTION:
${params.input.question.questionText}

QUESTION TYPE:
${params.classification.type}

ANSWER MODE:
${params.input.question.answerMode}

SELECTED TONE:
${params.input.selectedTone}

ROLE + COMPANY CONTEXT:
- role: ${params.input.context?.roleTitle || 'unknown'}
- company: ${params.input.context?.companyName || 'unknown'}
- location: ${params.input.context?.location || 'unknown'}
- page title: ${params.input.context?.visibleTitle || 'unknown'}

HELPER TEXT:
${(params.input.question.helperText ?? []).join('\n') || 'none'}

JOB DESCRIPTION EXCERPT:
${(params.input.context?.jobDescription ?? '').slice(0, 2500) || 'none'}

GROUNDING FACTS:
${params.facts.map((fact) => `- ${fact.id} | ${fact.sourceType} | ${fact.title} | ${fact.detail}`).join('\n')}

Return ONLY valid JSON in this shape:
{
  "drafts": [
    {
      "tone": "concise" | "balanced" | "high_conviction",
      "answer": "string",
      "confidence": 0.0,
      "sourceFactIds": ["fact-id"],
      "warnings": ["string"]
    }
  ]
}

Rules:
- Write exactly ${toneOrder.length} drafts, one for each tone in this order: ${toneOrder.join(', ')}.
- Use first-person voice.
- Do not invent metrics, employers, dates, technologies, visas, compensation, or company claims.
- Keep answers grounded in the listed facts. If something is inferred, add a warning.
- For short_text answers stay under 70 words. For long_text answers stay under 160 words.
- Do not use markdown, bullets, or greetings.
- Every draft must cite 1-4 sourceFactIds from the list above.`;

  const response = await trackedChatCompletion({
    model: config.openai.models.general,
    messages: [
      {
        role: 'system',
        content: 'You are a careful application-writing copilot. You maximize relevance while preserving factual truth.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
  }, {
    userId: params.userId,
    operation: 'extension_question_suggest',
    metadata: {
      questionType: params.classification.type,
      answerMode: params.input.question.answerMode,
      factCount: params.facts.length,
      selectedTone: params.input.selectedTone,
    },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    return buildFallbackDrafts(params.input.selectedTone, params.facts, params.input.question.questionText);
  }

  const parsed = await parseWithRetry(content, GeneratedDraftPayloadSchema);
  if (!parsed.success) {
    return buildFallbackDrafts(params.input.selectedTone, params.facts, params.input.question.questionText);
  }

  const factMap = new Map(params.facts.map((fact) => [fact.id, fact]));
  return parsed.data.drafts.map((draft) => ({
    tone: draft.tone,
    answer: draft.answer,
    confidence: draft.confidence,
    sourceFactsUsed: draft.sourceFactIds
      .map((factId) => factMap.get(factId))
      .filter((fact): fact is GroundingFact => Boolean(fact))
      .slice(0, 4)
      .map((fact) => ({
        id: fact.id,
        sourceType: fact.sourceType,
        title: fact.title,
        detail: fact.detail,
      })),
    warnings: draft.warnings,
  }));
}

export async function suggestExtensionQuestionAnswers(params: {
  userId: string;
  input: ExtensionQuestionSuggestRequest;
  bundle: ExtensionProfileBundle;
}): Promise<ExtensionQuestionSuggestResponse> {
  const classification = classifyQuestion(params.input);
  const questionFingerprint = buildQuestionFingerprint({
    questionText: params.input.question.questionText,
    helperText: params.input.question.helperText,
    type: classification.type,
  });
  const preferences = parseUserGenerationPreferences(params.bundle.profile.preferences);
  const facts = buildGroundingFacts(params.bundle, params.input, classification);
  const reusableAnswer = await prisma.reusableAnswer.findUnique({
    where: {
      userId_questionFingerprint: {
        userId: params.userId,
        questionFingerprint,
      },
    },
    select: {
      id: true,
      canonicalQuestion: true,
      answerText: true,
      usageCount: true,
      autoUse: true,
    },
  });
  const preferenceAnswer = buildPreferenceAnswer(questionFingerprint, preferences);
  const warnings = uniqueStrings([
    facts.length < 2 ? 'This answer is based on limited profile evidence, so review it carefully before inserting.' : '',
    !params.input.context?.companyName && classification.type === 'why_company'
      ? 'Company name was not confidently detected on the page, so the answer stays generic.'
      : '',
    !params.input.context?.roleTitle && classification.type === 'why_role'
      ? 'Role title was not confidently detected on the page, so the answer stays broad.'
      : '',
    reusableAnswer ? 'A saved reusable answer is available for this question pattern.' : '',
    preferenceAnswer ? preferenceAnswer.sourceSummary : '',
  ]).slice(0, 4);

  let drafts: ExtensionQuestionSuggestResponse['drafts'] = [];
  const reusableDraft = reusableAnswer
    ? [{
      tone: params.input.selectedTone,
      answer: reusableAnswer.answerText,
      confidence: reusableAnswer.autoUse ? 0.95 : 0.88,
      sourceFactsUsed: facts.filter((fact) => fact.sourceType === 'preferences' || fact.sourceType === 'profile').slice(0, 2).map((fact) => ({
        id: fact.id,
        sourceType: fact.sourceType,
        title: fact.title,
        detail: fact.detail,
      })),
      warnings: [reusableAnswer.autoUse
        ? 'This reusable answer was previously marked as safe to use for similar questions. Review it before inserting.'
        : 'This answer comes from a previously accepted response. Review it before inserting.'],
    }]
    : [];

  if (preferenceAnswer) {
    drafts = [{
      tone: params.input.selectedTone,
      answer: preferenceAnswer.answerText,
      confidence: preferenceAnswer.confidence,
      sourceFactsUsed: facts
        .filter((fact) => fact.sourceType === 'preferences')
        .slice(0, 1)
        .map((fact) => ({
          id: fact.id,
          sourceType: fact.sourceType,
          title: fact.title,
          detail: fact.detail,
        })),
      warnings: ['This answer was built from your saved application preferences. Double-check it before inserting.'],
    }];
  } else if (reusableAnswer && (reusableAnswer.autoUse || classification.type === 'eligibility' || classification.type === 'compensation')) {
    drafts = reusableDraft;
  } else if (classification.type === 'eligibility' || classification.type === 'compensation') {
    warnings.unshift('This looks like a legal, eligibility, or compensation question. Save your preferences or answer it manually to avoid mistakes.');
  } else {
    const limit = await checkAiRateLimit(`ai:extension:questions:${params.userId}`);
    if (!limit.allowed) {
      throw new Error(limit.error);
    }

    drafts = await generateDrafts({
      userId: params.userId,
      input: params.input,
      classification,
      facts,
    });
  }

  const questionText = params.input.question.questionText.trim();
  const answerMode = params.input.question.answerMode;
  const sourceFacts = facts.map((fact) => ({
    id: fact.id,
    sourceType: fact.sourceType,
    title: fact.title,
    detail: fact.detail,
  })) as Prisma.InputJsonValue;
  const questionData = {
    workspaceId: params.input.context?.workspaceId ?? null,
    sourceUrl: params.input.context?.sourceUrl,
    platform: params.input.context?.platform,
    companyName: params.input.context?.companyName,
    roleTitle: params.input.context?.roleTitle,
    questionText,
    questionType: classification.type,
    answerMode,
    helperText: params.input.question.helperText as Prisma.InputJsonValue,
    draftAnswers: drafts as Prisma.InputJsonValue,
    sourceFacts,
    warnings: warnings as Prisma.InputJsonValue,
    selectedTone: params.input.selectedTone,
    confidence: drafts.length > 0
      ? Math.max(...drafts.map((draft) => draft.confidence))
      : classification.confidenceScore,
  };

  const existingQuestionFilters: Prisma.ApplicationQuestionWhereInput[] = [];
  if (params.input.context?.workspaceId) {
    existingQuestionFilters.push({
      workspaceId: params.input.context.workspaceId,
      questionText,
      answerMode,
    });
  }
  if (params.input.context?.sourceUrl) {
    existingQuestionFilters.push({
      sourceUrl: params.input.context.sourceUrl,
      questionText,
      answerMode,
    });
  }
  if (params.input.context?.companyName?.trim() && params.input.context?.roleTitle?.trim()) {
    existingQuestionFilters.push({
      companyName: params.input.context.companyName.trim(),
      roleTitle: params.input.context.roleTitle.trim(),
      questionText,
      answerMode,
    });
  }

  const existingQuestion = existingQuestionFilters.length > 0
    ? await prisma.applicationQuestion.findFirst({
      where: {
        userId: params.userId,
        OR: existingQuestionFilters,
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    })
    : null;

  const questionRecord = existingQuestion
    ? await prisma.applicationQuestion.update({
      where: {
        id: existingQuestion.id,
      },
      data: questionData,
      select: {
        id: true,
      },
    })
    : await prisma.applicationQuestion.create({
      data: {
        userId: params.userId,
        ...questionData,
      },
      select: {
        id: true,
      },
    });

  return {
    success: true,
    questionId: questionRecord.id,
    classification,
    drafts,
    warnings,
    suggestedTone: params.input.selectedTone,
    reusableAnswer: reusableAnswer
      ? {
        id: reusableAnswer.id,
        canonicalQuestion: reusableAnswer.canonicalQuestion,
        answerText: reusableAnswer.answerText,
        usageCount: reusableAnswer.usageCount,
        autoUse: reusableAnswer.autoUse,
        matchReason: reusableAnswer.autoUse
          ? 'You marked this answer as reusable for similar questions.'
          : 'A previous accepted answer matches this question pattern.',
      }
      : undefined,
    preferenceAnswer: preferenceAnswer ?? undefined,
  };
}

export async function saveExtensionQuestionAnswer(params: {
  userId: string;
  input: ExtensionQuestionSaveRequest;
}): Promise<ExtensionQuestionSaveResponse> {
  const existing = await prisma.applicationQuestion.findFirst({
    where: {
      id: params.input.questionId,
      userId: params.userId,
    },
    select: {
      id: true,
      questionText: true,
      questionType: true,
      answerMode: true,
      helperText: true,
    },
  });

  if (!existing) {
    throw new Error('Application question not found');
  }

  const updated = await prisma.applicationQuestion.update({
    where: {
      id: params.input.questionId,
    },
    data: {
      finalAnswer: params.input.finalAnswer,
      selectedTone: params.input.selectedTone,
    },
    select: {
      id: true,
      updatedAt: true,
    },
  });

  let reusableAnswerId: string | undefined;
  let reusableAnswerSaved = false;

  if (params.input.saveAsReusable || params.input.alwaysUseForSimilar) {
    const questionFingerprint = buildQuestionFingerprint({
      questionText: existing.questionText,
      helperText: existing.helperText,
      type: (existing.questionType as QuestionType) ?? 'other',
    });

    const reusable = await prisma.reusableAnswer.upsert({
      where: {
        userId_questionFingerprint: {
          userId: params.userId,
          questionFingerprint,
        },
      },
      create: {
        userId: params.userId,
        questionFingerprint,
        canonicalQuestion: existing.questionText,
        questionType: existing.questionType,
        answerMode: existing.answerMode,
        answerText: params.input.finalAnswer,
        usageCount: 1,
        autoUse: params.input.alwaysUseForSimilar,
        sourceQuestionId: existing.id,
        lastUsedAt: new Date(),
        metadata: {
          savedFrom: 'extension',
        } as Prisma.InputJsonValue,
      },
      update: {
        canonicalQuestion: existing.questionText,
        questionType: existing.questionType,
        answerMode: existing.answerMode,
        answerText: params.input.finalAnswer,
        usageCount: {
          increment: 1,
        },
        autoUse: params.input.alwaysUseForSimilar ? true : undefined,
        sourceQuestionId: existing.id,
        lastUsedAt: new Date(),
      },
      select: {
        id: true,
      },
    });

    reusableAnswerId = reusable.id;
    reusableAnswerSaved = true;
  }

  return {
    success: true,
    questionId: updated.id,
    savedAt: updated.updatedAt.toISOString(),
    reusableAnswerSaved,
    reusableAnswerId,
  };
}
