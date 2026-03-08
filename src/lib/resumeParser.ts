import { config } from '@/lib/config';
import { ParsedResumeSchema, RESUME_PARSE_PROMPT, type ParsedResumeData } from '@/lib/aiSchemas';
import { trackedChatCompletion, trackedResponsesCreate } from '@/lib/usageTracker';
import { repairJSON } from '@/lib/aiSchemas';
import { extractHyperlinksFromPdf, extractTextFromPdf, type ExtractedPdfLink } from '@/lib/pdfParser';

const ACHIEVEMENT_TYPES = new Set([
  'achievement',
  'oss_contribution',
  'certification',
  'award',
  'publication',
  'custom',
]);
const NON_PROJECT_HOSTS = new Set([
  'gmail.com',
  'mail.google.com',
  'outlook.com',
  'office.com',
  'yahoo.com',
  'proton.me',
  'linkedin.com',
  'twitter.com',
  'x.com',
  'instagram.com',
  'facebook.com',
  't.me',
  'wa.me',
]);

function normalizeHighlights(lines: string[]): string[] {
  const out: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const splitByNewline = trimmed
      .split(/\r?\n+/)
      .map((part) => part.trim())
      .filter(Boolean);

    for (const part of splitByNewline) {
      const bulletParts = part
        .split(/(?:^|[\s])(?:[-*•▪◦‣]\s+)/)
        .map((item) => item.trim())
        .filter(Boolean);

      if (bulletParts.length > 1) {
        out.push(...bulletParts);
      } else {
        out.push(part.replace(/^[-*•▪◦‣]\s+/, '').trim());
      }
    }
  }

  return out;
}

function splitBulletLikeText(text: string): string[] {
  const cleaned = text.trim();
  if (!cleaned) return [];

  const normalized = cleaned
    .replace(/\r\n/g, '\n')
    .replace(/\s+[•●▪◦‣]\s+/g, '\n• ')
    .replace(/\s-\s+(?=[A-Z0-9])/g, '\n- ')
    .replace(/\s\*\s+(?=[A-Z0-9])/g, '\n* ');

  const lines = normalized
    .split(/\n+/)
    .map((line) => line.replace(/^[\s\-*•●▪◦‣]+\s*/, '').trim())
    .filter(Boolean);

  return lines;
}

function normalizeProjectDescription(description: string): string {
  const parts = splitBulletLikeText(description);
  if (parts.length <= 1) return description.trim();
  return parts.join('\n');
}

function normalizeCandidateUrl(raw: string): string | null {
  const candidate = raw
    .trim()
    .replace(/[),.;]+$/g, '')
    .replace(/^\[|\]$/g, '');
  if (!candidate) return null;
  if (/^(mailto:|tel:)/i.test(candidate)) return null;

  const withProtocol = /^(https?:\/\/)/i.test(candidate) ? candidate : `https://${candidate}`;
  try {
    const url = new URL(withProtocol);
    if (!url.hostname) return null;
    const pathname = url.pathname || '';
    const search = url.search || '';
    return `${url.protocol}//${url.hostname}${pathname}${search}`.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function extractCandidateUrls(text: string): string[] {
  if (!text) return [];

  const matches = text.match(
    /((?:https?:\/\/|www\.|github\.com\/|[a-z0-9.-]+\.[a-z]{2,}\/)[^\s<>"')\]]+)/gi
  );
  if (!matches) return [];

  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of matches) {
    const normalized = normalizeCandidateUrl(raw);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function isGithubUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return host === 'github.com' || host === 'www.github.com';
  } catch {
    return false;
  }
}

function toGithubRepoUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host !== 'github.com' && host !== 'www.github.com') return null;
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length < 2) return null;
    return `https://github.com/${segments[0]}/${segments[1]}`;
  } catch {
    return null;
  }
}

function isLikelyNonProjectUrl(url: string, linkText = ''): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const path = parsed.pathname.toLowerCase();
    const label = linkText.toLowerCase();

    if (NON_PROJECT_HOSTS.has(host)) return true;
    if (label.includes('email') || label.includes('phone') || label.includes('linkedin')) return true;
    if (host === 'github.com') {
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (segments.length < 2) return true;
    }
    if (host === 'linkedin.com' && path.startsWith('/in/')) return true;
    return false;
  } catch {
    return true;
  }
}

