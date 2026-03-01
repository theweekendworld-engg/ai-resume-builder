'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useResumeStore } from '@/store/resumeStore';
import { fetchGitHubRepos, getGitHubIntegrationStatus, importGitHubRepoToLibrary } from '@/actions/github';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Trash2, Plus, Sparkles, Github, Loader2, Download, Star, ChevronDown, ChevronUp } from 'lucide-react';
import { AIRewriteModal } from './AIRewriteModal';
import { toast } from 'sonner';

interface GitHubRepo {
    id: number;
    name: string;
    description: string | null;
    html_url: string;
    language: string | null | undefined;
    stargazers_count: number | undefined;
}

export function ProjectsEditor() {
    const { resumeData, addProject, updateProject, removeProject } = useResumeStore();
    const { projects } = resumeData;
    const [rewriteModalOpen, setRewriteModalOpen] = useState(false);
    const [currentRewriteId, setCurrentRewriteId] = useState<string | null>(null);
    const [currentRewriteText, setCurrentRewriteText] = useState('');

    // GitHub state
    const [repos, setRepos] = useState<GitHubRepo[]>([]);
    const [loading, setLoading] = useState(false);
    const [importingId, setImportingId] = useState<number | null>(null);
    const [showGitHub, setShowGitHub] = useState(false);
    const [linkedHandle, setLinkedHandle] = useState('');
    const [integrationError, setIntegrationError] = useState<string | null>(null);
    const [setupPath, setSetupPath] = useState('/dashboard');
    const [checkingIntegration, setCheckingIntegration] = useState(true);

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

    const handleOpenRewrite = (id: string, text: string) => {
        setCurrentRewriteId(id);
        setCurrentRewriteText(text);
        setRewriteModalOpen(true);
    };

    const handleAcceptRewrite = (rewrittenText: string) => {
        if (currentRewriteId) {
            updateProject(currentRewriteId, { description: rewrittenText });
            setCurrentRewriteId(null);
        }
    };

    const handleFetchRepos = async () => {
        if (!linkedHandle) {
            toast.error(integrationError ?? 'Please integrate your GitHub first from Dashboard > Profile > GitHub.');
            return;
        }

        setLoading(true);
        try {
            const result = await fetchGitHubRepos({});
            if (!result.success) {
                toast.error(result.error || 'Failed to fetch repositories');
                if (result.setupPath) setSetupPath(result.setupPath);
                if (result.error) setIntegrationError(result.error);
                setRepos([]);
                return;
            }

            const fetchedRepos = Array.isArray(result.repos) ? result.repos : [];
            setRepos(fetchedRepos);
            if (fetchedRepos.length > 0) {
                setShowGitHub(true);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const handleImportRepo = async (repo: GitHubRepo) => {
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
                fallbackLanguage: repo.language || undefined,
            });

            if (!result.success) {
                toast.error(result.error || 'Failed to import repository');
                return;
            }

            addProject({
                name: repo.name,
                description: repo.description || `${repo.name} imported from GitHub.`,
                url: repo.html_url,
                technologies: repo.language ? [repo.language] : [],
            });

            // Remove from list after importing
            setRepos(repos.filter(r => r.id !== repo.id));
            if (result.deduped) {
                toast.info(`"${repo.name}" already exists in your project library`);
            } else if (result.warning) {
                toast.warning(result.warning);
            } else {
                toast.success(`Imported "${repo.name}" to projects and library`);
            }
        } catch (error) {
            console.error(error);
            toast.error('Failed to import project');
        } finally {
            setImportingId(null);
        }
    };

    return (
        <Card className="h-full flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between pb-4">
                <CardTitle className="text-xl">Projects</CardTitle>
                <Button onClick={() => addProject()} size="sm" variant="outline">
                    <Plus className="w-4 h-4 mr-2" /> Add Project
                </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-6 flex-1 min-h-0 overflow-y-auto">
                {/* GitHub Import Section */}
                <div className="border border-border rounded-lg p-4 bg-card/50 space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Github className="w-5 h-5" />
                            <span className="font-medium">Import from GitHub</span>
                            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                <Sparkles className="w-2.5 h-2.5" />
                                Smart Import
                            </span>
                        </div>
                        {repos.length > 0 && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowGitHub(!showGitHub)}
                                className="h-7 text-xs"
                            >
                                {repos.length} repos
                                {showGitHub ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
                            </Button>
                        )}
                    </div>

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
                                <Button
                                    onClick={handleFetchRepos}
                                    disabled={loading}
                                    variant="secondary"
                                    size="sm"
                                    className="h-9"
                                >
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

                    {/* Repos List */}
                    {showGitHub && repos.length > 0 && (
                        <div className="space-y-2 max-h-[250px] overflow-y-auto border-t border-border pt-3">
                            <p className="text-xs text-muted-foreground mb-2">
                                Click import to add a repo. Library project details are sourced from the repository README when available.
                            </p>
                            {repos.map((repo) => (
                                <div
                                    key={repo.id}
                                    className="flex items-center justify-between p-3 border border-border rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors"
                                >
                                    <div className="overflow-hidden flex-1 mr-3">
                                        <div className="font-medium text-sm truncate">{repo.name}</div>
                                        {repo.description && (
                                            <div className="text-xs text-muted-foreground truncate mt-0.5">
                                                {repo.description}
                                            </div>
                                        )}
                                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                                            {repo.stargazers_count && repo.stargazers_count > 0 && (
                                                <span className="flex items-center gap-1">
                                                    <Star className="w-3 h-3" />
                                                    {repo.stargazers_count}
                                                </span>
                                            )}
                                            {repo.language && (
                                                <span className="px-1.5 py-0.5 bg-primary/10 text-primary rounded text-[10px]">
                                                    {repo.language}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="secondary"
                                        onClick={() => handleImportRepo(repo)}
                                        disabled={importingId === repo.id}
                                        className="h-8 text-xs gap-1.5 flex-shrink-0"
                                    >
                                        {importingId === repo.id ? (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                        ) : (
                                            <>
                                                <Download className="w-3 h-3" />
                                                Import
                                            </>
                                        )}
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}

                    {repos.length === 0 && linkedHandle && !loading && (
                        <p className="text-xs text-muted-foreground text-center py-2">
                            Click Fetch repos to import repositories from your connected GitHub account
                        </p>
                    )}
                </div>

                {/* Projects List */}
                {projects.map((item) => (
                    <div key={item.id} className="border border-border rounded-lg p-6 flex flex-col gap-4 relative group bg-card/50">
                        <div className="absolute right-4 top-4 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                            <Button variant="ghost" size="icon" onClick={() => removeProject(item.id)} className="h-8 w-8">
                                <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="flex flex-col gap-2">
                                <Label className="text-sm font-medium">Project Name</Label>
                                <Input
                                    value={item.name}
                                    onChange={(e) => updateProject(item.id, { name: e.target.value })}
                                    placeholder="Project Name"
                                    className="h-10"
                                />
                            </div>
                            <div className="flex flex-col gap-2">
                                <Label className="text-sm font-medium">Project URL</Label>
                                <Input
                                    value={item.url}
                                    onChange={(e) => updateProject(item.id, { url: e.target.value })}
                                    placeholder="https://..."
                                    className="h-10"
                                />
                            </div>
                        </div>

                        <div className="flex flex-col gap-2 flex-1">
                            <div className="flex justify-between items-center">
                                <Label className="text-sm font-medium">Description</Label>
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            onClick={() => handleOpenRewrite(item.id, item.description)}
                                            disabled={!item.description}
                                            className="h-8 text-xs gap-1.5"
                                >
                                    <Sparkles className="w-3.5 h-3.5" />
                                    <span className="hidden sm:inline">Enhance</span>
                                </Button>
                            </div>
                            <Textarea
                                value={item.description}
                                onChange={(e) => updateProject(item.id, { description: e.target.value })}
                                placeholder="Describe the project, your role, technologies used, and key achievements..."
                                className="flex-1 min-h-[150px] resize-y"
                            />
                        </div>

                        <div className="flex flex-col gap-2">
                            <Label className="text-sm font-medium">Technologies</Label>
                            <Input
                                value={item.technologies.join(', ')}
                                onChange={(e) => updateProject(item.id, { technologies: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                                placeholder="React, Node.js, TypeScript"
                                className="h-10"
                            />
                            <p className="text-xs text-muted-foreground">Separate technologies with commas</p>
                        </div>
                    </div>
                ))}

                {projects.length === 0 && (
                    <div className="text-center text-muted-foreground py-12">
                        <p className="text-sm">No projects added yet.</p>
                        <p className="text-xs mt-1">Import from GitHub or click &quot;Add Project&quot; to get started.</p>
                    </div>
                )}
            </CardContent>

            <AIRewriteModal
                open={rewriteModalOpen}
                onOpenChange={setRewriteModalOpen}
                originalText={currentRewriteText}
                onAccept={handleAcceptRewrite}
                type="project"
            />
        </Card>
    );
}
