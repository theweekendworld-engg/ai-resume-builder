'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { typeStyles } from '@/components/patterns';
import { cn } from '@/lib/utils';
import {
    adoptFramework,
    confirmRubric,
    parseRubric,
    removeFramework,
} from '@/actions/packets';

import type { FrameworkShape, FrameworkView } from './types';

export interface RubricUploadScreenProps {
    frameworks: FrameworkView[];
}

type Mode = 'upload' | 'template' | 'default';

/**
 * §H — rubric upload.
 *
 * The confirmation screen is mandatory and structural: `parseRubric` writes
 * nothing, so there is no framework row to generate against until a human has
 * read the parse result and pressed the button. That is how "never generate
 * against an unconfirmed framework" is enforced — by the absence of a row, not
 * by a flag someone can forget to check.
 */
export function RubricUploadScreen({ frameworks }: RubricUploadScreenProps) {
    const router = useRouter();
    const [mode, setMode] = React.useState<Mode>('upload');
    const [text, setText] = React.useState('');
    const [companyName, setCompanyName] = React.useState('');
    const [draft, setDraft] = React.useState<FrameworkShape | null>(null);
    const [pending, setPending] = React.useState(false);

    const templates = frameworks.filter((item) => item.userId === null);
    const mine = frameworks.filter((item) => item.userId !== null);

    const onParse = async () => {
        setPending(true);
        const result = await parseRubric({ text, companyName: companyName || null });
        setPending(false);
        if (!result.success) {
            toast.error(result.error);
            return;
        }
        setDraft(result.data.shape);
    };

    const onConfirm = async (shape: FrameworkShape) => {
        setPending(true);
        const result = await confirmRubric(shape);
        setPending(false);
        if (!result.success) {
            toast.error(result.error);
            return;
        }
        toast.success(`${result.data.name} saved`);
        setDraft(null);
        setText('');
        router.refresh();
    };

    if (draft) {
        return <RubricConfirm draft={draft} pending={pending} onConfirm={onConfirm} onCancel={() => setDraft(null)} />;
    }

    return (
        <div className="mx-auto w-full max-w-[640px] px-4 py-10">
            <h1 className={cn(typeStyles.h1, 'text-foreground')}>
                Add your company&apos;s leveling framework
            </h1>
            <p className={cn(typeStyles.small, 'mt-1 text-muted-foreground')}>
                Everything else summarises your wins. This is what maps them to the ladder you are
                actually measured against.
            </p>

            <div className="mt-6 space-y-2">
                <ModeRow
                    active={mode === 'upload'}
                    onSelect={() => setMode('upload')}
                    title="Paste a document"
                    subtitle="Your ladder, a levels doc, a rubric — anything with levels and competencies in it"
                />
                <ModeRow
                    active={mode === 'template'}
                    onSelect={() => setMode('template')}
                    title="Use a public ladder"
                    subtitle={templates.map((item) => item.name.replace(/ (ladder|matrix|engineering).*/i, '')).join(' · ')}
                />
                <ModeRow
                    active={mode === 'default'}
                    onSelect={() => setMode('default')}
                    title="Patronus default"
                    subtitle="Six generic competencies. A fine starting point."
                />
            </div>

            {mode === 'upload' ? (
                <div className="mt-6 space-y-3">
                    <div>
                        <Label className={cn(typeStyles.caption, 'mb-1.5 block text-muted-foreground')}>
                            Company (optional)
                        </Label>
                        <Input
                            value={companyName}
                            onChange={(event) => setCompanyName(event.target.value)}
                            placeholder="Acme"
                        />
                    </div>
                    <div>
                        <Label className={cn(typeStyles.caption, 'mb-1.5 block text-muted-foreground')}>
                            Paste the text
                        </Label>
                        <Textarea
                            rows={12}
                            value={text}
                            onChange={(event) => setText(event.target.value)}
                            placeholder="Paste your leveling document here…"
                        />
                    </div>
                    <p className={cn(typeStyles.caption, 'flex items-center gap-1.5 text-muted-foreground')}>
                        <Lock className="size-3" aria-hidden />
                        Stored privately, scoped to your account. Never shared with other users, never used
                        as training data.
                    </p>
                    <Button onClick={() => void onParse()} disabled={pending || text.trim().length < 40}>
                        {pending ? 'Reading…' : 'Read it'}
                    </Button>
                </div>
            ) : null}

            {mode === 'template' ? (
                <ul className="mt-6 space-y-2">
                    {templates.map((template) => (
                        <li
                            key={template.id}
                            className="surface-work flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
                        >
                            <div className="min-w-0">
                                <p className={cn(typeStyles.h3, 'text-foreground')}>{template.name}</p>
                                <p className={cn(typeStyles.caption, 'text-muted-foreground')}>
                                    {template.levels.length} levels · {template.competencies.length} competencies
                                    {template.attribution ? ` · ${template.attribution}` : ''}
                                </p>
                            </div>
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={pending}
                                onClick={async () => {
                                    setPending(true);
                                    const result = await adoptFramework(template.id);
                                    setPending(false);
                                    if (!result.success) toast.error(result.error);
                                    else {
                                        toast.success(`${result.data.name} added`);
                                        router.refresh();
                                    }
                                }}
                            >
                                Use this
                            </Button>
                        </li>
                    ))}
                </ul>
            ) : null}

            {mode === 'default' ? (
                <div className="mt-6">
                    <Button
                        disabled={pending}
                        onClick={async () => {
                            setPending(true);
                            const result = await adoptFramework(null);
                            setPending(false);
                            if (!result.success) toast.error(result.error);
                            else {
                                toast.success('Default framework added');
                                router.refresh();
                            }
                        }}
                    >
                        Use the Patronus default
                    </Button>
                </div>
            ) : null}

            {mine.length > 0 ? (
                <section className="mt-10 border-t border-border pt-6">
                    <h2 className={cn(typeStyles.caption, 'mb-3 uppercase tracking-wider text-muted-foreground')}>
                        Your frameworks
                    </h2>
                    <ul className="space-y-2">
                        {mine.map((item) => (
                            <li
                                key={item.id}
                                className="surface-work flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
                            >
                                <div className="min-w-0">
                                    <p className={cn(typeStyles.h3, 'text-foreground')}>{item.name}</p>
                                    <p className={cn(typeStyles.caption, 'num text-muted-foreground')}>
                                        {item.levels.length} levels · {item.competencies.length} competencies
                                    </p>
                                </div>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    aria-label={`Remove ${item.name}`}
                                    onClick={async () => {
                                        const result = await removeFramework(item.id);
                                        if (!result.success) toast.error(result.error);
                                        else router.refresh();
                                    }}
                                >
                                    <Trash2 className="size-3.5" aria-hidden />
                                </Button>
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}
        </div>
    );
}

function ModeRow({
    active,
    onSelect,
    title,
    subtitle,
}: {
    active: boolean;
    onSelect: () => void;
    title: string;
    subtitle: string;
}) {
    return (
        <button
            type="button"
            onClick={onSelect}
            className={cn(
                'surface-work block w-full rounded-lg border p-3 text-left transition-colors',
                active ? 'border-primary bg-primary/5' : 'border-border bg-card',
            )}
        >
            <span className={cn(typeStyles.h3, 'block text-foreground')}>{title}</span>
            <span className={cn(typeStyles.caption, 'block truncate text-muted-foreground')}>{subtitle}</span>
        </button>
    );
}

/**
 * "We found 5 levels and 9 competencies. Look right?" — with inline editing,
 * because the failure mode this catches is a parse that looks plausible and is
 * wrong, and the only person who can tell is the user.
 */
function RubricConfirm({
    draft,
    pending,
    onConfirm,
    onCancel,
}: {
    draft: FrameworkShape;
    pending: boolean;
    onConfirm: (shape: FrameworkShape) => void;
    onCancel: () => void;
}) {
    const [shape, setShape] = React.useState(draft);
    const [editing, setEditing] = React.useState(false);

    return (
        <div className="mx-auto w-full max-w-[640px] px-4 py-10">
            <h1 className={cn(typeStyles.h1, 'text-foreground')}>
                We found {shape.levels.length} level{shape.levels.length === 1 ? '' : 's'} and{' '}
                {shape.competencies.length} competenc{shape.competencies.length === 1 ? 'y' : 'ies'}. Look
                right?
            </h1>

            <div className="mt-6 space-y-4">
                <div>
                    <Label className={cn(typeStyles.caption, 'mb-1.5 block text-muted-foreground')}>Name</Label>
                    {editing ? (
                        <Input
                            value={shape.name}
                            onChange={(event) => setShape({ ...shape, name: event.target.value })}
                        />
                    ) : (
                        <p className={cn(typeStyles.body, 'text-foreground')}>{shape.name}</p>
                    )}
                </div>

                <div>
                    <Label className={cn(typeStyles.caption, 'mb-1.5 block text-muted-foreground')}>Levels</Label>
                    {editing ? (
                        <Textarea
                            rows={3}
                            value={shape.levels.map((level) => level.name).join(' · ')}
                            onChange={(event) =>
                                setShape({
                                    ...shape,
                                    levels: event.target.value
                                        .split('·')
                                        .map((name) => name.trim())
                                        .filter(Boolean)
                                        .map((name, index) => ({
                                            key: name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
                                            name,
                                            order: index,
                                            summary: shape.levels[index]?.summary ?? '',
                                        })),
                                })
                            }
                        />
                    ) : (
                        <p className={cn(typeStyles.body, 'text-foreground')}>
                            {shape.levels.map((level) => level.name).join(' · ')}
                        </p>
                    )}
                </div>

                <div>
                    <Label className={cn(typeStyles.caption, 'mb-1.5 block text-muted-foreground')}>
                        Competencies
                    </Label>
                    {editing ? (
                        <Textarea
                            rows={4}
                            value={shape.competencies.map((item) => item.name).join(' · ')}
                            onChange={(event) =>
                                setShape({
                                    ...shape,
                                    competencies: event.target.value
                                        .split('·')
                                        .map((name) => name.trim())
                                        .filter(Boolean)
                                        .map((name, index) => ({
                                            key: name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
                                            name,
                                            description: shape.competencies[index]?.description ?? '',
                                            levelExpectations:
                                                shape.competencies[index]?.levelExpectations ?? {},
                                        })),
                                })
                            }
                        />
                    ) : (
                        <p className={cn(typeStyles.body, 'text-foreground')}>
                            {shape.competencies.map((item) => item.name).join(' · ')}
                        </p>
                    )}
                </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
                <Button disabled={pending} onClick={() => onConfirm(shape)}>
                    Looks right
                </Button>
                <Button variant="outline" disabled={pending} onClick={() => setEditing((value) => !value)}>
                    {editing ? 'Done editing' : 'Let me fix it'}
                </Button>
                <Button variant="ghost" disabled={pending} onClick={onCancel}>
                    Start over
                </Button>
            </div>
        </div>
    );
}
