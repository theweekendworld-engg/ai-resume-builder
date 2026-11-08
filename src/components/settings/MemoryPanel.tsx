'use client';

import * as React from 'react';
import { Brain, Loader2, Lock, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/patterns/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { deleteMemory, updateMemory } from '@/actions/memory';
import { MEMORY_TEXT_MAX, shortDate } from '@/lib/memory/format';

/** What the panel needs of a memory; `MemoryView` from the service. */
export type MemoryItem = {
    id: string;
    key: string;
    label: string;
    text: string;
    source: 'clarification_answer' | 'chat' | 'scout_answer' | 'consolidation' | 'user_edit';
    sensitivity: 'shareable' | 'private';
    useCount: number;
    createdAt: string;
};

const SOURCE_LABEL: Record<MemoryItem['source'], string> = {
    clarification_answer: 'From a resume question',
    scout_answer: 'From a job question',
    chat: 'From chat',
    consolidation: 'Tidied weekly',
    user_edit: 'Edited by you',
};

const GROUPS: Array<{ kind: string; title: string; description: string }> = [
    { kind: 'skill', title: 'Experience', description: 'Answers about your skills and work. Used in place of asking when a posting needs them.' },
    { kind: 'pref', title: 'What you are looking for', description: 'From the questions Scout asked about jobs.' },
    { kind: 'fact', title: 'Facts', description: 'Things about you that rarely change.' },
];

function kindOf(key: string): string {
    const kind = key.split(':')[0];
    return kind === 'pref' || kind === 'fact' ? kind : 'skill';
}

/**
 * Settings → Memory: everything Patronus remembers you told it, editable.
 *
 * Every row can be edited, made private, or deleted. Deleting is a soft
 * delete on the server (history is kept for the audit trail) but it is gone
 * from every prompt at once, and the question may be asked again.
 */
export function MemoryPanel({ initial }: { initial: MemoryItem[] }) {
    const [items, setItems] = React.useState<MemoryItem[]>(initial);

    if (items.length === 0) {
        return (
            <EmptyState
                icon={Brain}
                title="Nothing remembered yet"
                description="When you answer a question about your experience or what you are looking for, your answer is kept here, so you are never asked it twice."
            />
        );
    }

    const replace = (id: string, next: MemoryItem | null) => {
        setItems((current) => (next ? current.map((item) => (item.id === id ? next : item)) : current.filter((item) => item.id !== id)));
    };

    return (
        <div className="space-y-6">
            {GROUPS.map((group) => {
                const rows = items.filter((item) => kindOf(item.key) === group.kind);
                if (rows.length === 0) return null;
                return (
                    <Card key={group.kind}>
                        <CardHeader>
                            <CardTitle className="text-base">{group.title}</CardTitle>
                            <CardDescription>{group.description}</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ul className="divide-y divide-border rounded-lg border border-border">
                                {rows.map((item) => (
                                    <MemoryRow key={item.id} item={item} onChange={(next) => replace(item.id, next)} />
                                ))}
                            </ul>
                        </CardContent>
                    </Card>
                );
            })}
        </div>
    );
}

function MemoryRow({ item, onChange }: { item: MemoryItem; onChange: (next: MemoryItem | null) => void }) {
    const [editing, setEditing] = React.useState(false);
    const [draft, setDraft] = React.useState(item.text);
    const [confirming, setConfirming] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const inputId = `memory-${item.id}`;

    const save = async () => {
        const text = draft.trim();
        if (!text) return;
        setBusy(true);
        const result = await updateMemory({ id: item.id, text });
        setBusy(false);
        if (!result.success) {
            toast.error(result.error);
            return;
        }
        setEditing(false);
        onChange({ ...item, ...result.data });
        toast.success('Saved. This is what I will use from now on.');
    };

    const togglePrivate = async (makePrivate: boolean) => {
        setBusy(true);
        const result = await updateMemory({ id: item.id, sensitivity: makePrivate ? 'private' : 'shareable' });
        setBusy(false);
        if (!result.success) {
            toast.error(result.error);
            return;
        }
        onChange({ ...item, ...result.data });
    };

    const remove = async () => {
        setBusy(true);
        const result = await deleteMemory({ id: item.id });
        setBusy(false);
        if (!result.success) {
            toast.error(result.error);
            return;
        }
        onChange(null);
        toast.success('Forgotten. I may ask about it again.');
    };

    const meta = [
        SOURCE_LABEL[item.source],
        shortDate(item.createdAt),
        item.useCount > 0 ? `used ${item.useCount} ${item.useCount === 1 ? 'time' : 'times'}` : null,
    ].filter(Boolean).join(' · ');

    return (
        <li className="space-y-2 p-3">
            <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                        {item.label || item.key}
                        {item.sensitivity === 'private' ? <Lock className="size-3 text-muted-foreground" aria-label="private" /> : null}
                    </p>
                    {editing ? (
                        <div className="mt-2 space-y-2">
                            <label htmlFor={inputId} className="sr-only">{`What you told me about ${item.label || item.key}`}</label>
                            <Textarea
                                id={inputId}
                                value={draft}
                                maxLength={MEMORY_TEXT_MAX}
                                rows={2}
                                onChange={(event) => setDraft(event.target.value)}
                            />
                            <div className="flex gap-2">
                                <Button size="sm" disabled={busy || !draft.trim()} onClick={() => void save()}>
                                    {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
                                    Save
                                </Button>
                                <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setEditing(false); setDraft(item.text); }}>
                                    Cancel
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <p className="mt-0.5 text-sm text-foreground/90">{item.text}</p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">{meta}</p>
                </div>
                {!editing ? (
                    <div className="flex shrink-0 items-center gap-0.5">
                        <Button variant="ghost" size="sm" className="size-7 p-0" disabled={busy} onClick={() => setEditing(true)} aria-label={`Edit ${item.label || item.key}`}>
                            <Pencil className="size-3.5" aria-hidden />
                        </Button>
                        <Button variant="ghost" size="sm" className="size-7 p-0" disabled={busy} onClick={() => setConfirming(true)} aria-label={`Delete ${item.label || item.key}`}>
                            <Trash2 className="size-3.5" aria-hidden />
                        </Button>
                    </div>
                ) : null}
            </div>

            <div className="flex items-center justify-between gap-3">
                <label htmlFor={`${inputId}-private`} className="text-xs text-muted-foreground">
                    Private: used only to answer you, never in a resume or message
                </label>
                <Switch
                    id={`${inputId}-private`}
                    checked={item.sensitivity === 'private'}
                    disabled={busy}
                    onCheckedChange={(checked) => void togglePrivate(checked)}
                />
            </div>

            {confirming ? (
                <div role="alertdialog" aria-label="Delete this memory" className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 p-2">
                    <p className="flex-1 text-xs text-foreground">Forget this? I may ask about it again on the next job that needs it.</p>
                    <Button size="sm" variant="destructive" disabled={busy} onClick={() => void remove()}>Forget</Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>Keep</Button>
                </div>
            ) : null}
        </li>
    );
}
