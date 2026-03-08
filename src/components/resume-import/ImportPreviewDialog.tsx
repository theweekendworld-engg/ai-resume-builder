'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Loader2,
  User,
  Briefcase,
  GraduationCap,
  FolderGit2,
  Trophy,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { importParsedResumeData, type ImportOptions, type ImportSummary } from '@/actions/resumeImport';
import type { ParsedResumeData } from '@/lib/aiSchemas';

type Props = {
  data: ParsedResumeData;
  open: boolean;
  onClose: () => void;
  onImported?: (summary: ImportSummary) => void;
  defaultOptions?: Partial<ImportOptions>;
};

type SectionKey = 'profile' | 'experience' | 'education' | 'projects' | 'achievements';

const defaultImportOptions: ImportOptions = {
  mergeProfile: true,
  sections: {
    experience: true,
    education: true,
    projects: true,
    achievements: true,
  },
};

function SectionCard({
  icon: Icon,
  label,
  count,
  checked,
  onChange,
  expanded,
  onToggle,
  disabled,
  children,
}: {
  icon: React.ElementType;
  label: string;
  count: number;
  checked: boolean;
  onChange: (v: boolean) => void;
  expanded: boolean;
  onToggle: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/80 bg-background/40">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <Checkbox checked={checked} onCheckedChange={(v) => onChange(Boolean(v))} disabled={disabled || count === 0} />
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <button
          type="button"
          onClick={onToggle}
          className="flex flex-1 items-center justify-between text-left text-sm"
          disabled={count === 0}
        >
          <span className={count === 0 ? 'text-muted-foreground' : ''}>{label}</span>
          <span className="flex items-center gap-2">
            <Badge variant={count > 0 ? 'secondary' : 'outline'} className="text-xs">
              {count}
            </Badge>
            {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </span>
        </button>
      </div>

      {expanded && <div className="border-t border-border/70 p-3">{children}</div>}
    </div>
  );
}

function buildSummaryMessage(summary: ImportSummary): string {
  const parts: string[] = [];
  if (summary.profile === 'updated') parts.push('profile updated');

  const sections: [keyof Omit<ImportSummary, 'profile' | 'warnings'>, string][] = [
    ['experience', 'experience'],
    ['education', 'education'],
    ['projects', 'projects'],
    ['achievements', 'achievements'],
  ];

  for (const [key, label] of sections) {
    const s = summary[key] as { created: number; skipped: number };
    if (s.created > 0) parts.push(`${s.created} ${label}`);
  }

  const total = sections.reduce((acc, [key]) => acc + (summary[key] as { created: number }).created, 0);
  if (summary.profile === 'updated' && total === 0) return 'Profile updated from resume.';
  if (total === 0 && summary.profile === 'skipped') return 'Nothing new to import — all items already exist.';
  return `Imported: ${parts.join(', ')}.`;
}

export function ImportPreviewDialog({ data, open, onClose, onImported, defaultOptions }: Props) {
  const router = useRouter();
  const [editableData, setEditableData] = useState<ParsedResumeData>(data);
  const [options, setOptions] = useState<ImportOptions>({
    ...defaultImportOptions,
    ...defaultOptions,
    sections: {
      ...defaultImportOptions.sections,
      ...defaultOptions?.sections,
    },
  });
  const [expanded, setExpanded] = useState<Record<SectionKey, boolean>>({
    profile: true,
    experience: false,
    education: false,
    projects: false,
    achievements: false,
  });
  const [isPending, startTransition] = useTransition();

  const totalItems =
    (options.mergeProfile ? 1 : 0) +
    (options.sections.experience ? editableData.experiences.length : 0) +
    (options.sections.education ? editableData.education.length : 0) +
    (options.sections.projects ? editableData.projects.length : 0) +
    (options.sections.achievements ? editableData.achievements.length : 0);

  const hasContent =
    editableData.personalInfo.fullName ||
    editableData.experiences.length > 0 ||
    editableData.education.length > 0 ||
    editableData.projects.length > 0 ||
    editableData.achievements.length > 0;

  const handleImport = () => {
    const toastId = 'resume-import-progress';
    toast.loading('Importing your resume data…', { id: toastId });

    startTransition(async () => {
      const result = await importParsedResumeData(editableData, options);
      toast.dismiss(toastId);

      if (!result.success) {
        toast.error(result.error ?? 'Import failed');
        return;
      }

      const summary = result.summary!;
      const message = buildSummaryMessage(summary);
      toast.success(message);

      if (summary.warnings.length > 0) {
        for (const w of summary.warnings.slice(0, 3)) {
          toast.warning(w, { duration: 5000 });
        }
      }

      onImported?.(summary);
      router.refresh();
      onClose();
    });
  };

  const profileHasData =
    editableData.personalInfo.fullName ||
    editableData.personalInfo.email ||
    editableData.personalInfo.phone ||
    editableData.personalInfo.linkedin ||
    editableData.personalInfo.github ||
    editableData.personalInfo.summary;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !isPending && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Review parsed resume</DialogTitle>
          <DialogDescription>
            Expand sections to verify and edit before importing.
          </DialogDescription>
        </DialogHeader>

        {!hasContent ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No data could be extracted from this resume.
          </p>
        ) : (
          <ScrollArea className="max-h-[65vh] pr-2">
            <div className="space-y-3">
              <SectionCard
                icon={User}
                label="Profile info"
                count={profileHasData ? 1 : 0}
                checked={options.mergeProfile}
                onChange={(v) => setOptions((o) => ({ ...o, mergeProfile: v }))}
                expanded={expanded.profile}
                onToggle={() => setExpanded((s) => ({ ...s, profile: !s.profile }))}
                disabled={isPending}
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    placeholder="Full name"
                    value={editableData.personalInfo.fullName}
                    onChange={(e) =>
                      setEditableData((d) => ({
                        ...d,
                        personalInfo: { ...d.personalInfo, fullName: e.target.value },
                      }))
                    }
                    disabled={isPending}
                  />
                  <Input
                    placeholder="Title"
                    value={editableData.personalInfo.title}
                    onChange={(e) =>
                      setEditableData((d) => ({
                        ...d,
                        personalInfo: { ...d.personalInfo, title: e.target.value },
                      }))
                    }
                    disabled={isPending}
                  />
                  <Input
                    placeholder="Email"
                    value={editableData.personalInfo.email}
                    onChange={(e) =>
                      setEditableData((d) => ({
                        ...d,
                        personalInfo: { ...d.personalInfo, email: e.target.value },
                      }))
                    }
                    disabled={isPending}
                  />
                  <Input
                    placeholder="Phone"
                    value={editableData.personalInfo.phone}
                    onChange={(e) =>
                      setEditableData((d) => ({
                        ...d,
                        personalInfo: { ...d.personalInfo, phone: e.target.value },
                      }))
                    }
                    disabled={isPending}
                  />
                  <Input
                    placeholder="Location"
                    value={editableData.personalInfo.location}
                    onChange={(e) =>
                      setEditableData((d) => ({
                        ...d,
                        personalInfo: { ...d.personalInfo, location: e.target.value },
                      }))
                    }
                    disabled={isPending}
                  />
                  <Input
                    placeholder="Website"
                    value={editableData.personalInfo.website}
                    onChange={(e) =>
                      setEditableData((d) => ({
                        ...d,
                        personalInfo: { ...d.personalInfo, website: e.target.value },
                      }))
                    }
                    disabled={isPending}
                  />
                  <Input
                    placeholder="LinkedIn"
                    value={editableData.personalInfo.linkedin}
                    onChange={(e) =>
                      setEditableData((d) => ({
                        ...d,
                        personalInfo: { ...d.personalInfo, linkedin: e.target.value },
                      }))
                    }
                    disabled={isPending}
                  />
                  <Input
                    placeholder="GitHub"
                    value={editableData.personalInfo.github}
                    onChange={(e) =>
                      setEditableData((d) => ({
                        ...d,
                        personalInfo: { ...d.personalInfo, github: e.target.value },
                      }))
                    }
                    disabled={isPending}
                  />
                </div>
                <Textarea
                  className="mt-2"
                  placeholder="Summary"
                  value={editableData.personalInfo.summary}
                  onChange={(e) =>
                    setEditableData((d) => ({
                      ...d,
                      personalInfo: { ...d.personalInfo, summary: e.target.value },
                    }))
                  }
                  rows={4}
                  disabled={isPending}
                />
              </SectionCard>

              <SectionCard
                icon={Briefcase}
                label="Work experience"
                count={editableData.experiences.length}
                checked={options.sections.experience}
                onChange={(v) => setOptions((o) => ({ ...o, sections: { ...o.sections, experience: v } }))}
                expanded={expanded.experience}
                onToggle={() => setExpanded((s) => ({ ...s, experience: !s.experience }))}
                disabled={isPending}
              >
                <div className="space-y-3">
                  {editableData.experiences.length === 0 && (
                    <p className="text-sm text-muted-foreground">No experience extracted.</p>
                  )}
                  {editableData.experiences.map((exp, index) => (
                    <div key={`exp-${index}`} className="rounded-md border p-3">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Input
                          placeholder="Role"
                          value={exp.role}
                          onChange={(e) =>
                            setEditableData((d) => ({
                              ...d,
                              experiences: d.experiences.map((item, i) =>
                                i === index ? { ...item, role: e.target.value } : item
                              ),
                            }))
                          }
                          disabled={isPending}
                        />
                        <Input
                          placeholder="Company"
                          value={exp.company}
                          onChange={(e) =>
                            setEditableData((d) => ({
                              ...d,
                              experiences: d.experiences.map((item, i) =>
                                i === index ? { ...item, company: e.target.value } : item
                              ),
                            }))
                          }
                          disabled={isPending}
                        />
                        <Input
                          placeholder="Start date"
                          value={exp.startDate}
                          onChange={(e) =>
                            setEditableData((d) => ({
                              ...d,
                              experiences: d.experiences.map((item, i) =>
                                i === index ? { ...item, startDate: e.target.value } : item
                              ),
                            }))
                          }
                          disabled={isPending}
                        />
                        <Input
                          placeholder="End date"
                          value={exp.endDate}
                          onChange={(e) =>
                            setEditableData((d) => ({
                              ...d,
                              experiences: d.experiences.map((item, i) =>
                                i === index ? { ...item, endDate: e.target.value } : item
                              ),
                            }))
                          }
                          disabled={isPending}
                        />
                        <Input
                          placeholder="Location"
                          value={exp.location}
                          onChange={(e) =>
                            setEditableData((d) => ({
                              ...d,
                              experiences: d.experiences.map((item, i) =>
                                i === index ? { ...item, location: e.target.value } : item
                              ),
                            }))
                          }
                          disabled={isPending}
                        />
                        <label className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Checkbox
                            checked={exp.current}
                            onCheckedChange={(v) =>
                              setEditableData((d) => ({
                                ...d,
                                experiences: d.experiences.map((item, i) =>
                                  i === index ? { ...item, current: Boolean(v) } : item
                                ),
                              }))
                            }
                            disabled={isPending}
                          />
                          Current role
                        </label>
                      </div>
                      <p className="mt-2 text-xs font-medium text-muted-foreground">Description</p>
                      <Textarea
                        className="mt-1"
                        placeholder="Description"
                        value={exp.description}
                        onChange={(e) =>
                          setEditableData((d) => ({
                            ...d,
                            experiences: d.experiences.map((item, i) =>
                              i === index ? { ...item, description: e.target.value } : item
                            ),
                          }))
                        }
                        rows={3}
                        disabled={isPending}
                      />
                      <p className="mt-2 text-xs font-medium text-muted-foreground">Highlights</p>
                      <Textarea
                        className="mt-1"
                        placeholder="Highlights (one per line)"
                        value={exp.highlights.join('\n')}
                        onChange={(e) =>
                          setEditableData((d) => ({
                            ...d,
                            experiences: d.experiences.map((item, i) =>
                              i === index
                                ? {
                                    ...item,
                                    highlights: e.target.value
                                      .split('\n')
                                      .map((line) => line.trim())
                                      .filter(Boolean),
                                  }
                                : item
                            ),
                          }))
                        }
                        rows={3}
                        disabled={isPending}
                      />
                    </div>
                  ))}
                </div>
              </SectionCard>

              <SectionCard
                icon={GraduationCap}
                label="Education"
                count={editableData.education.length}
                checked={options.sections.education}
                onChange={(v) => setOptions((o) => ({ ...o, sections: { ...o.sections, education: v } }))}
                expanded={expanded.education}
                onToggle={() => setExpanded((s) => ({ ...s, education: !s.education }))}
                disabled={isPending}
              >
                <div className="space-y-3">
                  {editableData.education.length === 0 && (
                    <p className="text-sm text-muted-foreground">No education extracted.</p>
                  )}
                  {editableData.education.map((edu, index) => (
                    <div key={`edu-${index}`} className="rounded-md border p-3">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Input
                          placeholder="Institution"
                          value={edu.institution}
                          onChange={(e) =>
                            setEditableData((d) => ({
                              ...d,
                              education: d.education.map((item, i) =>
                                i === index ? { ...item, institution: e.target.value } : item
                              ),
                            }))
                          }
                          disabled={isPending}
                        />
                        <Input
                          placeholder="Degree"
                          value={edu.degree}
                          onChange={(e) =>
                            setEditableData((d) => ({
                              ...d,
                              education: d.education.map((item, i) =>
                                i === index ? { ...item, degree: e.target.value } : item
                              ),
                            }))
                          }
                          disabled={isPending}
                        />
                        <Input
                          placeholder="Field of study"
                          value={edu.fieldOfStudy}
                          onChange={(e) =>
                            setEditableData((d) => ({
                              ...d,
                              education: d.education.map((item, i) =>
                                i === index ? { ...item, fieldOfStudy: e.target.value } : item
                              ),
                            }))
                          }
                          disabled={isPending}
                        />
                        <label className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Checkbox
                            checked={edu.current}
                            onCheckedChange={(v) =>
                              setEditableData((d) => ({
                                ...d,
                                education: d.education.map((item, i) =>
                                  i === index ? { ...item, current: Boolean(v) } : item
                                ),
                              }))
                            }
                            disabled={isPending}
                          />
                          Currently studying
                        </label>
                        <Input
                          placeholder="Start date"
                          value={edu.startDate}
                          onChange={(e) =>
                            setEditableData((d) => ({
                              ...d,
                              education: d.education.map((item, i) =>
                                i === index ? { ...item, startDate: e.target.value } : item
                              ),
                            }))
                          }
                          disabled={isPending}
                        />
                        <Input
                          placeholder="End date"
                          value={edu.endDate}
                          onChange={(e) =>
                            setEditableData((d) => ({
                              ...d,
                              education: d.education.map((item, i) =>
                                i === index ? { ...item, endDate: e.target.value } : item
                              ),
                            }))
                          }
                          disabled={isPending}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>

              <SectionCard
                icon={FolderGit2}
                label="Projects"
                count={editableData.projects.length}
                checked={options.sections.projects}
                onChange={(v) => setOptions((o) => ({ ...o, sections: { ...o.sections, projects: v } }))}
                expanded={expanded.projects}
                onToggle={() => setExpanded((s) => ({ ...s, projects: !s.projects }))}
                disabled={isPending}
              >
                <div className="space-y-3">
                  {editableData.projects.length === 0 && (
                    <p className="text-sm text-muted-foreground">No projects extracted.</p>
                  )}
                  {editableData.projects.map((project, index) => (
                    <div key={`project-${index}`} className="rounded-md border p-3">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Input
                          placeholder="Project name"
                          value={project.name}
                          onChange={(e) =>
                            setEditableData((d) => ({
                              ...d,
                              projects: d.projects.map((item, i) =>
                                i === index ? { ...item, name: e.target.value } : item
                              ),
                            }))
                          }
                          disabled={isPending}
                        />
                        <Input
                          placeholder="GitHub URL"
                          value={project.githubUrl ?? ''}
                          onChange={(e) =>
                            setEditableData((d) => ({
                              ...d,
                              projects: d.projects.map((item, i) =>
                                i === index ? { ...item, githubUrl: e.target.value || undefined } : item
                              ),
                            }))
                          }
                          disabled={isPending}
                        />
                        <Input
                          placeholder="Live URL"
                          value={project.liveUrl ?? ''}
                          onChange={(e) =>
                            setEditableData((d) => ({
                              ...d,
                              projects: d.projects.map((item, i) =>
                                i === index ? { ...item, liveUrl: e.target.value || undefined } : item
                              ),
                            }))
                          }
                          disabled={isPending}
                        />
                        <Input
                          placeholder="Technologies (comma-separated)"
                          value={project.technologies.join(', ')}
                          onChange={(e) =>
                            setEditableData((d) => ({
                              ...d,
                              projects: d.projects.map((item, i) =>
                                i === index
                                  ? {
                                      ...item,
                                      technologies: e.target.value
                                        .split(',')
                                        .map((tech) => tech.trim())
                                        .filter(Boolean),
                                    }
                                  : item
                              ),
                            }))
                          }
                          disabled={isPending}
                        />
                      </div>
                      <Textarea
                        className="mt-2"
                        placeholder="Description"
                        value={project.description}
                        onChange={(e) =>
                          setEditableData((d) => ({
                            ...d,
                            projects: d.projects.map((item, i) =>
                              i === index ? { ...item, description: e.target.value } : item
                            ),
                          }))
                        }
                        rows={3}
                        disabled={isPending}
                      />
                    </div>
                  ))}
                </div>
              </SectionCard>

              <SectionCard
                icon={Trophy}
                label="Achievements & certifications"
                count={editableData.achievements.length}
                checked={options.sections.achievements}
                onChange={(v) => setOptions((o) => ({ ...o, sections: { ...o.sections, achievements: v } }))}
                expanded={expanded.achievements}
                onToggle={() => setExpanded((s) => ({ ...s, achievements: !s.achievements }))}
                disabled={isPending}
              >
                <div className="space-y-3">
                  {editableData.achievements.length === 0 && (
                    <p className="text-sm text-muted-foreground">No achievements extracted.</p>
                  )}
                  {editableData.achievements.map((achievement, index) => (
                    <div key={`achievement-${index}`} className="rounded-md border p-3">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Input
                          placeholder="Title"
                          value={achievement.title}
                          onChange={(e) =>
                            setEditableData((d) => ({
                              ...d,
                              achievements: d.achievements.map((item, i) =>
                                i === index ? { ...item, title: e.target.value } : item
                              ),
                            }))
                          }
                          disabled={isPending}
                        />
                        <Input
                          placeholder="Type (achievement, certification, award...)"
                          value={achievement.type}
                          onChange={(e) =>
                            setEditableData((d) => ({
                              ...d,
                              achievements: d.achievements.map((item, i) =>
                                i === index ? { ...item, type: e.target.value as typeof item.type } : item
                              ),
                            }))
                          }
                          disabled={isPending}
                        />
                      </div>
                      <Textarea
                        className="mt-2"
                        placeholder="Description"
                        value={achievement.description}
                        onChange={(e) =>
                          setEditableData((d) => ({
                            ...d,
                            achievements: d.achievements.map((item, i) =>
                              i === index ? { ...item, description: e.target.value } : item
                            ),
                          }))
                        }
                        rows={3}
                        disabled={isPending}
                      />
                    </div>
                  ))}
                </div>
              </SectionCard>
            </div>
          </ScrollArea>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          {hasContent && (
            <Button onClick={handleImport} disabled={isPending || totalItems === 0}>
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Importing…
                </>
              ) : (
                `Import ${totalItems > 0 ? totalItems : ''} item${totalItems !== 1 ? 's' : ''}`
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
