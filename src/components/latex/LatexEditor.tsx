'use client';

import { Editor } from '@monaco-editor/react';

interface LatexEditorProps {
    code: string;
    onChange: (value: string | undefined) => void;
}

export function LatexEditor({ code, onChange }: LatexEditorProps) {
    return (
        <div className="h-full w-full overflow-hidden rounded-lg border border-border/50">
            <Editor
                height="100%"
                defaultLanguage="latex"
                value={code}
                onChange={onChange}
                theme="vs-dark"
                options={{
                    minimap: { enabled: false },
                    wordWrap: 'on',
                    fontSize: 14,
                    padding: { top: 16, bottom: 16 },
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                }}
            />
        </div>
    );
}
