'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Sparkles } from 'lucide-react';
import { improveText } from '@/actions/ai';

interface AIRewriteModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    originalText: string;
    onAccept: (rewrittenText: string) => void;
    type?: 'bullet' | 'summary' | 'project';
}

const rewriteStyles = [
    { value: 'default', label: 'Default - Improve with action verbs and metrics' },
    { value: 'concise', label: 'Make it more concise' },
    { value: 'detailed', label: 'Add more detail and context' },
    { value: 'quantify', label: 'Add metrics and quantifiable results' },
    { value: 'professional', label: 'Make it more professional and formal' },
    { value: 'impactful', label: 'Make it more impactful and achievement-focused' },
];

export function AIRewriteModal({ open, onOpenChange, originalText, onAccept, type = 'bullet' }: AIRewriteModalProps) {
    const [rewrittenText, setRewrittenText] = useState('');
    const [loading, setLoading] = useState(false);
    const [style, setStyle] = useState('default');
    const [customInstruction, setCustomInstruction] = useState('');

    const handleRewrite = async () => {
        if (!originalText) return;
        setLoading(true);
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
        } catch (error) {
            console.error('AI Rewrite Error:', error);
            setRewrittenText('Error generating rewrite. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleAccept = () => {
        if (rewrittenText) {
            onAccept(rewrittenText);
            onOpenChange(false);
            setRewrittenText('');
            setStyle('default');
            setCustomInstruction('');
        }
    };

    const handleClose = () => {
        onOpenChange(false);
        setRewrittenText('');
        setStyle('default');
        setCustomInstruction('');
    };

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Sparkles className="w-5 h-5" />
                        AI Rewrite
                    </DialogTitle>
                    <DialogDescription>
                        Choose how you want the AI to rewrite this text, then review and accept the result.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {/* Original Text */}
                    <div className="space-y-2">
                        <Label>Original Text</Label>
                        <Textarea
                            value={originalText}
                            readOnly
                            className="min-h-[100px] bg-muted"
                        />
                    </div>

                    {/* Rewrite Style Selection */}
                    <div className="space-y-2">
                        <Label>How should AI rewrite this?</Label>
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

                    {/* Custom Instruction */}
                    <div className="space-y-2">
                        <Label>Additional Instructions (Optional)</Label>
                        <Textarea
                            value={customInstruction}
                            onChange={(e) => setCustomInstruction(e.target.value)}
                            placeholder="e.g., 'Focus on scalability', 'Emphasize leadership', etc."
                            className="min-h-[60px]"
                        />
                    </div>

                    {/* Rewrite Button */}
                    <Button
                        onClick={handleRewrite}
                        disabled={loading || !originalText}
                        className="w-full"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Rewriting...
                            </>
                        ) : (
                            <>
                                <Sparkles className="w-4 h-4 mr-2" />
                                Generate Rewrite
                            </>
                        )}
                    </Button>

                    {/* Rewritten Text */}
                    {rewrittenText && (
                        <div className="space-y-2">
                            <Label>Rewritten Text</Label>
                            <Textarea
                                value={rewrittenText}
                                onChange={(e) => setRewrittenText(e.target.value)}
                                className="min-h-[150px]"
                            />
                            <p className="text-xs text-muted-foreground">
                                You can edit the rewritten text before accepting it.
                            </p>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={handleClose}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleAccept}
                        disabled={!rewrittenText || loading}
                    >
                        Accept & Apply
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

