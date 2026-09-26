'use client';

import * as React from 'react';
import { HelpCircle, Loader2 } from 'lucide-react';

import { typeStyles } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { PendingQuestion } from '@/lib/agent/run';

/**
 * The run's open question. Buttons when the pipeline offered options, and a
 * free-text box always, because "Bangalore, but open to Pune" is a better
 * answer than any button. The answer is saved to the profile by the service,
 * so the copy says so: the user should know they will not be asked again.
 */
export function QuestionCard({
    question,
    pending,
    error,
    onAnswer,
}: {
    question: PendingQuestion;
    pending: boolean;
    error: string | null;
    onAnswer: (value: string) => void;
}) {
    const [text, setText] = React.useState('');
    const inputId = React.useId();

    const submit = (event: React.FormEvent) => {
        event.preventDefault();
        const value = text.trim();
        if (!value) return;
        onAnswer(value);
    };

    return (
        <section
            aria-labelledby={`${inputId}-title`}
            className="surface-work rounded-xl border border-primary/40 bg-card p-5"
        >
            <h2 id={`${inputId}-title`} className={cn(typeStyles.h3, 'flex items-start gap-2 text-foreground')}>
                <HelpCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
                {question.prompt}
            </h2>
            <p className={cn(typeStyles.small, 'mt-1 pl-6 text-muted-foreground')}>
                Preferences you answer here are saved, so the next job will not ask again.
            </p>

            {question.options?.length ? (
                <div className="mt-4 flex flex-wrap gap-2 pl-6">
                    {question.options.map((option) => (
                        <Button
                            key={option.value}
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() => onAnswer(option.value)}
                        >
                            {option.label}
                        </Button>
                    ))}
                </div>
            ) : null}

            <form onSubmit={submit} className="mt-3 flex gap-2 pl-6">
                <label htmlFor={inputId} className="sr-only">
                    Your answer
                </label>
                <Input
                    id={inputId}
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    placeholder={question.options?.length ? 'Or type your own answer' : 'Your answer'}
                    maxLength={500}
                    disabled={pending}
                />
                <Button type="submit" size="sm" className="h-10 shrink-0" disabled={pending || !text.trim()}>
                    {pending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
                    Answer
                </Button>
            </form>
            {error ? <p className={cn(typeStyles.small, 'mt-2 pl-6 text-warning')} role="alert">{error}</p> : null}
        </section>
    );
}
