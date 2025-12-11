'use client';

import { useState, useEffect } from 'react';
import { GenerateScreen } from './GenerateScreen';
import { EditorScreen } from './EditorScreen';

type Phase = 'generate' | 'editor';

export function ResumeApp() {
    const [phase, setPhase] = useState<Phase>('generate');
    const [isHydrated, setIsHydrated] = useState(false);

    useEffect(() => {
        setIsHydrated(true);
    }, []);

    if (!isHydrated) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <div className="animate-pulse">
                    <div className="w-16 h-16 rounded-2xl bg-primary/20" />
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen">
            {phase === 'generate' ? (
                <GenerateScreen onComplete={() => setPhase('editor')} />
            ) : (
                <EditorScreen />
            )}
        </div>
    );
}
