'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { Loader2, Wand2, Info } from 'lucide-react';
import { improveText } from '@/actions/ai';

interface AIRewriteModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    originalText: string;
    onAccept: (rewrittenText: string) => void;
    type?: 'bullet' | 'summary' | 'project';
}

const rewriteStyles = [
    { value: 'default', label: 'Enhance - Add action verbs and metrics', tooltip: 'Improves with strong verbs and quantifies results where possible' },
    { value: 'concise', label: 'Shorter - Make it more concise', tooltip: 'Removes filler words while keeping the core message' },
    { value: 'detailed', label: 'Expand - Add more detail', tooltip: 'Adds context and elaborates on your accomplishments' },
    { value: 'quantify', label: 'Numbers - Add metrics and results', tooltip: 'Focuses on adding specific numbers and measurable outcomes' },
    { value: 'professional', label: 'Formal - More professional tone', tooltip: 'Adjusts language for a more corporate/formal audience' },
    { value: 'impactful', label: 'Impact - Focus on achievements', tooltip: 'Emphasizes outcomes and business value' },
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
        } catch (error: unknown) {
            console.error('Rewrite Error:', error);
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

    const selectedStyle = rewriteStyles.find(s => s.value === style);

    return (
        <TooltipProvider>
            <Dialog open={open} onOpenChange={handleClose}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Wand2 className="w-5 h-5 text-indigo-400" />
                            <span>Smart Rewrite</span>
                        </DialogTitle>
                        <DialogDescription>
                            Choose how you want to improve this text, then review and accept the result.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Original Text</Label>
                            <Textarea
                                value={originalText}
                                readOnly
                                className="min-h-[100px] bg-muted"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label className="flex items-center gap-2">
                                Rewrite Style
                                {selectedStyle && (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-xs">
                                            {selectedStyle.tooltip}
                                        </TooltipContent>
                                    </Tooltip>
                                )}
                            </Label>
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
                            <Label className="flex items-center gap-2">
                                Additional Instructions
                                <span className="text-xs text-muted-foreground">(Optional)</span>
                            </Label>
                            <Textarea
                                value={customInstruction}
                                onChange={(e) => setCustomInstruction(e.target.value)}
                                placeholder="e.g., 'Focus on scalability', 'Emphasize leadership', etc."
                                className="min-h-[60px]"
                            />
                        </div>

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
                                    <Wand2 className="w-4 h-4 mr-2" />
                                    Generate Rewrite
                                </>
                            )}
                        </Button>

                        {rewrittenText && (
                            <div className="space-y-2">
                                <Label>Suggested Text</Label>
                                <Textarea
                                    value={rewrittenText}
                                    onChange={(e) => setRewrittenText(e.target.value)}
                                    className="min-h-[150px]"
                                />
                                <p className="text-xs text-muted-foreground">
                                    Feel free to edit before accepting.
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
        </TooltipProvider>
    );
}
