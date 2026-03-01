'use server';

import { z } from 'zod';
import { Octokit } from 'octokit';
import { auth } from '@clerk/nextjs/server';
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
  const userProfile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { github: true },
  });

  return extractGithubHandle(userProfile?.github ?? '');
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
  if (!linkedHandle) {
    return {
      success: true,
      linked: false,
      error: 'Please integrate your GitHub first from Dashboard > Profile > GitHub, then save.',
      setupPath: '/dashboard',
    };
  }

  return {
    success: true,
    linked: true,
    linkedHandle,
    setupPath: '/dashboard',
  };
}

function deriveDescription(repoName: string, repoDescription?: string, readme?: string) {
  if (readme) {
    const text = readme
      .replace(/^#\s+/gm, '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 5)
      .join(' ')
      .slice(0, 600);
    if (text) return text;
  }

  return (repoDescription || `${repoName} project imported from GitHub`).slice(0, 600);
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
    return {
      success: false,
      repos: [],
      error: 'Please integrate your GitHub first from Dashboard > Profile > GitHub, then save.',
      setupPath: '/dashboard',
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
  } catch (error) {
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
  } catch (error) {
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
    return {
      success: false,
      error: 'Please integrate your GitHub first from Dashboard > Profile > GitHub, then save.',
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
