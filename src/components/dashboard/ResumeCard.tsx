'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { MoreHorizontal, Copy, Trash2, Pencil } from 'lucide-react';
import { duplicateResume, deleteResumeFromCloud } from '@/actions/resume';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';

interface ResumeCardProps {
  resume: {
    id: string;
    title: string;
    updatedAt: Date;
    targetRole: string | null;
    targetCompany: string | null;
    atsScore: number | null;
    atsSummary: string | null;
  };
}

export function ResumeCard({ resume }: ResumeCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleDuplicate = () => {
    startTransition(async () => {
      const result = await duplicateResume(resume.id);
      if (!result.success) {
        toast.error(result.error ?? 'Failed to duplicate resume');
        return;
      }
      toast.success('Resume duplicated');
      router.refresh();
    });
  };

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deleteResumeFromCloud(resume.id);
      if (!result.success) {
        toast.error(result.error ?? 'Failed to delete resume');
        return;
      }
      toast.success('Resume deleted');
      router.refresh();
    });
  };

  return (
    <article className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="line-clamp-1 text-base font-semibold">{resume.title || 'Untitled Resume'}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Updated{' '}
            {new Date(resume.updatedAt).toLocaleString('en-US', {
              year: 'numeric',
              month: 'numeric',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
            })}
          </p>
          {(resume.targetRole || resume.targetCompany) && (
            <p className="mt-2 text-sm text-foreground">
              {resume.targetRole ?? 'Role'}{resume.targetCompany ? ` @ ${resume.targetCompany}` : ''}
            </p>
          )}
          {typeof resume.atsScore === 'number' && (
            <p className="mt-1 text-xs text-muted-foreground">ATS score: {resume.atsScore}%</p>
          )}
          {resume.atsSummary && (
            <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{resume.atsSummary}</p>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/editor/${resume.id}`} className="cursor-pointer">
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleDuplicate} disabled={isPending}>
              <Copy className="mr-2 h-4 w-4" />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleDelete} disabled={isPending}>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-5">
        <Link href={`/editor/${resume.id}`}>
          <Button size="sm" className="w-full">Open Editor</Button>
        </Link>
      </div>
    </article>
  );
}
