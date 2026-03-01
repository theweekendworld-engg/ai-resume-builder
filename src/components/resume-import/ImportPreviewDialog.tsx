'use client';

import { useState, useTransition } from 'react';
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
import { Loader2, User, Briefcase, GraduationCap, FolderGit2, Trophy } from 'lucide-react';
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

const defaultImportOptions: ImportOptions = {
  mergeProfile: true,
  sections: {
    experience: true,
    education: true,
    projects: true,
    achievements: true,
  },
};

function SectionRow({
  icon: Icon,
  label,
  count,
  checked,
  onChange,
  disabled,
}: {
  icon: React.ElementType;
  label: string;
  count: number;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <Checkbox
        id={label}
        checked={checked}
        onCheckedChange={(v) => onChange(Boolean(v))}
        disabled={disabled || count === 0}
      />
      <label
        htmlFor={label}
        className={`flex flex-1 cursor-pointer items-center gap-2 text-sm ${count === 0 ? 'text-muted-foreground' : ''}`}
      >
        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
        {label}
      </label>
      <Badge variant={count > 0 ? 'secondary' : 'outline'} className="text-xs">
        {count}
      </Badge>
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
  const [options, setOptions] = useState<ImportOptions>({
    ...defaultImportOptions,
    ...defaultOptions,
    sections: {
      ...defaultImportOptions.sections,
      ...defaultOptions?.sections,
    },
  });
  const [isPending, startTransition] = useTransition();

  const totalItems =
    (options.mergeProfile ? 1 : 0) +
    (options.sections.experience ? data.experiences.length : 0) +
    (options.sections.education ? data.education.length : 0) +
    (options.sections.projects ? data.projects.length : 0) +
    (options.sections.achievements ? data.achievements.length : 0);

  const hasContent =
    data.personalInfo.fullName ||
    data.experiences.length > 0 ||
    data.education.length > 0 ||
    data.projects.length > 0 ||
    data.achievements.length > 0;

  const handleImport = () => {
    const toastId = 'resume-import-progress';
    toast.loading('Importing your resume data…', { id: toastId });

    startTransition(async () => {
      const result = await importParsedResumeData(data, options);
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
      onClose();
    });
  };

  const profileHasData =
    data.personalInfo.fullName ||
    data.personalInfo.email ||
    data.personalInfo.phone ||
    data.personalInfo.linkedin ||
    data.personalInfo.github ||
    data.personalInfo.summary;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !isPending && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Review parsed resume</DialogTitle>
          <DialogDescription>
            Choose which sections to import into your profile.
          </DialogDescription>
        </DialogHeader>

        {!hasContent ? (
          <p className="py-4 text-sm text-muted-foreground text-center">
            No data could be extracted from this resume.
          </p>
        ) : (
          <div className="divide-y divide-border rounded-lg border px-4">
            <SectionRow
              icon={User}
              label="Profile info"
              count={profileHasData ? 1 : 0}
              checked={options.mergeProfile}
              onChange={(v) => setOptions((o) => ({ ...o, mergeProfile: v }))}
              disabled={isPending}
            />
            <SectionRow
              icon={Briefcase}
              label="Work experience"
              count={data.experiences.length}
              checked={options.sections.experience}
              onChange={(v) => setOptions((o) => ({ ...o, sections: { ...o.sections, experience: v } }))}
              disabled={isPending}
            />
            <SectionRow
              icon={GraduationCap}
              label="Education"
              count={data.education.length}
              checked={options.sections.education}
              onChange={(v) => setOptions((o) => ({ ...o, sections: { ...o.sections, education: v } }))}
              disabled={isPending}
            />
            <SectionRow
              icon={FolderGit2}
              label="Projects"
              count={data.projects.length}
              checked={options.sections.projects}
              onChange={(v) => setOptions((o) => ({ ...o, sections: { ...o.sections, projects: v } }))}
              disabled={isPending}
            />
            <SectionRow
              icon={Trophy}
              label="Achievements & certifications"
              count={data.achievements.length}
              checked={options.sections.achievements}
              onChange={(v) =>
                setOptions((o) => ({ ...o, sections: { ...o.sections, achievements: v } }))
              }
              disabled={isPending}
            />
          </div>
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
