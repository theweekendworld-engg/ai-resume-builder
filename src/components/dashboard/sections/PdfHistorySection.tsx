'use client';

import { useState, useEffect } from 'react';
import { getUserPdfHistory } from '@/actions/pdfs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { FileDown } from 'lucide-react';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PdfHistorySection() {
  const [result, setResult] = useState<Awaited<ReturnType<typeof getUserPdfHistory>> | null>(null);

  useEffect(() => {
    let cancelled = false;
    getUserPdfHistory().then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!result) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">PDF History</h1>
          <p className="text-muted-foreground">Loading PDF history...</p>
        </div>
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (!result.success) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">PDF History</h1>
        <p className="text-muted-foreground">
          {result.error ?? 'Failed to load PDF history.'}
        </p>
      </div>
    );
  }

  const items = result.items ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">PDF History</h1>
        <p className="text-muted-foreground">Download previously generated PDFs.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Generated PDFs</CardTitle>
          <CardDescription>Resume, template, date, and download link.</CardDescription>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No PDFs yet. Generate a resume and export to PDF from the editor.
            </div>
          ) : (
            <ul className="space-y-3">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
                >
                  <div>
                    <p className="font-medium">{item.resumeTitle}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.template} · {formatBytes(item.fileSizeBytes)} ·{' '}
                      {item.createdAt.toLocaleString()}
                    </p>
                  </div>
                  <a href={item.blobUrl} target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" size="sm">
                      <FileDown className="mr-2 h-4 w-4" />
                      Download
                    </Button>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
