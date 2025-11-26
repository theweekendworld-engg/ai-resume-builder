'use server';

import { Octokit } from 'octokit';

// In a real app with Clerk, we would get the OAuth token from Clerk.
// For MVP, we might ask user for a PAT or just fetch public repos if no token.
// Or we can try to use the Clerk token if available server-side.
// Clerk: auth().getToken({ template: "github" }) - requires configuring a template in Clerk Dashboard.

// For this MVP, I will assume public repos for username, OR a PAT provided in env/input.
// Let's implement fetching public repos by username first as it's easiest without complex token exchange setup in MVP.
// If user provides a PAT, we use it.

export async function fetchGitHubRepos(username: string, token?: string) {
    try {
        const octokit = new Octokit({
            auth: token, // Optional
        });

        const response = await octokit.request('GET /users/{username}/repos', {
            username,
            sort: 'updated',
            per_page: 10,
        });

        return response.data.map(repo => ({
            id: repo.id,
            name: repo.name,
            description: repo.description,
            html_url: repo.html_url,
            language: repo.language,
            stargazers_count: repo.stargazers_count,
        }));
    } catch (error) {
        console.error("GitHub Fetch Error:", error);
        return [];
    }
}

export async function fetchRepoDetails(username: string, repo: string, token?: string) {
    try {
        const octokit = new Octokit({ auth: token });

        // Fetch README
        const readme = await octokit.request('GET /repos/{owner}/{repo}/readme', {
            owner: username,
            repo,
            headers: {
                'X-GitHub-Api-Version': '2022-11-28'
            }
        });

        // Decode content (base64)
        const content = Buffer.from(readme.data.content, 'base64').toString('utf-8');
        return content;
    } catch (error) {
        console.error("GitHub Readme Error:", error);
        return "";
    }
}
