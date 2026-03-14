'use client';

import { useState, useCallback, useRef, useMemo } from 'react';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { compileLatex } from '@/actions/ai';

interface LatexPreviewProps {
    code: string;
}

export function LatexPreview({ code }: LatexPreviewProps) {
    const [isCompiling, setIsCompiling] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pdfDataUrl, setPdfDataUrl] = useState<string | null>(null);
    const lastCodeRef = useRef<string>('');
    const isStale = useMemo(
        () => Boolean(pdfDataUrl) && code.trim() !== lastCodeRef.current,
        [code, pdfDataUrl]
    );

    const compile = useCallback(async (forceCompile = false) => {
        if (!code.trim()) {
            setPdfDataUrl(null);
            lastCodeRef.current = '';
            setError(null);
            return;
        }

        // Skip if code hasn't changed (unless forced)
        if (!forceCompile && code === lastCodeRef.current && pdfDataUrl) {
            return;
        }

        setIsCompiling(true);
        setError(null);

        try {
            const result = await compileLatex(code);

            if (result.success && result.pdfBase64) {
                const dataUrl = `data:application/pdf;base64,${result.pdfBase64}`;
                setPdfDataUrl(dataUrl);
                lastCodeRef.current = code;
                setError(null);
            } else {
                setError(result.error || 'Compilation failed');
            }
        } catch (err: unknown) {
            console.error('Compilation error:', err);
            setError(err instanceof Error ? err.message : 'Unknown compilation error');
        } finally {
            setIsCompiling(false);
        }
    }, [code, pdfDataUrl]);

    const previewSrc = pdfDataUrl ? `${pdfDataUrl}#view=FitH&zoom=page-width` : null;

    return (
        <div className="h-full w-full bg-white text-black overflow-hidden relative flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50 print:hidden">
                <div className="flex items-center gap-2">
                    {isCompiling && (
                        <>
                            <Loader2 className="w-4 h-4 animate-spin text-primary" />
                            <span className="text-xs text-muted-foreground">Compiling on server...</span>
                        </>
                    )}
                    {!isCompiling && isStale && (
                        <span className="text-xs text-amber-600">Preview out of date</span>
                    )}
                    {!isCompiling && pdfDataUrl && (
                        <span className="text-xs text-green-600">✓ Preview ready</span>
                    )}
                </div>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => compile(true)}
                    disabled={isCompiling}
                    className="h-7 text-xs"
                >
                    <RefreshCw className={`w-3 h-3 mr-1 ${isCompiling ? 'animate-spin' : ''}`} />
                    Refresh Preview
                </Button>
            </div>

            {/* Error display */}
            {error && (
                <div className="bg-destructive/10 border-b border-destructive/20 text-destructive p-3 text-sm font-mono whitespace-pre-wrap max-h-40 overflow-auto print:hidden">
                    <div className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <div>
                            <p className="font-semibold mb-1">Compilation Error</p>
                            <p className="text-xs opacity-80">{error}</p>
                        </div>
                    </div>
                </div>
            )}

            {/* PDF Preview */}
            <div className="flex-1 overflow-auto bg-gray-100">
                {previewSrc ? (
                    <iframe
                        src={previewSrc}
                        className="w-full h-full border-0"
                        title="PDF Preview"
                    />
                ) : (
                    <div className="h-full flex items-center justify-center text-muted-foreground">
                        {isCompiling ? (
                            <div className="flex flex-col items-center gap-3">
                                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                                <p className="text-sm">Compiling LaTeX on server...</p>
                                <p className="text-xs text-muted-foreground">This may take a few seconds</p>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center gap-2">
                                <p className="text-sm">Refresh preview to compile this resume</p>
                                <p className="text-xs text-muted-foreground">Preview updates only when you click Refresh Preview</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
