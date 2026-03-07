'use server';

import { z } from 'zod';
import { Octokit } from 'octokit';
import { auth, clerkClient } from '@clerk/nextjs/server';
import {
  GitHubRepo,
  GitHubRepoDetails,
  FetchReposOptions,
  FetchGitHubReposResult,
  GitHubIntegrationStatus,
} from '@/types/github';
import { checkGitHubRateLimit } from '@/lib/rateLimit';
import { prisma } from '@/lib/prisma';
import { createUserProject } from '@/actions/projects';

const FetchReposSchema = z.object({
  username: z.string().min(1).max(200).optional(),
  token: z.string().max(500).optional(),
  page: z.number().int().min(1).max(100).optional(),
  perPage: z.number().int().min(1).max(100).optional(),
  minStars: z.number().int().min(0).optional(),
  language: z.string().max(50).optional(),
  excludeForks: z.boolean().optional(),
});

const FetchRepoDetailsSchema = z.object({
  username: z.string().min(1).max(200),
  repo: z.string().min(1).max(200),
  token: z.string().max(500).optional(),
});

const ImportRepoSchema = z.object({
  repoName: z.string().min(1).max(200),
  repoUrl: z.string().url().max(1000),
  repoDescription: z.string().max(5000).optional(),
  token: z.string().max(500).optional(),
  fallbackLanguage: z.string().max(100).optional(),
});

const SyncTopGitHubProjectsSchema = z.object({
  limit: z.number().int().min(1).max(20).default(10),
  token: z.string().max(500).optional(),
});

function getOctokit(token?: string) {
  return new Octokit({
    ...(token ? { auth: token } : {}),
    request: {
      timeout: 10000,
    },
  });
}

function extractGithubHandle(input: string): string {
  const value = input.trim();
  if (!value) return '';

  if (value.includes('github.com')) {
    try {
      const url = new URL(value.startsWith('http') ? value : `https://${value}`);
      return url.pathname.split('/').filter(Boolean)[0]?.toLowerCase() ?? '';
    } catch {
      return '';
    }
  }

  return value.replace('@', '').trim().toLowerCase();
}

function parseGitHubRepoUrl(input: string): { owner: string; repo: string; normalizedUrl: string } | null {
  const raw = input.trim();
  if (!raw) return null;

  try {
    const url = new URL(raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`);
    if (!url.hostname.toLowerCase().includes('github.com')) return null;

    const [ownerRaw, repoRaw] = url.pathname.split('/').filter(Boolean);
    if (!ownerRaw || !repoRaw) return null;

    const owner = ownerRaw.trim().toLowerCase();
    const repo = repoRaw.trim().replace(/\.git$/i, '');
    if (!owner || !repo) return null;

    return {
      owner,
      repo,
      normalizedUrl: `https://github.com/${owner}/${repo}`,
    };
  } catch {
    return null;
  }
}

async function getLinkedGitHubHandle(userId: string): Promise<string> {
  const oauthHandle = await getGitHubHandleFromOAuth(userId);
  if (oauthHandle) return oauthHandle;
  return '';
}

async function getProfileGitHubHandle(userId: string): Promise<string> {
  const userProfile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { github: true },
  });

  return extractGithubHandle(userProfile?.github ?? '');
}

async function getGitHubHandleFromOAuth(userId: string): Promise<string> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const accounts = Array.isArray((user as unknown as { externalAccounts?: unknown[] }).externalAccounts)
      ? (user as unknown as { externalAccounts: Array<Record<string, unknown>> }).externalAccounts
      : [];

    for (const account of accounts) {
      const provider = typeof account.provider === 'string' ? account.provider.toLowerCase() : '';
      const verificationStrategy = typeof account.verificationStrategy === 'string'
        ? account.verificationStrategy.toLowerCase()
        : '';
      if (!provider.includes('github') && !verificationStrategy.includes('github')) {
        continue;
      }

      const username = typeof account.username === 'string' ? account.username : '';
      const emailAddress = typeof account.emailAddress === 'string' ? account.emailAddress : '';
      const identificationId = typeof account.identificationId === 'string' ? account.identificationId : '';
      const firstValid = extractGithubHandle(username) || extractGithubHandle(emailAddress) || extractGithubHandle(identificationId);
      if (firstValid) return firstValid;
    }
  } catch {
    // Ignore and fall back to profile lookup for messaging only.
  }
  return '';
}

