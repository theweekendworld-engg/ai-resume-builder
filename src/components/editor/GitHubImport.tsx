'use client';

import { useState } from 'react';
import { fetchGitHubRepos, fetchRepoDetails } from '@/actions/github';
import { getUniqueLanguages } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Github, Loader2, Download, Star, Key, Filter } from 'lucide-react';
import { useResumeStore } from '@/store/resumeStore';
import { improveText } from '@/actions/ai';
import { GitHubRepo } from '@/types/github';
import { toast } from 'sonner';

export function GitHubImport() {
    const [username, setUsername] = useState('');
    const [token, setToken] = useState('');
    const [showToken, setShowToken] = useState(false);
    const [repos, setRepos] = useState<GitHubRepo[]>([]);
    const [loading, setLoading] = useState(false);
    const [importingId, setImportingId] = useState<number | null>(null);
    const [languageFilter, setLanguageFilter] = useState<string>('all');
    const [minStars, setMinStars] = useState<number>(0);
    const { addProject } = useResumeStore();

    const handleTokenChange = (value: string) => {
        setToken(value);
    };

    const handleFetch = async () => {
        if (!username) return;
        setLoading(true);
        try {
            const data = await fetchGitHubRepos({
                username,
                token: token || undefined,
                perPage: 30,
                minStars,
                excludeForks: true,
            });
            setRepos(data);
            if (data.length === 0) {
                toast.info('No repositories found');
            }
        } catch (error) {
            console.error(error);
            toast.error('Failed to fetch repositories');
        } finally {
            setLoading(false);
        }
    };

    const handleImport = async (repo: GitHubRepo) => {
        setImportingId(repo.id);
        try {
            // Fetch detailed repo info
            const details = await fetchRepoDetails(username, repo.name, token || undefined);

            // AI Summarize README or description
            let description = repo.description || "";
            if (details.readme) {
                const context = details.readme.substring(0, 2000);
                description = await improveText(context, 'project');
            } else if (description) {
                description = await improveText(description, 'project');
            }

            // Combine languages from API with detected topics
            const technologies = [
                ...details.languages,
                ...details.topics.filter(t => !details.languages.includes(t))
            ].slice(0, 8);

            // Add to Store
            addProject({
                name: repo.name,
                description: description,
                url: repo.html_url,
                technologies: technologies.length > 0 ? technologies : (repo.language ? [repo.language] : []),
            });

            toast.success(`Imported "${repo.name}" to projects`);
        } catch (error) {
            console.error(error);
            toast.error('Failed to import project');
        } finally {
            setImportingId(null);
        }
    };

    // Get unique languages for filter dropdown
    const availableLanguages = getUniqueLanguages(repos);

    // Apply client-side language filter
    const filteredRepos = languageFilter === 'all'
        ? repos
        : repos.filter(r => r.language?.toLowerCase() === languageFilter.toLowerCase());

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Github className="w-5 h-5" /> Import from GitHub
                </CardTitle>
                <CardDescription>
                    Fetch your repositories and import them as projects
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Username input */}
                <div className="flex gap-2">
                    <Input
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="GitHub Username"
                        onKeyDown={(e) => e.key === 'Enter' && handleFetch()}
                    />
                    <Button onClick={handleFetch} disabled={loading || !username}>
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Fetch"}
                    </Button>
                </div>

                {/* Optional Token Input */}
                <div className="space-y-2">
                    <button
                        onClick={() => setShowToken(!showToken)}
                        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                    >
                        <Key className="w-3 h-3" />
                        {showToken ? 'Hide' : 'Add'} Personal Access Token (optional)
                    </button>
                    {showToken && (
                        <Input
                            type="password"
                            value={token}
                            onChange={(e) => handleTokenChange(e.target.value)}
                            placeholder="ghp_xxxxx (for private repos or higher rate limit)"
                            className="text-sm"
                        />
                    )}
                    {showToken && (
                        <p className="text-xs text-muted-foreground">
                            Token is used only for this session and is not stored in your browser.
                        </p>
                    )}
                </div>

                {/* Filters */}
                {repos.length > 0 && (
                    <div className="flex gap-2 items-center text-sm">
                        <Filter className="w-4 h-4 text-muted-foreground" />
                        <Select value={languageFilter} onValueChange={setLanguageFilter}>
                            <SelectTrigger className="w-[140px] h-8 text-xs">
                                <SelectValue placeholder="Language" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Languages</SelectItem>
                                {availableLanguages.map((lang) => (
                                    <SelectItem key={lang} value={lang.toLowerCase()}>
                                        {lang}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <span className="text-muted-foreground text-xs">
                            {filteredRepos.length} repo{filteredRepos.length !== 1 ? 's' : ''}
                        </span>
                    </div>
                )}

                {/* Repo List */}
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {filteredRepos.map((repo) => (
                        <div key={repo.id} className="flex items-center justify-between p-3 border rounded-lg bg-card hover:bg-secondary/30 transition-colors">
                            <div className="overflow-hidden flex-1 mr-2">
                                <div className="font-medium truncate">{repo.name}</div>
                                <div className="text-xs text-muted-foreground truncate">{repo.description}</div>
                                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                                    <span className="flex items-center gap-1">
                                        <Star className="w-3 h-3" /> {repo.stargazers_count}
                                    </span>
                                    {repo.language && <span>{repo.language}</span>}
                                    {repo.topics.length > 0 && (
                                        <span className="truncate text-primary/70">
                                            {repo.topics.slice(0, 3).join(', ')}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleImport(repo)}
                                disabled={importingId === repo.id}
                            >
                                {importingId === repo.id ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                    <Download className="w-4 h-4" />
                                )}
                            </Button>
                        </div>
                    ))}

                    {repos.length === 0 && !loading && (
                        <p className="text-center text-muted-foreground text-sm py-4">
                            Enter a GitHub username to fetch repositories
                        </p>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
