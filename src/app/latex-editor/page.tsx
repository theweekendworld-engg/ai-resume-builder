'use client';

import { useState } from 'react';
import { LatexEditor } from '@/components/latex/LatexEditor';
import { LatexPreview } from '@/components/latex/LatexPreview';
import { modifyLatex } from '@/actions/ai';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Wand2, ArrowLeft, Loader2 } from 'lucide-react';
import Link from 'next/link';

import { DEFAULT_LATEX_TEMPLATE } from '@/templates/latex';

export default function LatexEditorPage() {
    const [code, setCode] = useState<string>(DEFAULT_LATEX_TEMPLATE);
    const [instruction, setInstruction] = useState('');
    const [isModifying, setIsModifying] = useState(false);

    const [error, setError] = useState<string | null>(null);

    const handleAiModify = async () => {
        if (!instruction || !code) return;

        console.log("Starting AI modification...", { instruction, codeLength: code.length });
        setError(null);
        setIsModifying(true);
        try {
            const newCode = await modifyLatex(code, instruction);
            console.log("AI Response received", { newCodeLength: newCode?.length });
            if (newCode && newCode !== code) {
                setCode(newCode);
                setInstruction('');
            } else {
                console.warn("AI returned same or empty code");
                setError("AI could not generate a modification. Try a different instruction.");
            }
        } catch (err) {
            console.error("AI Modification Error:", err);
            setError("Failed to modify code with AI. Please try again.");
        } finally {
            setIsModifying(false);
        }
    };

    return (
        <div className="flex flex-col h-screen bg-background">
            {/* Header */}
            <header className="border-b border-border bg-card px-6 py-4 flex items-center justify-between sticky top-0 z-10">
                <div className="flex items-center gap-4">
                    <Link href="/">
                        <Button variant="ghost" size="icon">
                            <ArrowLeft className="w-5 h-5" />
                        </Button>
                    </Link>
                    <h1 className="text-xl font-semibold text-foreground">
                        LaTeX Resume Editor
                    </h1>
                </div>

                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>Use PDF viewer controls to download</span>
                </div>
            </header>

            {/* Toolbar for AI */}
            <div className="border-b border-border bg-card px-6 py-3 flex items-center gap-4">
                <div className="flex items-center gap-2 text-primary">
                    <Wand2 className="w-5 h-5" />
                    <span className="font-semibold text-sm">AI Assistant:</span>
                </div>
                <div className="flex-1 flex gap-2">
                    <Input
                        value={instruction}
                        onChange={(e) => setInstruction(e.target.value)}
                        placeholder="e.g., 'Make the education section bold' or 'Add a skills section with Python and React'"
                        className="max-w-xl"
                        onKeyDown={(e) => e.key === 'Enter' && handleAiModify()}
                    />
                    <Button
                        onClick={handleAiModify}
                        disabled={isModifying || !instruction}
                    >
                        {isModifying ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Modifying...
                            </>
                        ) : (
                            'Modify'
                        )}
                    </Button>
                </div>
            </div>

            {error && (
                <div className="bg-destructive/10 text-destructive px-6 py-2 text-sm border-b border-destructive/20">
                    {error}
                </div>
            )}

            {/* Main Content - Split View */}
            <main className="flex-1 flex overflow-hidden">
                {/* Editor Pane */}
                <div className="flex-1 border-r border-border p-0 flex flex-col">
                    <div className="bg-secondary px-4 py-2 border-b border-border text-xs font-mono text-muted-foreground">
                        SOURCE CODE
                    </div>
                    <div className="flex-1">
                        <LatexEditor
                            code={code}
                            onChange={(val) => setCode(val || '')}
                        />
                    </div>
                </div>

                {/* Preview Pane */}
                <div className="flex-1 bg-muted/30 flex flex-col">
                    <div className="bg-secondary px-4 py-2 border-b border-border text-xs font-mono text-muted-foreground">
                        PDF PREVIEW (Full LaTeX Support)
                    </div>
                    <div className="flex-1">
                        <LatexPreview code={code} />
                    </div>
                </div>
            </main>
        </div>
    );
}
