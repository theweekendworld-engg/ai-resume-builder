'use client';

import { useState, useEffect } from 'react';
import { EditorScreen } from '@/components/builder/EditorScreen';

export default function EditorPage() {
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

    return <EditorScreen />;
}
