'use client';

import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, Wand2 } from 'lucide-react';
import { improveText } from '@/actions/ai';
import { rewriteBulletPoint, type BulletEnhancementType } from '@/actions/copilot';

interface AIRewriteModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    originalText: string;
    onAccept: (rewrittenText: string) => void;
    type?: 'bullet' | 'summary' | 'project';
    mode?: 'classic' | 'quick';
    jobDescription?: string;
}

const rewriteStyles = [
    { value: 'default', label: 'Enhance - Add action verbs and metrics' },
    { value: 'concise', label: 'Shorter - Make it more concise' },
    { value: 'detailed', label: 'Expand - Add more detail' },
    { value: 'quantify', label: 'Numbers - Add metrics and results' },
    { value: 'professional', label: 'Formal - More professional tone' },
    { value: 'impactful', label: 'Impact - Focus on achievements' },
];

const quickActions: Array<{ label: string; enhancementType: BulletEnhancementType; needsJd?: boolean }> = [
    { label: 'Tailor to Job Target', enhancementType: 'tailor', needsJd: true },
    { label: 'Make Impact-Driven', enhancementType: 'quantify' },
    { label: 'Fix Grammar', enhancementType: 'grammar' },
];

export function AIRewriteModal({
    open,
    onOpenChange,
    originalText,
    onAccept,
    type = 'bullet',
    mode = 'classic',
    jobDescription = '',
}: AIRewriteModalProps) {
    const [rewrittenText, setRewrittenText] = useState('');
    const [loading, setLoading] = useState(false);
    const [style, setStyle] = useState('default');
    const [customInstruction, setCustomInstruction] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [keywordHints, setKeywordHints] = useState<string[]>([]);

    const hasJobDescription = useMemo(() => jobDescription.trim().length > 0, [jobDescription]);

    const resetState = () => {
        setRewrittenText('');
        setStyle('default');
        setCustomInstruction('');
        setError(null);
        setKeywordHints([]);
        setLoading(false);
    };

    const handleClassicRewrite = async () => {
        if (!originalText) return;
        setLoading(true);
        setError(null);
        setKeywordHints([]);
        try {
            let instruction = '';
            switch (style) {
                case 'concise':
                    instruction = 'Make it more concise and to the point.';
                    break;
                case 'detailed':
                    instruction = 'Add more detail and context while keeping it professional.';
                    break;
                case 'quantify':
                    instruction = 'Add metrics, numbers, and quantifiable results where possible.';
                    break;
                case 'professional':
                    instruction = 'Make it more professional and formal in tone.';
                    break;
                case 'impactful':
                    instruction = 'Make it more impactful, focusing on achievements and results.';
                    break;
                default:
                    instruction = 'Improve with strong action verbs, quantify results if possible, and make it more professional.';
            }

            if (customInstruction.trim()) {
                instruction += ` ${customInstruction.trim()}`;
            }

            const result = await improveText(originalText, type, instruction);
            setRewrittenText(result);
        } catch (rewriteError: unknown) {
            console.error('Rewrite Error:', rewriteError);
            setError('Failed to generate rewrite. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleQuickRewrite = async (enhancementType: BulletEnhancementType) => {
        if (!originalText) return;
        setLoading(true);
        setError(null);
        setKeywordHints([]);

        try {
            const result = await rewriteBulletPoint(originalText, jobDescription, enhancementType);
            setRewrittenText(result.suggestion);
            setKeywordHints(result.appliedKeywords || []);
        } catch (rewriteError: unknown) {
            console.error('Quick rewrite error:', rewriteError);
            setError(rewriteError instanceof Error ? rewriteError.message : 'Failed to generate rewrite.');
        } finally {
            setLoading(false);
        }
    };

    const handleAccept = () => {
        if (!rewrittenText) return;
        onAccept(rewrittenText);
        onOpenChange(false);
        resetState();
    };

    const handleClose = () => {
        onOpenChange(false);
        resetState();
    };

    const isQuickMode = mode === 'quick' && (type === 'bullet' || type === 'project');

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Wand2 className="w-5 h-5 text-indigo-400" />
                        <span>Smart Rewrite</span>
                    </DialogTitle>
                    <DialogDescription>
                        {isQuickMode
                            ? 'Pick an action, review the suggestion, then accept or reject it.'
                            : 'Choose how you want to improve this text, then review and accept the result.'}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label>Original Text</Label>
                        <Textarea value={originalText} readOnly className="min-h-[100px] bg-muted" />
                    </div>

                    {isQuickMode ? (
                        <div className="space-y-2">
                            <Label>Quick Actions</Label>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                {quickActions.map((action) => {
                                    const disabled = loading || !originalText || (action.needsJd && !hasJobDescription);
                                    return (
                                        <Button
                                            key={action.label}
                                            type="button"
                                            variant="outline"
                                            disabled={disabled}
                                            onClick={() => handleQuickRewrite(action.enhancementType)}
                                            className="h-auto py-2 text-xs"
                                        >
                                            {loading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                                            {action.label}
                                        </Button>
                                    );
                                })}
                            </div>
                            {!hasJobDescription && (
                                <p className="text-xs text-muted-foreground">
                                    Add a job description in Job Target to enable &quot;Tailor to Job Target&quot;.
                                </p>
                            )}
                        </div>
                    ) : (
                        <>
                            <div className="space-y-2">
                                <Label>Rewrite Style</Label>
                                <Select value={style} onValueChange={setStyle}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select rewrite style" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {rewriteStyles.map((s) => (
                                            <SelectItem key={s.value} value={s.value}>
                                                {s.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label>
                                    Additional Instructions
                                    <span className="ml-1 text-xs text-muted-foreground">(Optional)</span>
                                </Label>
                                <Textarea
                                    value={customInstruction}
                                    onChange={(e) => setCustomInstruction(e.target.value)}
                                    placeholder="e.g., Focus on leadership and scale"
                                    className="min-h-[60px]"
                                />
                            </div>

                            <Button onClick={handleClassicRewrite} disabled={loading || !originalText} className="w-full">
                                {loading ? (
                                    <>
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        Rewriting...
                                    </>
                                ) : (
                                    <>
                                        <Wand2 className="w-4 h-4 mr-2" />
                                        Generate Rewrite
                                    </>
                                )}
                            </Button>
                        </>
                    )}

                    {error && (
                        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                            {error}
                        </p>
                    )}

                    {rewrittenText && (
                        <div className="space-y-2">
                            <Label>Suggested Text</Label>
                            <Textarea
                                value={rewrittenText}
                                onChange={(e) => setRewrittenText(e.target.value)}
                                className="min-h-[150px]"
                            />
                            {keywordHints.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                    {keywordHints.map((keyword) => (
                                        <Badge key={keyword} variant="secondary" className="text-[10px]">
                                            {keyword}
                                        </Badge>
                                    ))}
                                </div>
                            )}
                            <p className="text-xs text-muted-foreground">You can edit this suggestion before accepting.</p>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={handleClose}>
                        Reject
                    </Button>
                    <Button onClick={handleAccept} disabled={!rewrittenText || loading}>
                        Accept
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
