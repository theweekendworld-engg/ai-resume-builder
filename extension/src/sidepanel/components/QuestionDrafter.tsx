import { useState } from 'react';
import { ChevronDown, ChevronRight, Sparkles, Copy, Send, Loader2 } from 'lucide-react';
import { cn } from '@/shared/ui/cn';
import { request } from '@/background/messageBus';
import { trackExtensionEvent } from '@/shared/lib/telemetry';

type Tone = 'concise' | 'balanced' | 'high_conviction';

type Draft = {
    tone: Tone;
    answer: string;
    confidence?: number;
};

const TONES: Array<{ key: Tone; label: string }> = [
    { key: 'concise', label: 'Concise' },
    { key: 'balanced', label: 'Balanced' },
    { key: 'high_conviction', label: 'High conviction' },
];

export function QuestionDrafter({
    id,
    questionText,
    typeHint,
    locator,
    expanded,
    onToggle,
}: {
    id: string;
    questionText: string;
    typeHint?: string;
    locator?: Record<string, unknown>;
    expanded: boolean;
    onToggle: () => void;
}) {
    const [tone, setTone] = useState<Tone>('balanced');
    const [drafts, setDrafts] = useState<Draft[]>([]);
    const [editText, setEditText] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [inserted, setInserted] = useState(false);

    const handleDraft = async () => {
        setLoading(true);
        setError(null);
        const startedAt = Date.now();
        const res = await request<{ drafts?: Draft[] }>({
            type: 'SUGGEST_ANSWER',
            questionId: id,
            questionText,
            tone,
            typeHint,
            locator,
        });
        setLoading(false);
        if (!res.ok) {
            setError(res.error || 'Could not draft an answer.');
            return;
        }
        const list = res.data?.drafts ?? [];
        setDrafts(list);
        const preferred = list.find((d) => d.tone === tone) ?? list[0];
        if (preferred?.answer) setEditText(preferred.answer);
        trackExtensionEvent('question.drafted', {
            typeHint,
            tone,
            durationMs: Date.now() - startedAt,
            draftCount: list.length,
        });
    };

    const handleCopy = async () => {
        if (!editText) return;
        try {
            await navigator.clipboard.writeText(editText);
        } catch {
            /* clipboard may not be available */
        }
    };

    const handleInsert = async () => {
        if (!editText || !locator) return;
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id == null) return;
        const res = await request({
            type: 'INSERT_ANSWER',
            tabId: tab.id,
            locator,
            text: editText,
        });
        if (res.ok) {
            setInserted(true);
            trackExtensionEvent('question.inserted', { typeHint, edited: true });
            window.setTimeout(() => setInserted(false), 3000);
        } else {
            setError(res.error || 'Could not insert text into the page.');
        }
    };

    return (
        <div className="card overflow-hidden">
            <button
                type="button"
                onClick={onToggle}
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
                    <div className="line-clamp-2 text-xs font-medium">{questionText}</div>
                    {typeHint ? (
                        <div className="mt-0.5 text-[11px] text-muted-foreground">{typeHint}</div>
                    ) : null}
                </div>
            </button>

            {expanded ? (
                <div className="space-y-2 border-t border-border bg-muted/30 p-2 text-xs">
                    <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-muted-foreground">Tone</span>
                        <div className="flex gap-1">
                            {TONES.map((t) => (
                                <button
                                    key={t.key}
                                    type="button"
                                    onClick={() => setTone(t.key)}
                                    className={cn(
                                        'chip text-[10px]',
                                        tone === t.key
                                            ? 'border-primary/40 bg-primary/10 text-primary'
                                            : 'border-border bg-bg text-muted-foreground'
                                    )}
                                >
                                    {t.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={handleDraft}
                        disabled={loading}
                        className="btn-primary w-full text-[11px]"
                    >
                        {loading ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                            <Sparkles className="h-3 w-3" />
                        )}
                        {drafts.length > 0 ? 'Regenerate' : 'Draft answer'}
                    </button>

                    {error ? <p className="text-[11px] text-destructive">{error}</p> : null}

                    {drafts.length > 0 ? (
                        <>
                            <textarea
                                value={editText}
                                onChange={(e) => setEditText(e.target.value)}
                                rows={6}
                                className="w-full resize-y rounded border border-border bg-bg p-2 font-mono text-[11px]"
                            />
                            <div className="flex gap-1.5">
                                <button
                                    type="button"
                                    onClick={handleInsert}
                                    disabled={!locator}
                                    className="btn-primary text-[11px]"
                                    title={!locator ? 'No insertion target' : undefined}
                                >
                                    <Send className="h-3 w-3" />
                                    {inserted ? 'Inserted' : 'Insert'}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleCopy}
                                    className="btn-outline text-[11px]"
                                >
                                    <Copy className="h-3 w-3" />
                                    Copy
                                </button>
                            </div>
                        </>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