function normalizeProjectUrls(
  project: ParsedResumeData['projects'][number],
  fallbackUrls: { github: string[]; live: string[] }
) {
  const inlineUrls = extractCandidateUrls(
    [project.githubUrl ?? '', project.liveUrl ?? '', project.description, project.name].join('\n')
  );

  let githubUrl = normalizeCandidateUrl(project.githubUrl ?? '') ?? '';
  let liveUrl = normalizeCandidateUrl(project.liveUrl ?? '') ?? '';

  if (liveUrl && isLikelyNonProjectUrl(liveUrl)) {
    liveUrl = '';
  }

  if (!githubUrl) {
    const fromInline = inlineUrls
      .map((url) => toGithubRepoUrl(url))
      .find((url): url is string => Boolean(url));
    if (fromInline) githubUrl = fromInline;
  } else {
    githubUrl = toGithubRepoUrl(githubUrl) ?? '';
  }

  if (!liveUrl) {
    const firstNonGithub = inlineUrls.find((url) => !isGithubUrl(url) && !isLikelyNonProjectUrl(url));
    if (firstNonGithub) liveUrl = firstNonGithub;
  }

  if (!githubUrl && liveUrl && isGithubUrl(liveUrl)) {
    githubUrl = toGithubRepoUrl(liveUrl) ?? liveUrl;
    liveUrl = '';
  }

  if (githubUrl && liveUrl && githubUrl.toLowerCase() === liveUrl.toLowerCase()) {
    liveUrl = '';
  }

  if (!githubUrl && fallbackUrls.github.length > 0) {
    githubUrl = fallbackUrls.github.shift() ?? '';
  }
  if (!liveUrl && fallbackUrls.live.length > 0) {
    liveUrl = fallbackUrls.live.shift() ?? '';
  }

  return {
    githubUrl: githubUrl || undefined,
    liveUrl: liveUrl || undefined,
  };
}

function getProjectUrlFallbacks(links: ExtractedPdfLink[]): { github: string[]; live: string[] } {
  const github: string[] = [];
  const live: string[] = [];
  const seen = new Set<string>();

  for (const link of links) {
    const normalized = normalizeCandidateUrl(link.url);
    if (!normalized) continue;
    if (isLikelyNonProjectUrl(normalized, link.text)) continue;

    const label = (link.text || '').toLowerCase();
    const labelSuggestsRepo = /\b(repo|github|source|code)\b/.test(label);
    const labelSuggestsLive = /\b(live|demo|site|website|app|preview)\b/.test(label);
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const repo = toGithubRepoUrl(normalized);
    if (repo) {
      if (labelSuggestsLive) {
        live.push(normalized);
      } else {
        github.push(repo);
      }
      continue;
    }
    if (labelSuggestsRepo) continue;
    if (labelSuggestsLive || !label) {
      live.push(normalized);
    }
  }

  return { github, live };
}

function buildPdfHyperlinkContext(links: ExtractedPdfLink[]): string {
  if (links.length === 0) return '';
  const lines = links
    .slice(0, 40)
    .map((link) => {
      const text = link.text ? `text=\"${link.text}\"` : 'text=""';
      return `- page ${link.pageNumber}: ${text} url=${link.url}`;
    });
  return lines.join('\n');
}

function isTimeoutLikeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const maybe = error as { message?: string; code?: string; type?: string };
  const message = (maybe.message ?? '').toLowerCase();
  const code = (maybe.code ?? '').toLowerCase();
  const type = (maybe.type ?? '').toLowerCase();
  return (
    message.includes('timed out') ||
    message.includes('timeout') ||
    code.includes('timeout') ||
    code === 'etimedout' ||
    type.includes('timeout')
  );
}

