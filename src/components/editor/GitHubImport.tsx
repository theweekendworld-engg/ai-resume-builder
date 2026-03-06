'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fetchGitHubRepos, getGitHubIntegrationStatus, importGitHubRepoToLibrary } from '@/actions/github';
import { getUniqueLanguages } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Github, Loader2, Download, Star, Key, Filter } from 'lucide-react';
import { useResumeStore } from '@/store/resumeStore';
import { GitHubRepo } from '@/types/github';
import { toast } from 'sonner';

export function GitHubImport() {
    const [token, setToken] = useState('');
    const [showToken, setShowToken] = useState(false);
    const [repos, setRepos] = useState<GitHubRepo[]>([]);
    const [loading, setLoading] = useState(false);
    const [importingId, setImportingId] = useState<number | null>(null);
    const [languageFilter, setLanguageFilter] = useState<string>('all');
    const [linkedHandle, setLinkedHandle] = useState('');
    const [integrationError, setIntegrationError] = useState<string | null>(null);
    const [setupPath, setSetupPath] = useState('/dashboard');
    const [checkingIntegration, setCheckingIntegration] = useState(true);
    const minStars = 0;
    const { addProject } = useResumeStore();

    useEffect(() => {
        let mounted = true;
        const loadIntegration = async () => {
            setCheckingIntegration(true);
            const status = await getGitHubIntegrationStatus();
            if (!mounted) return;

            if (status.setupPath) {
                setSetupPath(status.setupPath);
            }

            if (!status.success || !status.linked || !status.linkedHandle) {
                setLinkedHandle('');
                setIntegrationError(status.error ?? 'Please integrate your GitHub first from Dashboard > Profile > GitHub.');
            } else {
                setLinkedHandle(status.linkedHandle);
                setIntegrationError(null);
            }

            setCheckingIntegration(false);
        };

        loadIntegration();
        return () => {
            mounted = false;
        };
    }, []);

    const handleTokenChange = (value: string) => {
        setToken(value);
    };

    const handleFetch = async () => {
        if (!linkedHandle) {
            toast.error(integrationError ?? 'Please integrate your GitHub first from Dashboard > Profile > GitHub.');
            return;
        }

        setLoading(true);
        try {
            const result = await fetchGitHubRepos({
                token: token || undefined,
                perPage: 30,
                minStars,
                excludeForks: true,
            });

            if (!result.success) {
                toast.error(result.error || 'Failed to fetch repositories');
                setRepos([]);
                if (result.error) setIntegrationError(result.error);
                if (result.setupPath) setSetupPath(result.setupPath);
                return;
            }

            const fetchedRepos = Array.isArray(result.repos) ? result.repos : [];
            setRepos(fetchedRepos);
            if (fetchedRepos.length === 0) {
                toast.info('No repositories found');
            }
        } catch (error: unknown) {
            console.error(error);
            toast.error('Failed to fetch repositories');
        } finally {
            setLoading(false);
        }
    };

    const handleImport = async (repo: GitHubRepo) => {
        if (!linkedHandle) {
            toast.error(integrationError ?? 'Please integrate your GitHub first from Dashboard > Profile > GitHub.');
            return;
        }

        setImportingId(repo.id);
        try {
            const result = await importGitHubRepoToLibrary({
                repoName: repo.name,
                repoUrl: repo.html_url,
                repoDescription: repo.description || '',
                token: token || undefined,
                fallbackLanguage: repo.language || undefined,
            });

            if (!result.success) {
                toast.error(result.error || 'Failed to import repository');
                return;
            }

            if (result.deduped) {
                toast.info(`"${repo.name}" already exists in your project library`);
            }

            // Add to Store
            addProject({
                name: repo.name,
                description: repo.description || `${repo.name} imported from GitHub.`,
                url: repo.html_url,
                technologies: repo.language ? [repo.language] : [],
            });

            if (result.warning) {
                toast.warning(result.warning);
            } else {
                toast.success(`Imported "${repo.name}" to projects and library`);
            }
        } catch (error: unknown) {
            console.error(error);
            toast.error('Failed to import project');
        } finally {
            setImportingId(null);
        }
    };

    // Get unique languages for filter dropdown
    const safeRepos = Array.isArray(repos) ? repos : [];
    const availableLanguages = getUniqueLanguages(safeRepos);

    // Apply client-side language filter
    const filteredRepos = languageFilter === 'all'
        ? safeRepos
        : safeRepos.filter(r => r.language?.toLowerCase() === languageFilter.toLowerCase());

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Github className="w-5 h-5" /> Import from GitHub
                </CardTitle>
                <CardDescription>
                    Fetch repositories and import into your project library. Imported summaries primarily come from README content.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Username input */}
                <div className="rounded-md border border-border bg-card/60 p-3">
                    {checkingIntegration ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Checking GitHub integration...
                        </div>
                    ) : linkedHandle ? (
                        <div className="flex items-center justify-between gap-3">
                            <p className="text-sm text-muted-foreground">
                                Connected GitHub account: <span className="font-medium text-foreground">@{linkedHandle}</span>
                            </p>
                            <Button onClick={handleFetch} disabled={loading} size="sm">
                                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Fetch repos"}
                            </Button>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <p className="text-sm text-muted-foreground">
                                {integrationError ?? 'Please integrate your GitHub first from Dashboard > Profile > GitHub.'}
                            </p>
                            <Button asChild size="sm" variant="secondary">
                                <Link href={setupPath}>Open profile settings</Link>
                            </Button>
                        </div>
                    )}
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
                {safeRepos.length > 0 && (
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

                    {safeRepos.length === 0 && !loading && linkedHandle && (
                        <p className="text-center text-muted-foreground text-sm py-4">
                            Click Fetch repos to load repositories from your connected GitHub account
                        </p>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
