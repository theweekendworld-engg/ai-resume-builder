'use client';

import { useState } from 'react';
import { calculateATSScore } from '@/actions/ai';
import { useResumeStore } from '@/store/resumeStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Target, Loader2, AlertCircle } from 'lucide-react';

export function ATSScorePanel() {
  const { resumeData, jobDescription, atsScore, setAtsScore } = useResumeStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRefresh = async () => {
    if (!jobDescription.trim()) {
      setError('Add a job description in Job Target before scoring.');
      return;
    }

    setError(null);
    setIsLoading(true);
    try {
      const score = await calculateATSScore(resumeData, jobDescription);
      setAtsScore(score);
    } catch {
      setError('Unable to calculate ATS score right now.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5 text-primary" /> ATS Score
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={handleRefresh} disabled={isLoading}>
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Recalculate score'}
        </Button>

        {!jobDescription.trim() && (
          <p className="rounded-lg border border-border bg-secondary/40 p-3 text-sm text-muted-foreground">
            No job description yet. Open Job Target to paste one.
          </p>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4" />
            <p>{error}</p>
          </div>
        )}

        {atsScore && (
          <div className="space-y-4 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Overall</p>
              <p className="text-2xl font-semibold">{atsScore.overall}%</p>
            </div>
            <div className="space-y-2 text-sm">
              <p>Keyword match: {atsScore.breakdown.keywordMatch}%</p>
              <p>Skills match: {atsScore.breakdown.skillsMatch}%</p>
              <p>Experience relevance: {atsScore.breakdown.experienceRelevance}%</p>
            </div>
            {atsScore.suggestions.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {atsScore.suggestions.slice(0, 5).map((suggestion, idx) => (
                  <li key={idx}>{suggestion}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
