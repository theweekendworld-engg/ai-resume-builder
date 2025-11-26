'use client';

import { useState } from 'react';
import { saveToKnowledgeBase, searchKnowledgeBase } from '@/actions/kb';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Book, Save, Search, Loader2, Plus } from 'lucide-react';
import { useUser } from '@clerk/nextjs';
import { useResumeStore } from '@/store/resumeStore';

export function KnowledgeBase() {
    const { user } = useUser();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const { addExperience } = useResumeStore(); // Example usage

    const handleSearch = async () => {
        if (!user || !query) return;
        setLoading(true);
        try {
            const data = await searchKnowledgeBase(user.id, query);
            setResults(data);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    // Mock function to simulate saving "current selection" or just a manual entry
    const [manualEntry, setManualEntry] = useState('');
    const handleSave = async () => {
        if (!user || !manualEntry) return;
        setLoading(true);
        try {
            await saveToKnowledgeBase(user.id, manualEntry, 'bullet', ['manual']);
            setManualEntry('');
            alert("Saved to Knowledge Base!");
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Book className="w-4 h-4" /> Knowledge Base
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Save Section */}
                <div className="flex gap-2">
                    <Input
                        value={manualEntry}
                        onChange={(e) => setManualEntry(e.target.value)}
                        placeholder="Add a bullet point to your library..."
                    />
                    <Button onClick={handleSave} disabled={loading || !manualEntry} variant="secondary" size="icon">
                        <Save className="w-4 h-4" />
                    </Button>
                </div>

                {/* Search Section */}
                <div className="space-y-2">
                    <div className="flex gap-2">
                        <Input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search your achievements..."
                        />
                        <Button onClick={handleSearch} disabled={loading} size="icon">
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                        </Button>
                    </div>

                    <div className="space-y-2">
                        {results.map((item: any) => (
                            <div key={item.id} className="p-3 bg-secondary rounded-sm border border-border flex justify-between items-center">
                                <span className="text-sm text-foreground">{item.content}</span>
                                <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(item.content)}>
                                    Copy
                                </Button>
                            </div>
                        ))}
                        {results.length === 0 && query && !loading && (
                            <p className="text-xs text-muted-foreground text-center">No matching items found.</p>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
