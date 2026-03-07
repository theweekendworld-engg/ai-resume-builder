'use client';

import Link from 'next/link';
import { useState, useTransition, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createUserProject, deleteUserProject, updateUserProject, listUserProjects, reEmbedAllUserProjects } from '@/actions/projects';
import { fetchGitHubRepos, getGitHubIntegrationStatus, importGitHubRepoToLibrary } from '@/actions/github';
import { getUniqueLanguages } from '@/lib/utils';
import { GitHubRepo } from '@/types/github';
import { toast } from 'sonner';
import {
  Github,
  Loader2,
  Download,
  Star,
  Key,
  Filter,
  Trash2,
  Pencil,
  X,
  Check,
  ExternalLink,
  Plus,
  FileUp,
} from 'lucide-react';
import { ResumeUploadZone } from '@/components/resume-import/ResumeUploadZone';
import { ImportPreviewDialog } from '@/components/resume-import/ImportPreviewDialog';
import type { ParsedResumeData } from '@/lib/aiSchemas';

interface ProjectItem {
  id: string;
  name: string;
  description: string;
  url: string;
  githubUrl: string | null;
  technologies: string[];
  source: 'github' | 'manual';
  embedded: boolean;
  updatedAt: Date;
}

interface ProjectLibraryPanelProps {
  projects: ProjectItem[];
}

