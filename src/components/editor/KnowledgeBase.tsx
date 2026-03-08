'use client';

import { useState } from 'react';
import { saveToKnowledgeBase, searchKnowledgeBase } from '@/actions/kb';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Book, Save, Search, Loader2, Trash2, Copy } from 'lucide-react';
import { useKnowledgeBaseStore, KBItem } from '@/store/knowledgeBaseStore';
import { toast } from 'sonner';

export function KnowledgeBase() {
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
            const data = await searchKnowledgeBase(query);
            setResults(data.map((item) => ({
                id: String(item.id),
                content: String(item.content || ''),
                type: String(item.type || 'bullet'),
                tags: Array.isArray(item.tags) ? item.tags as string[] : [],
                createdAt: new Date().toISOString(),
            })));
        } catch (error: unknown) {
            console.error(error);
            const localResults = searchItems(query);
            setResults(localResults);
            toast.error('Cloud search unavailable', {
                description: 'Showing local matches instead.',
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

            // Persist to cloud (auth-gated app route).
            await saveToKnowledgeBase(manualEntry, 'bullet', ['manual']);

            setManualEntry('');
            toast.success('Saved!', {
                description: 'Added to your knowledge base and synced.',
            });
        } catch (error: unknown) {
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
                </CardTitle>
                <CardDescription>
                    Your achievements sync across devices.
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
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-7 w-7 text-destructive hover:text-destructive"
                                        onClick={() => handleDelete(item.id)}
                                    >
                                        <Trash2 className="w-3 h-3" />
                                    </Button>
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