function normalizeAchievementType(type: string): ParsedResumeData['achievements'][number]['type'] {
  const raw = (type || '').trim().toLowerCase().replace(/\s+/g, '_');
  const aliases: Record<string, ParsedResumeData['achievements'][number]['type']> = {
    'oss': 'oss_contribution',
    'open_source': 'oss_contribution',
    'open_source_contribution': 'oss_contribution',
    'open_source_contributions': 'oss_contribution',
    'oss_contributions': 'oss_contribution',
    'certifications': 'certification',
    'awards': 'award',
    'publications': 'publication',
  };

  const normalized = aliases[raw] ?? (raw as ParsedResumeData['achievements'][number]['type']);
  if (ACHIEVEMENT_TYPES.has(normalized)) return normalized;
  return 'achievement';
}

function normalizeParsedResumeData(data: ParsedResumeData, extractedLinks: ExtractedPdfLink[] = []): ParsedResumeData {
  const fallbackUrls = getProjectUrlFallbacks(extractedLinks);
  return {
    ...data,
    experiences: data.experiences.map((experience) => ({
      ...experience,
      highlights: normalizeHighlights(
        Array.isArray(experience.highlights) ? experience.highlights : []
      ),
    })),
    projects: data.projects.map((project) => ({
      ...project,
      description: normalizeProjectDescription(project.description),
      ...normalizeProjectUrls(project, fallbackUrls),
    })),
    achievements: data.achievements.map((achievement) => ({
      ...achievement,
      type: normalizeAchievementType(achievement.type),
      description: normalizeProjectDescription(achievement.description),
    })),
  };
}

export async function parseResumeFromPdf(buffer: Buffer, userId: string): Promise<ParsedResumeData> {
  const base64 = buffer.toString('base64');
  const extractedLinks = await extractHyperlinksFromPdf(buffer).catch(() => [] as ExtractedPdfLink[]);
  const linksContext = buildPdfHyperlinkContext(extractedLinks);
  try {
    const response = await trackedResponsesCreate(
      {
        model: config.openai.models.resumeParse,
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_file',
                file_data: `data:application/pdf;base64,${base64}`,
                filename: 'resume.pdf',
              },
              {
                type: 'input_text',
                text: `${RESUME_PARSE_PROMPT}${linksContext ? `\n\nEmbedded PDF hyperlink annotations:\n${linksContext}\nUse these links to populate project githubUrl/liveUrl when the visible text is only labels like [repo] or [live].` : ''}\n\nReturn ONLY a valid JSON object.`,
              },
            ],
          },
        ],
        text: { format: { type: 'json_object' } },
      },
      { userId, operation: 'resume_parse', metadata: { source: 'pdf' } }
    );

    const raw = 'output_text' in response ? (response.output_text ?? '{}') : '{}';
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = JSON.parse(repairJSON(raw));
    }

    const result = ParsedResumeSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`Resume parse validation failed: ${issues}`);
    }

    return normalizeParsedResumeData(result.data, extractedLinks);
  } catch (error: unknown) {
    if (!isTimeoutLikeError(error)) {
      throw error;
    }

    const extractedText = await extractTextFromPdf(buffer);
    if (!extractedText.trim()) {
      throw error;
    }
    return parseResumeText(extractedText, userId, extractedLinks);
  }
}

export async function parseResumeText(
  text: string,
  userId: string,
  extractedLinks: ExtractedPdfLink[] = []
): Promise<ParsedResumeData> {
  const truncated = text.slice(0, 12000);
  const linksContext = buildPdfHyperlinkContext(extractedLinks);

  const response = await trackedChatCompletion(
    {
      model: config.openai.models.resumeParse,
      messages: [
        {
          role: 'system',
          content: RESUME_PARSE_PROMPT,
        },
        {
          role: 'user',
          content: `Resume text:\n\n${truncated}${linksContext ? `\n\nEmbedded PDF hyperlink annotations:\n${linksContext}\nUse these links to populate project githubUrl/liveUrl when the visible text is only labels like [repo] or [live].` : ''}\n\nReturn ONLY a valid JSON object.`,
        },
      ],
      response_format: { type: 'json_object' },
    },
    {
      userId,
      operation: 'resume_parse',
      metadata: { textLength: truncated.length },
    }
  );

  const raw = response.choices[0]?.message?.content ?? '{}';

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = JSON.parse(repairJSON(raw));
  }

  const result = ParsedResumeSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Resume parse validation failed: ${issues}`);
  }

  return normalizeParsedResumeData(result.data, extractedLinks);
}
