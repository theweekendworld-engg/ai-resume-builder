'use client';

import { useState } from 'react';
import { useResumeStore } from '@/store/resumeStore';
import { fetchGitHubRepos, fetchRepoDetails } from '@/actions/github';
import { improveText } from '@/actions/ai';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Trash2, Plus, Sparkles, Github, Loader2, Download, Star, ChevronDown, ChevronUp } from 'lucide-react';
import { AIRewriteModal } from './AIRewriteModal';

interface GitHubRepo {
    id: number;
    name: string;
    description: string | null;
    html_url: string;
    language: string | null | undefined;
    stargazers_count: number | undefined;
}

export function ProjectsEditor() {
    const { resumeData, addProject, updateProject, removeProject, githubUsername, setGithubUsername } = useResumeStore();
    const { projects } = resumeData;
    const [rewriteModalOpen, setRewriteModalOpen] = useState(false);
    const [currentRewriteId, setCurrentRewriteId] = useState<string | null>(null);
    const [currentRewriteText, setCurrentRewriteText] = useState('');

    // GitHub state
    const [repos, setRepos] = useState<GitHubRepo[]>([]);
    const [loading, setLoading] = useState(false);
    const [importingId, setImportingId] = useState<number | null>(null);
    const [showGitHub, setShowGitHub] = useState(false);

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
        if (!githubUsername) return;
        setLoading(true);
        try {
            const data = await fetchGitHubRepos({ username: githubUsername });
            setRepos(data);
            if (data.length > 0) {
                setShowGitHub(true);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const handleImportRepo = async (repo: GitHubRepo) => {
        setImportingId(repo.id);
        try {
            const details = await fetchRepoDetails(githubUsername, repo.name);

            let description = repo.description || "";
            if (details.readme) {
                const context = details.readme.substring(0, 2000);
                description = await improveText(context, 'project');
            } else if (description) {
                description = await improveText(description, 'project');
            }

            addProject({
                name: repo.name,
                description: description,
                url: repo.html_url,
                technologies: repo.language ? [repo.language] : [],
            });

            // Remove from list after importing
            setRepos(repos.filter(r => r.id !== repo.id));
        } catch (error) {
            console.error(error);
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

                    <div className="flex gap-2">
                        <Input
                            value={githubUsername}
                            onChange={(e) => setGithubUsername(e.target.value)}
                            placeholder="GitHub username"
                            className="h-9"
                            onKeyDown={(e) => e.key === 'Enter' && handleFetchRepos()}
                        />
                        <Button
                            onClick={handleFetchRepos}
                            disabled={loading || !githubUsername}
                            variant="secondary"
                            size="sm"
                            className="h-9"
                        >
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Fetch"}
                        </Button>
                    </div>

                    {/* Repos List */}
                    {showGitHub && repos.length > 0 && (
                        <div className="space-y-2 max-h-[250px] overflow-y-auto border-t border-border pt-3">
                            <p className="text-xs text-muted-foreground mb-2">
                                Click import to add a repo. Description will be auto-enhanced.
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

                    {repos.length === 0 && githubUsername && !loading && (
                        <p className="text-xs text-muted-foreground text-center py-2">
                            Enter your GitHub username and click Fetch to import repositories
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