export function ProjectLibraryPanel({ projects: initialProjects }: ProjectLibraryPanelProps) {
  const [projects, setProjects] = useState<ProjectItem[]>(initialProjects);
  const [parsedData, setParsedData] = useState<ParsedResumeData | null>(null);
  const [showImportPreview, setShowImportPreview] = useState(false);
  const [isReEmbeddingAll, startReEmbedAllTransition] = useTransition();

  const refreshProjects = useCallback(async () => {
    const result = await listUserProjects();
    if (result.success && result.projects) {
      setProjects(
        result.projects.map((p) => ({
          ...p,
          source: p.source as 'github' | 'manual',
        }))
      );
    }
  }, []);

  const handleParsed = (data: ParsedResumeData) => {
    setParsedData(data);
    setShowImportPreview(true);
  };

  const handleReEmbedAll = () => {
    startReEmbedAllTransition(async () => {
      const result = await reEmbedAllUserProjects();
      if (!result.success) {
        toast.error(result.error ?? 'Failed to re-embed project library');
        return;
      }
      toast.success(
        `Re-embedding complete: ${result.embedded ?? 0}/${result.total ?? 0} updated${(result.failed ?? 0) > 0 ? `, ${result.failed} failed` : ''}.`
      );
      await refreshProjects();
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Project Library</h2>
          <p className="text-sm text-muted-foreground">
            Reusable project bank for AI resume generation and semantic matching.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleReEmbedAll}
          disabled={isReEmbeddingAll || projects.length === 0}
        >
          {isReEmbeddingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Re-embed all
        </Button>
      </div>

      <Tabs defaultValue="projects">
        <TabsList className="flex flex-wrap gap-1">
          <TabsTrigger value="projects">
            My Projects {projects.length > 0 && `(${projects.length})`}
          </TabsTrigger>
          <TabsTrigger value="add">Add Manually</TabsTrigger>
          <TabsTrigger value="github" className="gap-1.5">
            <Github className="w-3.5 h-3.5" />
            Import from GitHub
          </TabsTrigger>
          <TabsTrigger value="resume" className="gap-1.5">
            <FileUp className="w-3.5 h-3.5" />
            From Resume
          </TabsTrigger>
        </TabsList>

        <TabsContent value="projects" className="mt-4">
          <ProjectsList projects={projects} onRefresh={refreshProjects} />
        </TabsContent>

        <TabsContent value="add" className="mt-4">
          <AddManuallyForm onSuccess={refreshProjects} />
        </TabsContent>

        <TabsContent value="github" className="mt-4">
          <GitHubImportSection onSuccess={refreshProjects} />
        </TabsContent>

        <TabsContent value="resume" className="mt-4">
          <div className="rounded-xl border bg-card p-5">
            <h3 className="mb-1 text-sm font-semibold">Import projects from resume</h3>
            <p className="mb-4 text-xs text-muted-foreground">
              Upload your existing PDF resume and we&apos;ll extract projects (with GitHub/live
              links) and embed them for smart matching.
            </p>
            <ResumeUploadZone
              onParsed={handleParsed}
              compact
            />
          </div>
        </TabsContent>
      </Tabs>

      {parsedData && (
        <ImportPreviewDialog
          data={parsedData}
          open={showImportPreview}
          onClose={() => setShowImportPreview(false)}
          onImported={() => {
            setShowImportPreview(false);
            refreshProjects();
          }}
          defaultOptions={{
            mergeProfile: false,
            sections: { experience: false, education: false, projects: true, achievements: false },
          }}
        />
      )}
    </div>
  );
}

function ProjectsList({
  projects,
  onRefresh,
}: {
  projects: ProjectItem[];
  onRefresh: () => Promise<void>;
}) {
  const normalizeComparableUrl = (value: string | null | undefined) =>
    (value ?? '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '');

  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    description: '',
    url: '',
    githubUrl: '',
    technologies: '',
  });

  const startEdit = (project: ProjectItem) => {
    setEditingId(project.id);
    setEditForm({
      name: project.name,
      description: project.description,
      url: project.url,
      githubUrl: project.githubUrl ?? '',
      technologies: project.technologies.join(', '),
    });
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = (id: string) => {
    startTransition(async () => {
      const result = await updateUserProject({
        id,
        name: editForm.name,
        description: editForm.description,
        url: editForm.url,
        githubUrl: editForm.githubUrl || undefined,
        technologies: editForm.technologies
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      });

      if (!result.success) {
        toast.error(result.error ?? 'Failed to update project');
        return;
      }

      if (result.warning) {
        toast.warning(result.warning);
      } else {
        toast.success('Project updated');
      }

      setEditingId(null);
      await onRefresh();
    });
  };

  const removeProject = (id: string) => {
    startTransition(async () => {
      const result = await deleteUserProject(id);
      if (!result.success) {
        toast.error(result.error ?? 'Failed to remove project');
        return;
      }
      toast.success('Project removed');
      await onRefresh();
    });
  };

  if (projects.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No projects yet. Add one manually or import from GitHub.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {projects.map((project) => (
        <article key={project.id} className="rounded-lg border border-border bg-card p-4">
          {editingId === project.id ? (
            <div className="space-y-3">
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Project name"
              />
              <Textarea
                value={editForm.description}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Description"
                rows={3}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  value={editForm.url}
                  onChange={(e) => setEditForm((f) => ({ ...f, url: e.target.value }))}
                  placeholder="Live URL"
                />
                <Input
                  value={editForm.githubUrl}
                  onChange={(e) => setEditForm((f) => ({ ...f, githubUrl: e.target.value }))}
                  placeholder="GitHub URL"
                />
              </div>
              <Input
                value={editForm.technologies}
                onChange={(e) => setEditForm((f) => ({ ...f, technologies: e.target.value }))}
                placeholder="Technologies (comma separated)"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => saveEdit(project.id)} disabled={isPending}>
                  {isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Check className="w-3 h-3" />
                  )}
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={isPending}>
                  <X className="w-3 h-3" /> Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-medium">{project.name}</h3>
                  <Badge
                    variant={project.source === 'github' ? 'secondary' : 'outline'}
                    className="text-xs"
                  >
                    {project.source === 'github' ? (
                      <>
                        <Github className="mr-1 w-2.5 h-2.5" />
                        GitHub
                      </>
                    ) : (
                      'Manual'
                    )}
                  </Badge>
                  {!project.embedded && (
                    <Badge
                      variant="outline"
                      className="text-xs border-yellow-400 text-yellow-600"
                    >
                      Not embedded
                    </Badge>
                  )}
                </div>
                {project.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {project.description}
                  </p>
                )}
                {project.technologies.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {project.technologies.slice(0, 8).map((tech) => (
                      <Badge key={tech} variant="secondary" className="px-1.5 py-0 text-xs">
                        {tech}
                      </Badge>
                    ))}
                    {project.technologies.length > 8 && (
                      <span className="text-xs text-muted-foreground">
                        +{project.technologies.length - 8} more
                      </span>
                    )}
                  </div>
                )}
                {(project.githubUrl || project.url) && (
                  <div className="mt-1 space-y-1">
                    {project.githubUrl && (
                      <a
                        href={project.githubUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <ExternalLink className="w-3 h-3" />
                        GitHub: {project.githubUrl}
                      </a>
                    )}
                    {project.url &&
                      normalizeComparableUrl(project.url) !==
                        normalizeComparableUrl(project.githubUrl) && (
                        <a
                          href={project.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Live: {project.url}
                        </a>
                      )}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => startEdit(project)}
                  disabled={isPending}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={() => removeProject(project.id)}
                  disabled={isPending}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

function AddManuallyForm({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState({
    name: '',
    description: '',
    url: '',
    githubUrl: '',
    technologies: '',
  });

  const addProject = () => {
    if (!form.name.trim()) {
      toast.error('Project name is required');
      return;
    }

    startTransition(async () => {
      const result = await createUserProject({
        name: form.name,
        description: form.description,
        url: form.url,
        githubUrl: form.githubUrl || undefined,
        technologies: form.technologies
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      });

      if (!result.success) {
        toast.error(result.error ?? 'Failed to add project');
        return;
      }

      if (result.warning) {
        toast.warning(result.warning);
      } else {
        toast.success('Project added and embedded for semantic search');
      }

      setForm({ name: '', description: '', url: '', githubUrl: '', technologies: '' });
      await onSuccess();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add Project Manually</CardTitle>
        <CardDescription>
          Add any project with a description. It will be embedded for semantic resume matching.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            placeholder="Project name *"
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
          />
          <Input
            placeholder="Live URL (optional)"
            value={form.url}
            onChange={(e) => setForm((p) => ({ ...p, url: e.target.value }))}
          />
          <Input
            placeholder="GitHub URL (optional)"
            value={form.githubUrl}
            onChange={(e) => setForm((p) => ({ ...p, githubUrl: e.target.value }))}
          />
          <Input
            placeholder="Technologies (comma separated)"
            value={form.technologies}
            onChange={(e) => setForm((p) => ({ ...p, technologies: e.target.value }))}
          />
        </div>
        <Textarea
          placeholder="Description — what does this project do? What problem does it solve?"
          rows={4}
          value={form.description}
          onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
        />
        <Button onClick={addProject} disabled={isPending || !form.name.trim()}>
          {isPending ? (
            <Loader2 className="mr-2 w-4 h-4 animate-spin" />
          ) : (
            <Plus className="mr-2 w-4 h-4" />
          )}
          {isPending ? 'Adding…' : 'Add Project'}
        </Button>
      </CardContent>
    </Card>
  );
}

function GitHubImportSection({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [loading, setLoading] = useState(false);
  const [importingId, setImportingId] = useState<number | null>(null);
  const [importedIds, setImportedIds] = useState<Set<number>>(new Set());
  const [languageFilter, setLanguageFilter] = useState<string>('all');
  const [linkedHandle, setLinkedHandle] = useState('');
  const [integrationError, setIntegrationError] = useState<string | null>(null);
  const [setupPath, setSetupPath] = useState('/dashboard');
  const [checkingIntegration, setCheckingIntegration] = useState(true);

  useEffect(() => {
    let mounted = true;
    getGitHubIntegrationStatus().then((status) => {
      if (!mounted) return;
      if (status.setupPath) setSetupPath(status.setupPath);
      if (!status.success || !status.linked || !status.linkedHandle) {
        setLinkedHandle('');
        setIntegrationError(
          status.error ?? 'Add your GitHub handle in the Personal tab above and save.'
        );
      } else {
        setLinkedHandle(status.linkedHandle);
        setIntegrationError(null);
      }
      setCheckingIntegration(false);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const handleFetch = async () => {
    if (!linkedHandle) {
      toast.error(integrationError ?? 'Please add your GitHub handle first.');
      return;
    }

    setLoading(true);
    try {
      const result = await fetchGitHubRepos({
        token: token || undefined,
        perPage: 30,
        minStars: 0,
        excludeForks: true,
      });

      if (!result.success) {
        toast.error(result.error || 'Failed to fetch repositories');
        if (result.error) setIntegrationError(result.error);
        if (result.setupPath) setSetupPath(result.setupPath);
        return;
      }

      const fetched = Array.isArray(result.repos) ? result.repos : [];
      setRepos(fetched);
      if (fetched.length === 0) toast.info('No repositories found');
    } catch {
      toast.error('Failed to fetch repositories');
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async (repo: GitHubRepo) => {
    if (!linkedHandle) {
      toast.error(integrationError ?? 'Please add your GitHub handle first.');
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

      setImportedIds((prev) => new Set([...prev, repo.id]));

      if (result.deduped) {
        toast.info(`"${repo.name}" already in your project library`);
      } else if (result.warning) {
        toast.warning(result.warning);
      } else {
        toast.success(`Imported "${repo.name}" — README parsed and embedded`);
      }

      await onSuccess();
    } catch {
      toast.error('Failed to import project');
    } finally {
      setImportingId(null);
    }
  };

  const safeRepos = Array.isArray(repos) ? repos : [];
  const availableLanguages = getUniqueLanguages(safeRepos);
  const filteredRepos =
    languageFilter === 'all'
      ? safeRepos
      : safeRepos.filter((r) => r.language?.toLowerCase() === languageFilter.toLowerCase());

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Github className="w-4 h-4" /> Import from GitHub
        </CardTitle>
        <CardDescription>
          Fetch repositories, parse their READMEs and embed them for semantic resume matching.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border border-border bg-muted/30 p-3">
          {checkingIntegration ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking GitHub integration…
            </div>
          ) : linkedHandle ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Connected:{' '}
                <span className="font-medium text-foreground">@{linkedHandle}</span>
              </p>
              <Button onClick={handleFetch} disabled={loading} size="sm">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Fetch repos'}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {integrationError ??
                  'Add your GitHub handle in the Personal tab above, then save.'}
              </p>
              <Button asChild size="sm" variant="secondary">
                <Link href={setupPath}>Open Personal tab</Link>
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <button
            onClick={() => setShowToken(!showToken)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Key className="w-3 h-3" />
            {showToken ? 'Hide' : 'Add'} Personal Access Token (optional, for private repos)
          </button>
          {showToken && (
            <>
              <Input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ghp_xxxxx"
                className="text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Not stored — used only for this session.
              </p>
            </>
          )}
        </div>

        {safeRepos.length > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <Select value={languageFilter} onValueChange={setLanguageFilter}>
              <SelectTrigger className="h-8 w-[140px] text-xs">
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
            <span className="text-xs text-muted-foreground">
              {filteredRepos.length} repo{filteredRepos.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        <div className="max-h-[360px] space-y-2 overflow-y-auto">
          {filteredRepos.map((repo) => {
            const alreadyImported = importedIds.has(repo.id);
            return (
              <div
                key={repo.id}
                className="flex items-center justify-between rounded-lg border bg-card p-3 transition-colors hover:bg-secondary/30"
              >
                <div className="mr-2 min-w-0 flex-1">
                  <div className="truncate font-medium">{repo.name}</div>
                  {repo.description && (
                    <div className="truncate text-xs text-muted-foreground">
                      {repo.description}
                    </div>
                  )}
                  <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
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
                  variant={alreadyImported ? 'secondary' : 'outline'}
                  onClick={() => !alreadyImported && handleImport(repo)}
                  disabled={importingId === repo.id || alreadyImported}
                >
                  {importingId === repo.id ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : alreadyImported ? (
                    <Check className="w-3 h-3" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                </Button>
              </div>
            );
          })}

          {safeRepos.length === 0 && !loading && linkedHandle && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Click &quot;Fetch repos&quot; to load repositories from your GitHub account.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
