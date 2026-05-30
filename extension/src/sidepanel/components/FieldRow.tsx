import { useState } from 'react';
import { ChevronDown, ChevronRight, Check, X, Info } from 'lucide-react';
import { cn } from '@/shared/ui/cn';
import type { FillActionInWire } from '@/shared/types/messages';

const BAND_CHIP = {
    high: 'border-success/40 bg-success/10 text-success',
    medium: 'border-warning/40 bg-warning/10 text-warning',
    low: 'border-destructive/40 bg-destructive/10 text-destructive',
} as const;

export function FieldRow({
    action,
    onFill,
    onSkip,
    filled,
}: {
    action: FillActionInWire;
    onFill: () => void;
    onSkip?: () => void;
    filled: boolean;
}) {
    const [expanded, setExpanded] = useState(false);
    const canFill = action.canApply && action.action !== 'skip' && !filled;
    const isUpload = action.action === 'manual_upload';

    return (
        <div className="card overflow-hidden">
            <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="flex w-full items-start gap-2 p-2 text-left"
            >
                <span className="mt-0.5 text-muted-foreground">
                    {expanded ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                    )}
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-medium">{action.fieldLabel}</span>
                        <span className={cn('chip', BAND_CHIP[action.confidenceBand])}>
                            {action.confidenceBand}
                        </span>
                        {filled ? (
                            <span className="chip border-success/40 bg-success/10 text-success">
                                Filled
                            </span>
                        ) : null}
                    </div>
                    {action.valuePreview ? (
                        <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                            {action.valuePreview}
                        </div>
                    ) : (
                        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {isUpload ? 'Resume upload — opens picker' : 'No saved value'}
                        </div>
                    )}
                </div>
            </button>

            {expanded ? (
                <div className="border-t border-border bg-muted/30 p-2 text-[11px]">
                    <div className="flex items-start gap-1.5">
                        <Info className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                        <p className="text-muted-foreground">{action.reason}</p>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 text-muted-foreground">
                        <span className="chip border-border bg-bg uppercase tracking-wide">
                            {action.inputType}
                        </span>
                        {action.fieldKey ? (
                            <span className="chip border-border bg-bg">{action.fieldKey}</span>
                        ) : null}
                        <span className="text-[10px]">{action.source.label}</span>
                    </div>
                    <div className="mt-2 flex gap-2">
                        <button
                            type="button"
                            onClick={onFill}
                            disabled={!canFill}
                            className="btn-primary text-[11px]"
                        >
                            <Check className="h-3 w-3" />
                            {isUpload ? 'Open picker' : 'Fill this'}
                        </button>
                        {onSkip ? (
                            <button type="button" onClick={onSkip} className="btn-ghost text-[11px]">
                                <X className="h-3 w-3" />
                                Skip
                            </button>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </div>
    );
}
