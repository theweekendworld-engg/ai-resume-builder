'use client';

import { useCallback, useRef, useState } from 'react';
import { UploadCloud, FileText, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

interface DropzoneProps {
    file: File | null;
    onFileSelected: (file: File) => void;
    onClear: () => void;
    onError: (message: string) => void;
    disabled?: boolean;
}

function validate(file: File): string | null {
    if (file.type !== 'application/pdf') {
        return 'Please upload a PDF file.';
    }
    if (file.size === 0) {
        return 'That file is empty. Please choose a valid PDF.';
    }
    if (file.size > MAX_FILE_SIZE) {
        return 'That file is larger than 2MB. Please upload a smaller PDF.';
    }
    return null;
}

export function Dropzone({ file, onFileSelected, onClear, onError, disabled }: DropzoneProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [isDragging, setIsDragging] = useState(false);

    const handleFiles = useCallback(
        (files: FileList | null) => {
            const picked = files?.[0];
            if (!picked) return;
            const err = validate(picked);
            if (err) {
                onError(err);
                return;
            }
            onFileSelected(picked);
        },
        [onFileSelected, onError]
    );

    if (file) {
        return (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
                <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <FileText className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
                        <p className="text-xs text-muted-foreground">
                            {(file.size / 1024).toFixed(0)} KB
                        </p>
                    </div>
                </div>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={onClear}
                    disabled={disabled}
                    aria-label="Remove file"
                >
                    <X className="h-4 w-4" />
                </Button>
            </div>
        );
    }

    return (
        <div
            role="button"
            tabIndex={0}
            aria-disabled={disabled}
            onClick={() => !disabled && inputRef.current?.click()}
            onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
                    e.preventDefault();
                    inputRef.current?.click();
                }
            }}
            onDragOver={(e) => {
                e.preventDefault();
                if (!disabled) setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                if (disabled) return;
                handleFiles(e.dataTransfer.files);
            }}
            className={cn(
                'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-card/50 px-6 py-12 text-center transition-colors',
                isDragging && 'border-primary bg-primary/5',
                disabled && 'cursor-not-allowed opacity-60'
            )}
        >
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                <UploadCloud className="h-7 w-7" />
            </div>
            <p className="text-base font-medium text-foreground">
                Drop your resume PDF here
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
                or click to browse · PDF only · up to 2MB
            </p>
            <input
                ref={inputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                disabled={disabled}
                onChange={(e) => handleFiles(e.target.files)}
            />
        </div>
    );
}
