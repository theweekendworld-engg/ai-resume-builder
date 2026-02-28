'use server';

import { z } from 'zod';
import { Octokit } from 'octokit';
import { auth } from '@clerk/nextjs/server';
import { GitHubRepo, GitHubRepoDetails, FetchReposOptions } from '@/types/github';
import { checkGitHubRateLimit } from '@/lib/rateLimit';

const FetchReposSchema = z.object({
    username: z.string().min(1).max(200),
    token: z.string().max(500).optional(),
    page: z.number().int().min(1).max(100).optional(),
    perPage: z.number().int().min(1).max(100).optional(),
    minStars: z.number().int().min(0).optional(),
    language: z.string().max(50).optional(),
    excludeForks: z.boolean().optional(),
});

export async function fetchGitHubRepos(options: FetchReposOptions): Promise<GitHubRepo[]> {
    const parsed = FetchReposSchema.safeParse({
        username: options.username,
        token: options.token,
        page: options.page,
        perPage: options.perPage,
        minStars: options.minStars,
        language: options.language,
        excludeForks: options.excludeForks,
    });
    if (!parsed.success) return [];

    const { userId } = await auth();
    if (userId) {
        const limit = await checkGitHubRateLimit(`gh:${userId}`);
        if (!limit.allowed) return [];
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

    try {
        const octokit = new Octokit({ 
            ...(token ? { auth: token } : {}),
            request: {
                timeout: 10000,
            }
        });

        const response = await octokit.request('GET /users/{username}/repos', {
            username,
            sort: 'updated',
            per_page: perPage,
            page,
        });

        let repos: GitHubRepo[] = response.data.map(repo => ({
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

        // Apply filters
        if (excludeForks) {
            repos = repos.filter(r => !r.fork);
        }

        if (minStars > 0) {
            repos = repos.filter(r => r.stargazers_count >= minStars);
        }

        if (language) {
            repos = repos.filter(r =>
                r.language?.toLowerCase() === language.toLowerCase()
            );
        }

        return repos;
    } catch (error) {
        console.error("GitHub Fetch Error:", error);
        return [];
    }
}

const FetchRepoDetailsSchema = z.object({
    username: z.string().min(1).max(200),
    repo: z.string().min(1).max(200),
    token: z.string().max(500).optional(),
});

export async function fetchRepoDetails(
    username: string,
    repo: string,
    token?: string
): Promise<GitHubRepoDetails> {
    const parsed = FetchRepoDetailsSchema.safeParse({ username, repo, token });
    if (!parsed.success) return { readme: '', languages: [], topics: [] };

    const { userId } = await auth();
    if (userId) {
        const limit = await checkGitHubRateLimit(`gh:details:${userId}`);
        if (!limit.allowed) return { readme: '', languages: [], topics: [] };
    }

    const { username: u, repo: r, token: t } = parsed.data;
    try {
        const octokit = new Octokit({
            ...(t ? { auth: t } : {}),
            request: { timeout: 10000 },
        });

        // Fetch README
        let readme = '';
        try {
            const readmeResponse = await octokit.request('GET /repos/{owner}/{repo}/readme', {
                owner: u,
                repo: r,
                headers: { 'X-GitHub-Api-Version': '2022-11-28' }
            });
            readme = Buffer.from(readmeResponse.data.content, 'base64').toString('utf-8');
        } catch {
            // README not found, continue without it
        }

        // Fetch languages
        let languages: string[] = [];
        try {
            const langResponse = await octokit.request('GET /repos/{owner}/{repo}/languages', {
                owner: u,
                repo: r,
            });
            languages = Object.keys(langResponse.data);
        } catch {
            // Languages not available
        }

        // Fetch topics
        let topics: string[] = [];
        try {
            const topicsResponse = await octokit.request('GET /repos/{owner}/{repo}/topics', {
                owner: u,
                repo: r,
                headers: { Accept: 'application/vnd.github.mercy-preview+json' }
            });
            topics = topicsResponse.data.names || [];
        } catch {
            // Topics not available
        }

        return { readme, languages, topics };
    } catch (error) {
        console.error("GitHub Details Error:", error);
        return { readme: '', languages: [], topics: [] };
    }
}


