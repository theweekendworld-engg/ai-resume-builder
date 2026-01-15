/**
 * GitHub API response types and project extraction structures
 */

export interface GitHubRepo {
    id: number;
    name: string;
    description: string | null;
    html_url: string;
    language: string | null;
    stargazers_count: number;
    topics: string[];
    updated_at: string;
    fork: boolean;
}

export interface GitHubRepoDetails {
    readme: string;
    languages: string[];
    topics: string[];
}

export interface ProjectExtraction {
    impactBullets: string[];
    tech: string[];
    summary: string;
}

export interface FetchReposOptions {
    username: string;
    token?: string;
    page?: number;
    perPage?: number;
    minStars?: number;
    language?: string;
    excludeForks?: boolean;
}
