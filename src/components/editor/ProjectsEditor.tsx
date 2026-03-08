'use client';

import { useEffect, useMemo, useState } from 'react';
import { useResumeStore } from '@/store/resumeStore';
import { suggestProjectsForJob } from '@/actions/projects';
import { improveText } from '@/actions/ai';
import { suggestSectionSkillHints } from '@/actions/copilot';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trash2, Plus, Sparkles, Loader2 } from 'lucide-react';
import { AIRewriteModal } from './AIRewriteModal';
import { toast } from 'sonner';

type SuggestedProject = {
  id: string;
  name: string;
  description: string;
  url: string;
  liveUrl: string;
  repoUrl: string;
  githubUrl: string | null;
  technologies: string[];
  relevanceScore: number;
  contextSnippet: string;
};

function resolveProjectUrls(project: {
  url?: string;
  liveUrl?: string;
  repoUrl?: string;
}): { url: string; liveUrl: string; repoUrl: string } {
  const explicitLive = (project.liveUrl || '').trim();
  const explicitRepo = (project.repoUrl || '').trim();
  const url = explicitLive || explicitRepo || '';
  const repoUrl = explicitRepo;
  const liveUrl = explicitLive;
  return { url, liveUrl, repoUrl };
}

export function ProjectsEditor() {
  const { resumeData, jobDescription, atsScore, addProject, updateProject, removeProject } = useResumeStore();
  const { projects } = resumeData;
  const [rewriteModalOpen, setRewriteModalOpen] = useState(false);
  const [currentRewriteId, setCurrentRewriteId] = useState<string | null>(null);
  const [currentRewriteText, setCurrentRewriteText] = useState('');
  const [sectionSkillHint, setSectionSkillHint] = useState<{ matchedKeywords: string[]; missingKeywords: string[] } | null>(null);
  const [suggestedProjects, setSuggestedProjects] = useState<SuggestedProject[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [addingSuggestionId, setAddingSuggestionId] = useState<string | null>(null);

  const existingUrls = useMemo(
    () => projects
      .flatMap((project) => {
        const urls = resolveProjectUrls(project);
        return [
          urls.url,
          urls.url.replace(/\/+$/, ''),
          urls.liveUrl,
          urls.liveUrl.replace(/\/+$/, ''),
          urls.repoUrl,
          urls.repoUrl.replace(/\/+$/, ''),
        ];
      })
      .map((url) => url.trim())
      .filter(Boolean),
    [projects]
  );

  const updateProjectUrls = (
    id: string,
    patch: { liveUrl?: string; repoUrl?: string }
  ) => {
    const current = projects.find((project) => project.id === id);
    if (!current) return;
    const base = resolveProjectUrls(current);
    const next = resolveProjectUrls({
      url: base.url,
      liveUrl: patch.liveUrl ?? base.liveUrl,
      repoUrl: patch.repoUrl ?? base.repoUrl,
    });
    updateProject(id, next);
  };

  useEffect(() => {
    if (!jobDescription.trim()) {
      setSuggestedProjects([]);
      return;
    }

    let cancelled = false;
    setLoadingSuggestions(true);

    const timer = setTimeout(async () => {
      const result = await suggestProjectsForJob({
        jobDescription,
        limit: 4,
        excludeProjectUrls: existingUrls,
      });
      if (cancelled) return;
      if (result.success && result.projects) {
        setSuggestedProjects(result.projects);
      } else {
        setSuggestedProjects([]);
      }
      setLoadingSuggestions(false);
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [existingUrls, jobDescription]);

  useEffect(() => {
    if (!jobDescription.trim() || projects.length === 0) {
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const sectionId = 'projects-section';
        const sectionText = projects
          .map((item) => {
            const urls = resolveProjectUrls(item);
            const tech = item.technologies.length > 0 ? `Tech: ${item.technologies.join(', ')}` : '';
            const links = [
              urls.liveUrl ? `Live URL: ${urls.liveUrl}` : '',
              urls.repoUrl ? `Repo URL: ${urls.repoUrl}` : '',
            ].filter(Boolean).join(' ');
            return `${item.name}. ${item.description}. ${tech}. ${links}`.trim();
          })
          .filter(Boolean)
          .join('\n')
          .slice(0, 6000);
        const hints = await suggestSectionSkillHints({
          section: 'projects',
          jobDescription,
          entries: [{
            id: sectionId,
            text: sectionText,
            technologies: projects.flatMap((item) => item.technologies).slice(0, 40),
          }],
        });
        if (!cancelled) {
          setSectionSkillHint(hints[sectionId] ?? null);
        }
      } catch {
        if (!cancelled) {
          setSectionSkillHint(null);
        }
      }
    }, 700);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobDescription, projects]);

  const visibleSectionSkillHint = jobDescription.trim() && projects.length > 0 ? sectionSkillHint : null;

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

  const handleAddSuggestion = async (project: SuggestedProject) => {
    setAddingSuggestionId(project.id);
    const resolvedUrls = resolveProjectUrls({
      url: project.url || '',
      liveUrl: project.liveUrl || '',
      repoUrl: project.repoUrl || project.githubUrl || '',
    });
    try {
      const tailored = await improveText(
        project.description || `${project.name} project.`,
        'project',
        `Tailor this project description to the target job. Keep facts unchanged, emphasize measurable outcomes, and preserve concrete technologies.\n\nProject context:\n${project.contextSnippet || `${project.name}. ${project.description}`}\n\nJob description:\n${jobDescription.slice(0, 3500)}`
      );

      addProject({
        name: project.name,
        description: tailored,
        url: resolvedUrls.url,
        liveUrl: resolvedUrls.liveUrl,
        repoUrl: resolvedUrls.repoUrl,
        technologies: project.technologies,
      });
      setSuggestedProjects((prev) => prev.filter((item) => item.id !== project.id));
      toast.success(`Added "${project.name}" to your resume.`);
    } catch {
      addProject({
        name: project.name,
        description: project.description || `${project.name} project.`,
        url: resolvedUrls.url,
        liveUrl: resolvedUrls.liveUrl,
        repoUrl: resolvedUrls.repoUrl,
        technologies: project.technologies,
      });
      setSuggestedProjects((prev) => prev.filter((item) => item.id !== project.id));
      toast.success(`Added "${project.name}" to your resume.`);
    } finally {
      setAddingSuggestionId(null);
    }
  };

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <CardTitle className="text-xl">Projects</CardTitle>
        <Button onClick={() => addProject()} size="sm" variant="outline">
          <Plus className="mr-2 h-4 w-4" /> Add Project
        </Button>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto">
        {atsScore && visibleSectionSkillHint && (
          <div className="rounded-md border border-border bg-card/40 p-3">
            {(visibleSectionSkillHint.matchedKeywords ?? []).length > 0 && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400">
                Matched Skills (Projects): {visibleSectionSkillHint.matchedKeywords.join(', ')}
              </p>
            )}
            {(visibleSectionSkillHint.missingKeywords ?? []).length > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Missing Skills (Projects): {visibleSectionSkillHint.missingKeywords.join(', ')}
              </p>
            )}
          </div>
        )}

        {jobDescription.trim() && (
          <div className="space-y-3 rounded-lg border border-border bg-card/50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Suggested Projects for this Job</p>
                <p className="text-xs text-muted-foreground">
                  Ranked from your project library using semantic matching.
                </p>
              </div>
              {loadingSuggestions && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>

            {!loadingSuggestions && suggestedProjects.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No recommendations yet. Add projects in Dashboard &gt; Profile &gt; Project Library to get smart suggestions here.
              </p>
            )}

            {suggestedProjects.length > 0 && (
              <div className="grid gap-3 md:grid-cols-2">
                {suggestedProjects.map((project) => (
                  <div key={project.id} className="space-y-2 rounded-md border border-border bg-background p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium">{project.name}</p>
                      <Badge variant="secondary" className="text-[10px]">
                        {(project.relevanceScore * 100).toFixed(0)}% match
                      </Badge>
                    </div>
                    <p className="line-clamp-3 text-xs text-muted-foreground">
                      {project.description || 'No description available.'}
                    </p>
                    {project.technologies.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {project.technologies.slice(0, 4).map((tech) => (
                          <Badge key={`${project.id}-${tech}`} variant="outline" className="text-[10px]">
                            {tech}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      className="w-full"
                      onClick={() => handleAddSuggestion(project)}
                      disabled={addingSuggestionId === project.id}
                    >
                      {addingSuggestionId === project.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Sparkles className="mr-1 h-3.5 w-3.5" />
                          Add
                        </>
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {projects.map((item) => (
          <div key={item.id} className="group relative flex flex-col gap-4 rounded-lg border border-border bg-card/50 p-6">
            <div className="absolute right-4 top-4 z-10 opacity-0 transition-opacity group-hover:opacity-100">
              <Button variant="ghost" size="icon" onClick={() => removeProject(item.id)} className="h-8 w-8">
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>

            <div className="flex flex-col gap-2">
              <Label className="text-sm font-medium">Project Name</Label>
              <Input
                value={item.name}
                onChange={(e) => updateProject(item.id, { name: e.target.value })}
                placeholder="Project Name"
                className="h-10"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label className="text-sm font-medium">Live URL</Label>
                <Input
                  value={resolveProjectUrls(item).liveUrl}
                  onChange={(e) => updateProjectUrls(item.id, { liveUrl: e.target.value })}
                  placeholder="https://your-live-app.com"
                  className="h-10"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label className="text-sm font-medium">Repo URL</Label>
                <Input
                  value={resolveProjectUrls(item).repoUrl}
                  onChange={(e) => updateProjectUrls(item.id, { repoUrl: e.target.value })}
                  placeholder="https://github.com/owner/repo"
                  className="h-10"
                />
              </div>
            </div>

            <div className="flex flex-1 flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Description</Label>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleOpenRewrite(item.id, item.description)}
                  disabled={!item.description}
                  className="h-8 gap-1.5 text-xs"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Copilot</span>
                </Button>
              </div>
              <Textarea
                value={item.description}
                onChange={(e) => updateProject(item.id, { description: e.target.value })}
                placeholder="Describe the project, your role, technologies used, and key achievements..."
                className="min-h-[150px] flex-1 resize-y"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label className="text-sm font-medium">Technologies</Label>
              <Input
                value={item.technologies.join(', ')}
                onChange={(e) => updateProject(item.id, { technologies: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                placeholder="React, Node.js, TypeScript"
                className="h-10"
              />
              <p className="text-xs text-muted-foreground">Separate technologies with commas</p>
            </div>
          </div>
        ))}

        {projects.length === 0 && (
          <div className="py-12 text-center text-muted-foreground">
            <p className="text-sm">No projects added yet.</p>
            <p className="mt-1 text-xs">
              Add manually, or use the suggested projects above once a job description is set.
            </p>
          </div>
        )}
      </CardContent>

      <AIRewriteModal
        open={rewriteModalOpen}
        onOpenChange={setRewriteModalOpen}
        originalText={currentRewriteText}
        onAccept={handleAcceptRewrite}
        type="project"
        mode="quick"
        jobDescription={jobDescription}
      />
    </Card>
  );
}
