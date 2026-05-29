'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DiffPreview } from '@/components/editor/DiffPreview';
import { improveText } from '@/actions/ai';
import { Loader2, Sparkles, Check, X } from 'lucide-react';
import { toast } from 'sonner';

interface InlineBulletSuggestionsProps {
    /** The full description string (bullets separated by newlines). */
    description: string;
    /** Persist the updated description back to the store. */
    onChange: (next: string) => void;
    type: 'bullet' | 'project';
}

interface Bullet {
    raw: string; // original line including any leading marker
    text: string; // cleaned text used for the AI call
    index: number;
}

const BULLET_PREFIX = /^\s*[•\-*]\s*/;

function splitBullets(description: string): Bullet[] {
    return description
        .split(/\r?\n/)
        .map((raw, index) => ({ raw, text: raw.replace(BULLET_PREFIX, '').trim(), index }))
        .filter((bullet) => bullet.text.length > 0);
}

/**
 * Surfaces a "strengthen" affordance directly on each bullet. One click calls
 * the existing `improveText` action, then shows a before/after diff inline so
 * the user can accept or dismiss — trust comes from seeing the change first.
 */
export function InlineBulletSuggestions({ description, onChange, type }: InlineBulletSuggestionsProps) {
    const bullets = useMemo(() => splitBullets(description), [description]);
    const [loadingIndex, setLoadingIndex] = useState<number | null>(null);
    const [pending, setPending] = useState<{ index: number; before: string; after: string } | null>(null);

    if (bullets.length === 0) {
        return (
            <p className="text-xs text-muted-foreground">
                Add a bullet above to get one-click &quot;strengthen this bullet&quot; suggestions.
            </p>
        );
    }

    const handleStrengthen = async (bullet: Bullet) => {
        setLoadingIndex(bullet.index);
        setPending(null);
        try {
            const improved = await improveText(bullet.text, type === 'project' ? 'project' : 'bullet');
            setPending({ index: bullet.index, before: bullet.text, after: improved.replace(BULLET_PREFIX, '').trim() });
        } catch {
            toast.error('Could not strengthen this bullet. Try again.');
        } finally {
            setLoadingIndex(null);
        }
    };

    const handleAccept = () => {
        if (!pending) return;
        const lines = description.split(/\r?\n/);
        // Map the cleaned-bullet index back to the actual line index.
        let seen = -1;
        const updated = lines.map((line) => {
            const cleaned = line.replace(BULLET_PREFIX, '').trim();
            if (!cleaned) return line;
            seen += 1;
            if (seen === pending.index) {
                const marker = BULLET_PREFIX.test(line) ? line.match(BULLET_PREFIX)?.[0] ?? '• ' : '';
                return `${marker}${pending.after}`;
            }
            return line;
        });
        onChange(updated.join('\n'));
        setPending(null);
        toast.success('Bullet strengthened.');
    };

    return (
        <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Strengthen bullets
            </p>
            <div className="space-y-2">
                {bullets.map((bullet) => {
                    const showingDiff = pending?.index === bullet.index;
                    return (
                        <div key={bullet.index} className="rounded-md border border-border bg-card/40 p-2">
                            <div className="flex items-start justify-between gap-2">
                                <p className="min-w-0 flex-1 text-xs text-muted-foreground">{bullet.text}</p>
                                {!showingDiff && (
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 shrink-0 gap-1 px-2 text-xs"
                                        onClick={() => handleStrengthen(bullet)}
                                        disabled={loadingIndex === bullet.index}
                                    >
                                        {loadingIndex === bullet.index ? (
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                            <Sparkles className="h-3.5 w-3.5" />
                                        )}
                                        Strengthen
                                    </Button>
                                )}
                            </div>
                            {showingDiff && pending && (
                                <div className="mt-2 space-y-2">
                                    <DiffPreview before={pending.before} after={pending.after} />
                                    <div className="flex gap-2">
                                        <Button type="button" size="sm" className="h-7 gap-1 text-xs" onClick={handleAccept}>
                                            <Check className="h-3.5 w-3.5" />
                                            Accept
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            className="h-7 gap-1 text-xs"
                                            onClick={() => setPending(null)}
                                        >
                                            <X className="h-3.5 w-3.5" />
                                            Dismiss
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
