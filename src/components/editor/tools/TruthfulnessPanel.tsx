'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GROUND_STATE, type GroundStateValue } from '@/lib/groundState';
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  confirmResumeClaim,
  getResumeClaimGroundings,
  type ClaimChip,
} from '@/actions/claimGrounding';

const STATE_STYLES: Record<GroundStateValue, { label: string; className: string; icon: React.ReactNode }> = {
  [GROUND_STATE.grounded]: {
    label: 'Grounded',
    className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
  },
  [GROUND_STATE.needs_confirmation]: {
    label: 'Needs confirmation',
    className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
  },
  [GROUND_STATE.unsupported]: {
    label: 'Unsupported',
    className: 'bg-destructive/15 text-destructive border-destructive/30',
    icon: <XCircle className="h-3.5 w-3.5" />,
  },
};

const STATE_ORDER: Record<GroundStateValue, number> = {
  [GROUND_STATE.unsupported]: 0,
  [GROUND_STATE.needs_confirmation]: 1,
  [GROUND_STATE.grounded]: 2,
};

export function TruthfulnessPanel({ resumeId }: { resumeId: string }) {
  const [chips, setChips] = useState<ClaimChip[]>([]);
  const [counts, setCounts] = useState<Record<GroundStateValue, number>>({
    [GROUND_STATE.grounded]: 0,
    [GROUND_STATE.needs_confirmation]: 0,
    [GROUND_STATE.unsupported]: 0,
  });
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getResumeClaimGroundings(resumeId);
      if (result.success) {
        setChips(result.chips);
        setCounts(result.counts);
      }
    } finally {
      setLoading(false);
    }
  }, [resumeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(
    () => [...chips].sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.claim.localeCompare(b.claim)),
    [chips]
  );

  const total = chips.length;

  const handleConfirm = async (claim: string) => {
    setConfirming(claim);
    try {
      const result = await confirmResumeClaim(resumeId, claim);
      if (result.success && result.state) {
        setChips((prev) =>
          prev.map((c) => (c.claim === claim ? { ...c, state: result.state!, confirmedByUser: true } : c))
        );
        setCounts((prev) => ({
          ...prev,
          [GROUND_STATE.needs_confirmation]: Math.max(0, prev[GROUND_STATE.needs_confirmation] - 1),
          [GROUND_STATE.grounded]: prev[GROUND_STATE.grounded] + 1,
        }));
        toast.success('Claim confirmed — added to your evidence graph.');
      } else {
        toast.error(result.error || 'Could not confirm claim.');
      }
    } finally {
      setConfirming(null);
    }
  };

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          Truthfulness
        </CardTitle>
        <CardDescription>
          Every claim traced to your source material. Confirm a flagged claim to lock it in — no unverified
          number ever prints on your resume.
        </CardDescription>
        {total > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {(Object.keys(STATE_STYLES) as GroundStateValue[]).map((state) => (
              <Badge key={state} variant="outline" className={cn('gap-1 text-[11px]', STATE_STYLES[state].className)}>
                {STATE_STYLES[state].icon}
                {counts[state]} {STATE_STYLES[state].label.toLowerCase()}
              </Badge>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking claims…
          </div>
        ) : total === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Truthfulness chips appear here after you generate a tailored resume. Each bullet gets traced back to
            your experience, projects, and knowledge base.
          </div>
        ) : (
          sorted.map((chip) => {
            const style = STATE_STYLES[chip.state];
            const canConfirm = chip.state === GROUND_STATE.needs_confirmation;
            return (
              <div key={chip.claim} className="rounded-lg border border-border bg-card/50 p-3">
                <div className="flex items-start gap-2">
                  <Badge variant="outline" className={cn('shrink-0 gap-1 text-[10px]', style.className)}>
                    {style.icon}
                    {style.label}
                  </Badge>
                  <p className="min-w-0 flex-1 text-xs text-foreground">{chip.claim}</p>
                </div>
                {canConfirm && (
                  <div className="mt-2 flex justify-end">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7 gap-1.5 text-xs"
                      disabled={confirming === chip.claim}
                      onClick={() => handleConfirm(chip.claim)}
                    >
                      {confirming === chip.claim ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                      Confirm this is true
                    </Button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
