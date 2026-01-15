'use client';

import { useState } from 'react';
import { saveToKnowledgeBase, searchKnowledgeBase } from '@/actions/kb';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Book, Save, Search, Loader2, Trash2, Copy, Cloud, CloudOff } from 'lucide-react';
import { useUser } from '@clerk/nextjs';
import { useResumeStore } from '@/store/resumeStore';
import { useKnowledgeBaseStore, KBItem } from '@/store/knowledgeBaseStore';
import { toast } from 'sonner';

export function KnowledgeBase() {
    const { user } = useUser();
    const { cloudSyncEnabled } = useResumeStore();
    const { items: localItems, addItem, removeItem, searchItems } = useKnowledgeBaseStore();

    const [query, setQuery] = useState('');
    const [results, setResults] = useState<KBItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);
    const [manualEntry, setManualEntry] = useState('');

    const handleSearch = async () => {
        if (!query.trim()) return;
        setLoading(true);
        setHasSearched(true);

        try {
            if (cloudSyncEnabled && user) {
                // Use Qdrant for cloud search
                const data = await searchKnowledgeBase(user.id, query);
                setResults(data.map((item) => ({
                    id: String(item.id),
                    content: String(item.content || ''),
                    type: String(item.type || 'bullet'),
                    tags: Array.isArray(item.tags) ? item.tags as string[] : [],
                    createdAt: new Date().toISOString(),
                })));
            } else {
                // Use local search
                const localResults = searchItems(query);
                setResults(localResults);
            }
        } catch (error) {
            console.error(error);
            toast.error('Search failed', {
                description: 'Unable to search knowledge base. Please try again.',
            });
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!manualEntry.trim()) return;
        setLoading(true);

        try {
            // Always save locally first
            addItem(manualEntry, 'bullet', ['manual']);

            // Also save to cloud if sync enabled
            if (cloudSyncEnabled && user) {
                await saveToKnowledgeBase(user.id, manualEntry, 'bullet', ['manual']);
            }

            setManualEntry('');
            toast.success('Saved!', {
                description: cloudSyncEnabled
                    ? 'Added to your knowledge base (synced to cloud)'
                    : 'Added to your local knowledge base',
            });
        } catch (error) {
            console.error(error);
            toast.error('Save failed', {
                description: 'Unable to save to knowledge base. Please try again.',
            });
        } finally {
            setLoading(false);
        }
    };

    const handleCopy = (content: string) => {
        navigator.clipboard.writeText(content);
        toast.success('Copied to clipboard');
    };

    const handleDelete = (id: string) => {
        removeItem(id);
        setResults(results.filter(r => r.id !== id));
        toast.success('Item removed from knowledge base');
    };

    // Show local items when not searching
    const displayItems = hasSearched ? results : localItems.slice(0, 5);

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Book className="w-4 h-4" /> Knowledge Base
                    {cloudSyncEnabled ? (
                        <Cloud className="w-3 h-3 text-primary ml-auto" />
                    ) : (
                        <CloudOff className="w-3 h-3 text-muted-foreground ml-auto" />
                    )}
                </CardTitle>
                <CardDescription>
                    {cloudSyncEnabled
                        ? 'Your achievements sync across devices'
                        : 'Stored locally in your browser'}
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Save Section */}
                <div className="flex gap-2">
                    <Input
                        value={manualEntry}
                        onChange={(e) => setManualEntry(e.target.value)}
                        placeholder="Add a bullet point to your library..."
                        onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                    />
                    <Button
                        onClick={handleSave}
                        disabled={loading || !manualEntry.trim()}
                        variant="secondary"
                        size="icon"
                    >
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
                            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                        />
                        <Button onClick={handleSearch} disabled={loading} size="icon">
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                        </Button>
                    </div>

                    <div className="space-y-2">
                        {displayItems.length > 0 && (
                            <p className="text-xs text-muted-foreground">
                                {hasSearched
                                    ? `${results.length} result${results.length !== 1 ? 's' : ''} found`
                                    : `Recent items (${localItems.length} total)`}
                            </p>
                        )}

                        {displayItems.map((item) => (
                            <div
                                key={item.id}
                                className="p-3 bg-secondary rounded-sm border border-border flex justify-between items-start gap-2"
                            >
                                <span className="text-sm text-foreground flex-1">{item.content}</span>
                                <div className="flex gap-1 flex-shrink-0">
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-7 w-7"
                                        onClick={() => handleCopy(item.content)}
                                    >
                                        <Copy className="w-3 h-3" />
                                    </Button>
                                    {!cloudSyncEnabled && (
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-7 w-7 text-destructive hover:text-destructive"
                                            onClick={() => handleDelete(item.id)}
                                        >
                                            <Trash2 className="w-3 h-3" />
                                        </Button>
                                    )}
                                </div>
                            </div>
                        ))}

                        {displayItems.length === 0 && (
                            <p className="text-xs text-muted-foreground text-center py-4">
                                {hasSearched
                                    ? 'No matching items found.'
                                    : 'No items yet. Add your first achievement!'}
                            </p>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