export async function getGitHubIntegrationStatus(): Promise<GitHubIntegrationStatus> {
  const { userId } = await auth();
  if (!userId) {
    return {
      success: false,
      linked: false,
      error: 'Please sign in to use GitHub import.',
      setupPath: '/sign-in',
    };
  }

  const linkedHandle = await getLinkedGitHubHandle(userId);
  const profileHandle = await getProfileGitHubHandle(userId);
  if (!linkedHandle) {
    const hasManualHandle = !!profileHandle;
    return {
      success: true,
      linked: false,
      error: hasManualHandle
        ? 'GitHub username is present in your profile, but repo import requires OAuth verification. Connect GitHub in Account settings.'
        : 'Connect your GitHub account with OAuth in Account settings to enable verified repo import.',
      setupPath: '/account',
    };
  }

  return {
    success: true,
    linked: true,
    linkedHandle,
    setupPath: '/account',
  };
}

function extractReadmeSummary(readme: string): string {
  const withoutCode = readme
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]+`/g, '');

  const lines = withoutCode
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (!line || line.length < 10) return false;
      if (line.startsWith('#')) return false;
      if (line.startsWith('[![') || line.startsWith('![') || line.startsWith('[!')) return false;
      if (line.startsWith('|') || line.startsWith('---') || line.startsWith('===')) return false;
      if (line.startsWith('<!--') || line.startsWith('-->')) return false;
      if (line.match(/^\[!\[/)) return false;
      if (line.match(/^https?:\/\/\S+$/)) return false;
      return true;
    });

  return lines.slice(0, 6).join(' ').slice(0, 600);
}

function deriveDescription(repoName: string, repoDescription?: string, readme?: string) {
  const readmeSummary = readme ? extractReadmeSummary(readme) : '';

  if (repoDescription && repoDescription.length > 15) {
    return readmeSummary
      ? `${repoDescription}. ${readmeSummary}`.slice(0, 600)
      : repoDescription.slice(0, 600);
  }

  if (readmeSummary) return readmeSummary;

  return `${repoName} project imported from GitHub`.slice(0, 600);
}

function uniqueTech(...values: string[][]) {
  return Array.from(new Set(values.flat().map((item) => item.trim()).filter(Boolean))).slice(0, 20);
}

export async function fetchGitHubRepos(options: FetchReposOptions): Promise<FetchGitHubReposResult> {
  const parsed = FetchReposSchema.safeParse({
    username: options.username,
    token: options.token,
    page: options.page,
    perPage: options.perPage,
    minStars: options.minStars,
    language: options.language,
    excludeForks: options.excludeForks,
  });
  if (!parsed.success) {
    return { success: false, repos: [], error: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  const { userId } = await auth();
  if (!userId) {
    return {
      success: false,
      repos: [],
      error: 'Please sign in to use GitHub import.',
      setupPath: '/sign-in',
    };
  }

  const linkedHandle = await getLinkedGitHubHandle(userId);
  if (!linkedHandle) {
    const profileHandle = await getProfileGitHubHandle(userId);
    const hasManualHandle = !!profileHandle;
    return {
      success: false,
      repos: [],
      error: hasManualHandle
        ? 'GitHub username is set, but OAuth verification is required for import. Connect GitHub in Account settings.'
        : 'Connect GitHub with OAuth in Account settings first.',
      setupPath: '/account',
    };
  }

  const limit = await checkGitHubRateLimit(`gh:${userId}`);
  if (!limit.allowed) {
    return { success: false, repos: [], linkedHandle, error: 'GitHub rate limit exceeded. Please try again shortly.' };
  }

  const {
    username,
    token,
    page = 1,
    perPage = 20,
    minStars = 0,
    language,
    excludeForks = true,
  } = parsed.data;

  if (username && extractGithubHandle(username) !== linkedHandle) {
    return {
      success: false,
      repos: [],
      linkedHandle,
      error: `GitHub account mismatch. Your account is linked to ${linkedHandle}.`,
      setupPath: '/dashboard',
    };
  }

  try {
    const octokit = getOctokit(token);

    const response = await octokit.request('GET /users/{username}/repos', {
      username: linkedHandle,
      sort: 'updated',
      per_page: perPage,
      page,
    });

    let repos: GitHubRepo[] = response.data.map((repo) => ({
      id: repo.id,
      name: repo.name,
      description: repo.description,
      html_url: repo.html_url,
      language: repo.language ?? null,
      stargazers_count: repo.stargazers_count || 0,
      topics: repo.topics || [],
      updated_at: repo.updated_at || '',
      fork: repo.fork || false,
    }));

    if (excludeForks) {
      repos = repos.filter((r) => !r.fork);
    }

    if (minStars > 0) {
      repos = repos.filter((r) => r.stargazers_count >= minStars);
    }

    if (language) {
      repos = repos.filter((r) => r.language?.toLowerCase() === language.toLowerCase());
    }

    return { success: true, repos, linkedHandle, setupPath: '/dashboard' };
  } catch (error: unknown) {
    console.error('GitHub Fetch Error:', error);
    return { success: false, repos: [], linkedHandle, error: 'Failed to fetch repositories from GitHub.' };
  }
}

export async function fetchRepoDetails(username: string, repo: string, token?: string): Promise<GitHubRepoDetails> {
  const parsed = FetchRepoDetailsSchema.safeParse({ username, repo, token });
  if (!parsed.success) return { readme: '', languages: [], topics: [] };

  const { userId } = await auth();
  if (userId) {
    const limit = await checkGitHubRateLimit(`gh:details:${userId}`);
    if (!limit.allowed) return { readme: '', languages: [], topics: [] };
  }

  const { username: u, repo: r, token: t } = parsed.data;
  try {
    const octokit = getOctokit(t);

    let readme = '';
    try {
      const readmeResponse = await octokit.request('GET /repos/{owner}/{repo}/readme', {
        owner: u,
        repo: r,
        headers: { 'X-GitHub-Api-Version': '2022-11-28' },
      });
      readme = Buffer.from(readmeResponse.data.content, 'base64').toString('utf-8');
    } catch {
      readme = '';
    }

    let languages: string[] = [];
    try {
      const langResponse = await octokit.request('GET /repos/{owner}/{repo}/languages', {
        owner: u,
        repo: r,
      });
      languages = Object.keys(langResponse.data);
    } catch {
      languages = [];
    }

    let topics: string[] = [];
    try {
      const topicsResponse = await octokit.request('GET /repos/{owner}/{repo}/topics', {
        owner: u,
        repo: r,
        headers: { Accept: 'application/vnd.github.mercy-preview+json' },
      });
      topics = topicsResponse.data.names || [];
    } catch {
      topics = [];
    }

    return { readme, languages, topics };
  } catch (error: unknown) {
    console.error('GitHub Details Error:', error);
    return { readme: '', languages: [], topics: [] };
  }
}

export async function importGitHubRepoToLibrary(input: unknown): Promise<{
  success: boolean;
  deduped?: boolean;
  projectId?: string;
  warning?: string;
  error?: string;
}> {
  const parsed = ImportRepoSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  const { userId } = await auth();
  if (!userId) return { success: false, error: 'Not authenticated' };

  const linkedHandle = await getLinkedGitHubHandle(userId);
  const parsedRepoUrl = parseGitHubRepoUrl(parsed.data.repoUrl);

  if (!linkedHandle) {
    const profileHandle = await getProfileGitHubHandle(userId);
    const hasManualHandle = !!profileHandle;
    return {
      success: false,
      error: hasManualHandle
        ? 'GitHub username is set, but OAuth verification is required for import. Connect GitHub in Account settings.'
        : 'Connect GitHub with OAuth in Account settings first.',
    };
  }

  if (!parsedRepoUrl) {
    return { success: false, error: 'Invalid GitHub repository URL.' };
  }

  if (parsedRepoUrl.owner !== linkedHandle) {
    return {
      success: false,
      error: `Repository owner mismatch. Your linked GitHub is ${linkedHandle}.`,
    };
  }

  if (parsedRepoUrl.repo.toLowerCase() !== parsed.data.repoName.trim().toLowerCase()) {
    return { success: false, error: 'Repository name does not match the selected GitHub URL.' };
  }

  const existing = await prisma.userProject.findFirst({
    where: {
      userId,
      githubUrl: parsedRepoUrl.normalizedUrl,
    },
    select: { id: true },
  });

  if (existing) {
    return { success: true, deduped: true, projectId: existing.id };
  }

  const details = await fetchRepoDetails(linkedHandle, parsedRepoUrl.repo, parsed.data.token);
  const technologies = uniqueTech(
    details.languages,
    details.topics,
    parsed.data.fallbackLanguage ? [parsed.data.fallbackLanguage] : []
  );

  const result = await createUserProject({
    name: parsedRepoUrl.repo,
    description: deriveDescription(parsedRepoUrl.repo, parsed.data.repoDescription, details.readme),
    url: parsedRepoUrl.normalizedUrl,
    githubUrl: parsedRepoUrl.normalizedUrl,
    technologies,
    readme: details.readme,
    source: 'github',
  });

  return {
    success: result.success,
    projectId: result.projectId,
    warning: result.warning,
    error: result.error,
  };
}

export async function syncTopGitHubProjects(input?: unknown): Promise<{
  success: boolean;
  imported?: number;
  deduped?: number;
  failed?: number;
  linkedHandle?: string;
  error?: string;
}> {
  const parsed = SyncTopGitHubProjectsSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  const { userId } = await auth();
  if (!userId) {
    return {
      success: false,
      error: 'Please sign in to sync GitHub repositories.',
    };
  }

  const linkedHandle = await getLinkedGitHubHandle(userId);
  if (!linkedHandle) {
    return {
      success: false,
      error: 'Connect GitHub with OAuth in Account settings first.',
    };
  }

  const repoResult = await fetchGitHubRepos({
    token: parsed.data.token,
    perPage: Math.min(60, Math.max(parsed.data.limit * 3, 20)),
    excludeForks: true,
  });

  if (!repoResult.success) {
    return {
      success: false,
      linkedHandle,
      error: repoResult.error ?? 'Failed to fetch repositories for sync.',
    };
  }

  const ranked = [...repoResult.repos]
    .sort((a, b) => {
      const starsDelta = (b.stargazers_count ?? 0) - (a.stargazers_count ?? 0);
      if (starsDelta !== 0) return starsDelta;
      return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
    })
    .slice(0, parsed.data.limit);

  let imported = 0;
  let deduped = 0;
  let failed = 0;

  for (const repo of ranked) {
    const result = await importGitHubRepoToLibrary({
      repoName: repo.name,
      repoUrl: repo.html_url,
      repoDescription: repo.description || '',
      token: parsed.data.token,
      fallbackLanguage: repo.language || undefined,
    });

    if (!result.success) {
      failed += 1;
      continue;
    }
    if (result.deduped) {
      deduped += 1;
      continue;
    }
    imported += 1;
  }

  return {
    success: true,
    linkedHandle,
    imported,
    deduped,
    failed,
  };
}
