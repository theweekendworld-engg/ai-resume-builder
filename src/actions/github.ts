'use server';

import { Octokit } from 'octokit';
import { GitHubRepo, GitHubRepoDetails, FetchReposOptions } from '@/types/github';

/**
 * Fetch GitHub repos with pagination and filtering support.
 */
export async function fetchGitHubRepos(options: FetchReposOptions): Promise<GitHubRepo[]> {
    const {
        username,
        token,
        page = 1,
        perPage = 20,
        minStars = 0,
        language,
        excludeForks = true
    } = options;

    try {
        const octokit = new Octokit({ auth: token });

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

/**
 * Fetch detailed repo information including README, languages, and topics.
 */
export async function fetchRepoDetails(
    username: string,
    repo: string,
    token?: string
): Promise<GitHubRepoDetails> {
    try {
        const octokit = new Octokit({ auth: token });

        // Fetch README
        let readme = '';
        try {
            const readmeResponse = await octokit.request('GET /repos/{owner}/{repo}/readme', {
                owner: username,
                repo,
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
                owner: username,
                repo,
            });
            languages = Object.keys(langResponse.data);
        } catch {
            // Languages not available
        }

        // Fetch topics
        let topics: string[] = [];
        try {
            const topicsResponse = await octokit.request('GET /repos/{owner}/{repo}/topics', {
                owner: username,
                repo,
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


