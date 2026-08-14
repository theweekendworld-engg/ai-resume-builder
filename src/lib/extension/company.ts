import { Prisma } from '@prisma/client';
import { analyzeExtensionJobPage } from '@/lib/extension/analyze';
import { getExtensionProfileBundle } from '@/lib/extension/profile';
import { prisma } from '@/lib/prisma';
import type {
  ExtensionCompanyInsightRequest,
  ExtensionCompanyInsightResponse,
  ExtensionWorkspaceSnapshot,
} from '@/lib/extension/schemas';
import { getExtensionWorkspace } from '@/lib/extension/workspaces';

const PLATFORM_HOSTS = [
  'linkedin.com',
  'greenhouse.io',
  'lever.co',
  'workday.com',
  'myworkdayjobs.com',
  'indeed.com',
  'wellfound.com',
];

function normalizeText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCompanyName(value: string): string {
  return normalizeText(value)
    .replace(/\b(inc|inc\.|llc|ltd|corp|corporation|company|co)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
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

function deriveWebsite(sourceUrl?: string | null): string | null {
  if (!sourceUrl) return null;

  try {
    const url = new URL(sourceUrl);
    const host = url.hostname.toLowerCase();
    if (PLATFORM_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
      return null;
    }

    return `${url.protocol}//${host}`;
  } catch {
    return null;
  }
}

function extractEmployeeCount(jobDescription: string): number | null {
  const match = jobDescription.match(/\b(\d{2,5})(?:\+)?\s+(?:employees|people|teammates|person team|team members)\b/i);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

function extractMoneySnippet(jobDescription: string, keyword: 'funding' | 'revenue'): string | null {
  const regex = keyword === 'funding'
    ? /\b(?:raised|funding|series [a-z])[^.\n]{0,80}\$?\d[\d.,]*(?:\s?(?:m|million|b|billion))?/i
    : /\b(?:revenue|arr)[^.\n]{0,80}\$?\d[\d.,]*(?:\s?(?:m|million|b|billion))?/i;
  const match = jobDescription.match(regex);
  return match?.[0]?.trim() ?? null;
}

function findCultureSignals(jobDescription: string) {
  const text = normalizeText(jobDescription);
  const facts = uniqueStrings([
    text.includes('remote') ? 'Remote work is explicitly mentioned in the posting.' : '',
    text.includes('hybrid') ? 'Hybrid work is explicitly mentioned in the posting.' : '',
    text.includes('onsite') || text.includes('on site') ? 'On-site work expectations are mentioned in the posting.' : '',
    text.includes('fast paced') ? 'The posting explicitly describes the environment as fast-paced.' : '',
    text.includes('ownership') ? 'The posting calls for strong ownership.' : '',
    text.includes('ambiguous') || text.includes('ambiguity') ? 'The posting mentions ambiguity or operating in less-defined environments.' : '',
    text.includes('mentor') || text.includes('mentorship') ? 'Mentorship appears in the role description.' : '',
    text.includes('collaborat') ? 'Cross-functional collaboration is emphasized.' : '',
    text.includes('startup') ? 'The company or team is described with startup language.' : '',
  ]);

  const interpretation = uniqueStrings([
    text.includes('fast paced') || text.includes('ownership')
      ? 'This role likely expects autonomy and comfort moving without much hand-holding.'
      : '',
    text.includes('mentor') || text.includes('collaborat')
      ? 'The team appears to value collaboration and knowledge sharing.'
      : '',
    text.includes('ambiguous') || text.includes('startup')
      ? 'The environment may reward adaptability more than strict process.'
      : '',
    facts.length === 0
      ? 'The job page offers only limited culture signal, so treat any trust or fit read as low confidence.'
      : '',
  ]);

  return { facts, interpretation };
}

function buildEngineeringSummary(jobDescription: string, parsedJD?: {
  requiredSkills?: string[];
  preferredSkills?: string[];
  seniorityLevel?: string;
  isRemote?: boolean;
}) {
  const topSkills = uniqueStrings([
    ...(parsedJD?.requiredSkills ?? []).slice(0, 4),
    ...(parsedJD?.preferredSkills ?? []).slice(0, 2),
  ]).slice(0, 4);

  const signals = uniqueStrings([
    topSkills.length > 0 ? `Core stack signals: ${topSkills.join(', ')}.` : '',
    parsedJD?.seniorityLevel ? `The role reads as roughly ${parsedJD.seniorityLevel}-level.` : '',
    parsedJD?.isRemote ? 'The JD includes remote-friendly wording.' : '',
  ]);

  if (signals.length === 0) {
    return 'The page does not expose enough engineering detail to summarize the team with confidence yet.';
  }

  return signals.join(' ');
}

function buildAlumniSummary(jobDescription: string) {
  const text = normalizeText(jobDescription);
  const signals = uniqueStrings([
    text.includes('phd') ? 'Advanced research backgrounds are mentioned.' : '',
    text.includes('university') || text.includes('college') ? 'Academic affiliations or school signals appear in the posting.' : '',
    text.includes('research') ? 'Research-oriented experience is mentioned.' : '',
  ]);

  if (signals.length === 0) {
    return 'No strong school or alumni signal is visible from this job page alone.';
  }

  return signals.join(' ');
}

function computeConfidence(params: {
  website: string | null;
  employeeCount: number | null;
  fundingTotal: string | null;
  revenueEstimateText: string | null;
  cultureSignals: string[];
  companyName: string;
}) {
  let score = params.companyName ? 0.28 : 0.12;
  if (params.website) score += 0.16;
  if (params.employeeCount) score += 0.15;
  if (params.fundingTotal) score += 0.13;
  if (params.revenueEstimateText) score += 0.1;
  score += Math.min(0.22, params.cultureSignals.length * 0.05);
  return Math.max(0.12, Math.min(0.86, Number(score.toFixed(2))));
}

function formatFreshnessLabel(updatedAt: Date) {
  return `Refreshed on ${updatedAt.toISOString().slice(0, 10)}`;
}

function readInsightArrays(value: Prisma.JsonValue | null, key: string): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const raw = (value as Record<string, Prisma.JsonValue>)[key];
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is string => typeof entry === 'string');
}

async function resolveWorkspace(params: {
  userId: string;
  workspaceId?: string;
}) {
  if (!params.workspaceId) return null;
  return prisma.applicationWorkspace.findFirst({
    where: {
      id: params.workspaceId,
      userId: params.userId,
    },
  });
}

async function getWorkspaceSnapshot(userId: string, workspaceId?: string): Promise<ExtensionWorkspaceSnapshot | undefined> {
  if (!workspaceId) return undefined;
  const response = await getExtensionWorkspace({ userId, workspaceId });
  return response.workspace;
}

export async function getExtensionCompanyInsight(params: {
  userId: string;
  input: ExtensionCompanyInsightRequest;
}): Promise<ExtensionCompanyInsightResponse> {
  const workspace = await resolveWorkspace({
    userId: params.userId,
    workspaceId: params.input.workspaceId,
  });

  if (params.input.workspaceId && !workspace) {
    throw new Error('Application workspace not found');
  }

  const companyName = params.input.companyName?.trim()
    || workspace?.companyName?.trim()
    || '';
  const normalizedCompanyName = normalizeCompanyName(companyName);
  if (!normalizedCompanyName) {
    throw new Error('A company name must be available before company intelligence can be generated.');
  }

  const sourceUrl = params.input.sourceUrl?.trim() || workspace?.sourceUrl || null;
  const website = deriveWebsite(sourceUrl);
  const jobDescription = params.input.jobDescription?.trim() || workspace?.jobDescription?.trim() || '';

  let cached = await prisma.companyInsight.findFirst({
    where: {
      normalizedCompanyName,
      website,
    },
  });

  const isFresh = cached
    ? (Date.now() - cached.updatedAt.getTime()) < (7 * 24 * 60 * 60 * 1000)
    : false;

  if (!cached || !isFresh || params.input.forceRefresh) {
    const employeeCount = extractEmployeeCount(jobDescription);
    const fundingTotal = extractMoneySnippet(jobDescription, 'funding');
    const revenueEstimateText = extractMoneySnippet(jobDescription, 'revenue');
    const cultureSignals = findCultureSignals(jobDescription);
    const parsedJD = jobDescription.length >= 20
      ? await analyzeExtensionJobPage({
        userId: params.userId,
        input: {
          url: sourceUrl || 'https://example.com',
          companyName: companyName || undefined,
          roleTitle: params.input.roleTitle?.trim() || workspace?.roleTitle || undefined,
          jobDescription,
          fields: [],
          questions: [],
        },
        bundle: await getExtensionProfileBundle(params.userId),
      })
      : null;

    const rawData = {
      facts: cultureSignals.facts,
      interpretation: cultureSignals.interpretation,
      sourceSummary: 'Built from the current job page and saved workspace metadata. No third-party enrichment provider is used in this pass.',
      fitSummary: parsedJD
        ? {
          fitScore: parsedJD.fitScore,
          summary: parsedJD.summary,
          strengths: parsedJD.strengths,
          gaps: parsedJD.gaps,
          matchedSkills: parsedJD.matchedSkills,
          missingSkills: parsedJD.missingSkills,
        }
        : null,
    } satisfies Prisma.InputJsonValue;

    const confidence = computeConfidence({
      website,
      employeeCount,
      fundingTotal,
      revenueEstimateText,
      cultureSignals: cultureSignals.facts,
      companyName,
    });

    const payload = {
      normalizedCompanyName,
      website,
      employeeCount,
      fundingTotal,
      revenueEstimateText,
      reviewSummary: cultureSignals.facts[0]
        ? `${cultureSignals.facts.join(' ')}`
        : 'Only limited trust or culture signals are available from this job page alone.',
      engineeringSummary: parsedJD
        ? buildEngineeringSummary(jobDescription, parsedJD.parsedJD)
        : buildEngineeringSummary(jobDescription),
      alumniSignalSummary: buildAlumniSummary(jobDescription),
      confidence,
      freshnessLabel: 'job-page-derived',
      rawData,
    } satisfies Prisma.CompanyInsightUncheckedCreateInput;

    cached = cached
      ? await prisma.companyInsight.update({
        where: { id: cached.id },
        data: payload,
      })
      : await prisma.companyInsight.create({
        data: payload,
      });
  }

  const bundle = jobDescription.length >= 20
    ? await getExtensionProfileBundle(params.userId)
    : null;
  const fit = bundle && sourceUrl
    ? await analyzeExtensionJobPage({
      userId: params.userId,
      input: {
        url: sourceUrl,
        companyName: companyName || undefined,
        roleTitle: params.input.roleTitle?.trim() || workspace?.roleTitle || undefined,
        jobDescription,
        fields: [],
        questions: [],
      },
      bundle,
    })
    : null;

  if (workspace) {
    await prisma.applicationWorkspace.update({
      where: { id: workspace.id },
      data: {
        companySnapshot: {
          companyInsightId: cached.id,
          normalizedCompanyName,
          website: cached.website,
          confidence: cached.confidence,
          freshnessDate: cached.updatedAt.toISOString(),
          facts: readInsightArrays(cached.rawData, 'facts'),
          interpretation: readInsightArrays(cached.rawData, 'interpretation'),
        } as Prisma.InputJsonValue,
        fitScore: fit?.fitScore ?? workspace.fitScore,
        fitSummary: fit?.summary ?? workspace.fitSummary,
      },
    });
  }

  const workspaceSnapshot = await getWorkspaceSnapshot(params.userId, workspace?.id);

  return {
    success: true,
    insight: {
      id: cached.id,
      normalizedCompanyName,
      companyName: companyName || normalizedCompanyName,
      website: cached.website,
      employeeCount: cached.employeeCount,
      fundingTotal: cached.fundingTotal,
      revenueEstimateText: cached.revenueEstimateText,
      reviewSummary: cached.reviewSummary,
      engineeringSummary: cached.engineeringSummary,
      alumniSignalSummary: cached.alumniSignalSummary,
      confidence: cached.confidence,
      freshnessDate: cached.updatedAt.toISOString(),
      freshnessLabel: formatFreshnessLabel(cached.updatedAt),
      facts: readInsightArrays(cached.rawData, 'facts'),
      interpretation: readInsightArrays(cached.rawData, 'interpretation'),
      sourceSummary: 'Built from this job page and your saved workspace data. Treat it as guidance, not authoritative external due diligence.',
    },
    fit: fit
      ? {
        fitScore: fit.fitScore,
        summary: fit.summary,
        strengths: fit.strengths,
        gaps: fit.gaps,
        matchedSkills: fit.matchedSkills,
        missingSkills: fit.missingSkills,
      }
      : undefined,
    workspace: workspaceSnapshot,
  };
}
