'use client';

import Link from 'next/link';
import { ArrowLeft, Download, Loader2 } from 'lucide-react';
import { UserButton } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SyncStatus } from '@/store/resumeStore';

interface EditorHeaderProps {
  title: string;
  onTitleChange: (title: string) => void;
  onExport: () => void;
  exporting: boolean;
  syncStatus: SyncStatus;
  lastSyncedAt: Date | null;
}

function formatLastSynced(date: Date | null): string {
  if (!date) return 'Not synced yet';
  return `Synced ${new Date(date).toLocaleTimeString()}`;
}

export function EditorHeader({ title, onTitleChange, onExport, exporting, syncStatus, lastSyncedAt }: EditorHeaderProps) {
  return (
    <header className="flex h-14 items-center justify-between gap-3 border-b border-border px-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-2">
        <Link href="/dashboard" className="shrink-0">
          <Button variant="ghost" size="icon" aria-label="Back to dashboard">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <Input
          aria-label="Resume title"
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          className="h-9 w-[220px] max-w-full"
          placeholder="Untitled Resume"
        />
      </div>

      <div className="flex items-center gap-2">
        <span className="hidden text-xs text-muted-foreground md:inline">
          {syncStatus === 'syncing' ? 'Saving...' : syncStatus === 'error' ? 'Save failed' : formatLastSynced(lastSyncedAt)}
        </span>
        <Button onClick={onExport} disabled={exporting} size="sm">
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Export
        </Button>
        <UserButton />
      </div>
    </header>
  );
}
