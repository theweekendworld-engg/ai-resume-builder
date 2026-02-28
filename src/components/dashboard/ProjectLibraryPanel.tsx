'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { createUserProject, deleteUserProject } from '@/actions/projects';
import { toast } from 'sonner';

interface ProjectItem {
  id: string;
  name: string;
  description: string;
  url: string;
  githubUrl: string | null;
  technologies: string[];
  source: 'github' | 'manual';
  updatedAt: Date;
}

interface ProjectLibraryPanelProps {
  projects: ProjectItem[];
}

export function ProjectLibraryPanel({ projects }: ProjectLibraryPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState({
    name: '',
    description: '',
    url: '',
    githubUrl: '',
    technologies: '',
  });

  const addProject = () => {
    startTransition(async () => {
      const result = await createUserProject({
        name: form.name,
        description: form.description,
        url: form.url,
        githubUrl: form.githubUrl,
        technologies: form.technologies
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      });

      if (!result.success) {
        toast.error(result.error ?? 'Failed to add project');
        return;
      }

      setForm({ name: '', description: '', url: '', githubUrl: '', technologies: '' });
      toast.success('Project added');
      router.refresh();
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
      router.refresh();
    });
  };

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Project Library</h2>
        <p className="text-sm text-muted-foreground">Reusable project bank for future semantic selection.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Input placeholder="Project name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
        <Input placeholder="Project URL" value={form.url} onChange={(e) => setForm((p) => ({ ...p, url: e.target.value }))} />
        <Input placeholder="GitHub URL" value={form.githubUrl} onChange={(e) => setForm((p) => ({ ...p, githubUrl: e.target.value }))} />
        <Input
          placeholder="Technologies (comma separated)"
          value={form.technologies}
          onChange={(e) => setForm((p) => ({ ...p, technologies: e.target.value }))}
        />
      </div>

      <div className="mt-3">
        <Textarea
          placeholder="Description"
          rows={3}
          value={form.description}
          onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
        />
      </div>

      <div className="mt-4">
        <Button onClick={addProject} disabled={isPending}>Add Project</Button>
      </div>

      <div className="mt-6 space-y-3">
        {projects.map((project) => (
          <article key={project.id} className="rounded-lg border border-border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-medium">{project.name}</h3>
                {project.description && <p className="mt-1 text-sm text-muted-foreground">{project.description}</p>}
                <p className="mt-2 text-xs text-muted-foreground">
                  {project.technologies.length > 0 ? project.technologies.join(', ') : 'No technologies yet'}
                </p>
              </div>
              <Button variant="outline" size="sm" disabled={isPending} onClick={() => removeProject(project.id)}>
                Delete
              </Button>
            </div>
          </article>
        ))}

        {projects.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            No projects yet. Add your first reusable project above.
          </div>
        )}
      </div>
    </section>
  );
}
