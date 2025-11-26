'use client';

import { useState } from 'react';
import { fetchGitHubRepos, fetchRepoDetails } from '@/actions/github';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Github, Loader2, Download } from 'lucide-react';
import { useResumeStore } from '@/store/resumeStore';
import { improveText } from '@/actions/ai';

export function GitHubImport() {
    const [username, setUsername] = useState('');
    const [repos, setRepos] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [importingId, setImportingId] = useState<number | null>(null);
    const { addProject } = useResumeStore();

    const handleFetch = async () => {
        if (!username) return;
        setLoading(true);
        try {
            const data = await fetchGitHubRepos(username);
            setRepos(data);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const handleImport = async (repo: any) => {
        setImportingId(repo.id);
        try {
            // 1. Fetch README
            const readme = await fetchRepoDetails(username, repo.name);

            // 2. AI Summarize/Extract bullets
            let description = repo.description || "";
            if (readme) {
                // Truncate readme for AI context (first 2000 chars for better context)
                const context = readme.substring(0, 2000);
                description = await improveText(context, 'project');
            } else if (description) {
                description = await improveText(description, 'project');
            }

            // 3. Add to Store
            addProject({
                name: repo.name,
                description: description,
                url: repo.html_url,
                technologies: repo.language ? [repo.language] : [],
            });

        } catch (error) {
            console.error(error);
        } finally {
            setImportingId(null);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Github className="w-5 h-5" /> Import from GitHub
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex gap-2">
                    <Input
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="GitHub Username"
                    />
                    <Button onClick={handleFetch} disabled={loading}>
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Fetch"}
                    </Button>
                </div>

                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {repos.map((repo) => (
                        <div key={repo.id} className="flex items-center justify-between p-3 border rounded-lg bg-card">
                            <div className="overflow-hidden">
                                <div className="font-medium truncate">{repo.name}</div>
                                <div className="text-xs text-muted-foreground truncate">{repo.description}</div>
                                <div className="text-xs text-muted-foreground mt-1">
                                    ⭐ {repo.stargazers_count} • {repo.language}
                                </div>
                            </div>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleImport(repo)}
                                disabled={importingId === repo.id}
                            >
                                {importingId === repo.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-4 h-4" />}
                            </Button>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}
