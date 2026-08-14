import { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { QuestionDrafter } from './QuestionDrafter';

type QuestionLike = {
    id?: string;
    questionText?: string;
    typeHint?: string;
    locator?: Record<string, unknown>;
};

export function QuestionsCard({ questions }: { questions: Array<Record<string, unknown>> }) {
    const [openId, setOpenId] = useState<string | null>(null);

    const items: QuestionLike[] = (questions ?? []).map((q, i) => ({
        id: (q['id'] as string | undefined) ?? `q-${i + 1}`,
        questionText: (q['questionText'] as string | undefined) ?? `Question ${i + 1}`,
        typeHint: q['typeHint'] as string | undefined,
        locator: q['locator'] as Record<string, unknown> | undefined,
    }));

    return (
        <section className="card p-3">
            <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">Long-form questions</h3>
                </div>
                <span className="text-xs text-muted-foreground">{items.length}</span>
            </div>
            {items.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                    No application questions detected on this page.
                </p>
            ) : (
                <div className="space-y-1.5">
                    {items.slice(0, 8).map((q) => (
                        <QuestionDrafter
                            key={q.id}
                            id={q.id ?? ''}
                            questionText={q.questionText ?? ''}
                            typeHint={q.typeHint}
                            locator={q.locator}
                            expanded={openId === q.id}
                            onToggle={() =>
                                setOpenId((prev) => (prev === q.id ? null : (q.id ?? null)))
                            }
                        />
                    ))}
                </div>
            )}
        </section>
    );
}
