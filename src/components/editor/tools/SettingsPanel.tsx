'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { deleteResumeFromCloud } from '@/actions/resume';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';

interface SettingsPanelProps {
  resumeId: string;
}

export function SettingsPanel({ resumeId }: SettingsPanelProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deleteResumeFromCloud(resumeId);
      if (!result.success) {
        toast.error(result.error ?? 'Failed to delete resume');
        return;
      }
      toast.success('Resume deleted');
      router.push('/dashboard');
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">Danger zone actions for this resume.</p>
        <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
          <Trash2 className="h-4 w-4" /> Delete Resume
        </Button>
      </CardContent>
    </Card>
  );
}
