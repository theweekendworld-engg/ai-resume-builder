'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { MoreHorizontal, Copy, Trash2, Pencil } from 'lucide-react';
import { duplicateResume, deleteResumeFromCloud } from '@/actions/resume';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
  const [confirmOpen, setConfirmOpen] = useState(false);

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

  const target = [resume.targetRole, resume.targetCompany].filter(Boolean).join(' at ');

  return (
    <article className="group relative flex flex-col rounded-xl border border-border bg-card transition-colors hover:border-primary/40">
      {/* A page, not a button: the card itself opens the editor. */}
      <Link href={`/editor/${resume.id}`} className="flex flex-1 flex-col p-4 focus-visible:outline-none" aria-label={`Open ${resume.title || 'Untitled resume'}`}>
        <div aria-hidden className="mb-4 h-24 rounded-lg border border-border bg-background p-3">
          <div className="h-2 w-1/2 rounded-full bg-foreground/15" />
          <div className="mt-2 h-1.5 w-1/3 rounded-full bg-foreground/10" />
          <div className="mt-3 space-y-1.5">
            <div className="h-1.5 w-full rounded-full bg-foreground/[0.07]" />
            <div className="h-1.5 w-5/6 rounded-full bg-foreground/[0.07]" />
            <div className="h-1.5 w-4/6 rounded-full bg-foreground/[0.07]" />
          </div>
        </div>
        <h3 className="line-clamp-1 pr-8 text-sm font-semibold">{resume.title || 'Untitled resume'}</h3>
        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{target || 'Base resume'}</p>
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <span>Edited {new Date(resume.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
          {typeof resume.atsScore === 'number' && (
            <span className="rounded-full bg-secondary px-2 py-0.5 font-medium tabular-nums text-foreground">ATS {resume.atsScore}%</span>
          )}
        </div>
      </Link>

      <div className="absolute right-2 top-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 bg-card/80" aria-label="Resume actions">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/editor/${resume.id}`} className="cursor-pointer">
                <Pencil className="mr-2 size-4" />
                Edit
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleDuplicate} disabled={isPending}>
              <Copy className="mr-2 size-4" />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setConfirmOpen(true)} disabled={isPending} className="text-destructive focus:text-destructive">
              <Trash2 className="mr-2 size-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Delete used to fire from the menu with no second step. */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this resume?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{resume.title || 'Untitled resume'}&rdquo; is removed. Your Work Log and history are not touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}
