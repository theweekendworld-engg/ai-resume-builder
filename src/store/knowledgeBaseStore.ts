import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';

export interface KBItem {
    id: string;
    content: string;
    type: string;
    tags: string[];
    createdAt: string;
}

interface KnowledgeBaseState {
    items: KBItem[];

    // Actions
    addItem: (content: string, type: string, tags: string[]) => KBItem;
    removeItem: (id: string) => void;
    searchItems: (query: string) => KBItem[];
    clearAll: () => void;
}

/**
 * Perform a basic text search with simple scoring.
 * Returns items sorted by relevance score.
 */
function localSearch(items: KBItem[], query: string): KBItem[] {
    if (!query.trim()) return items;

    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

    const scored = items.map(item => {
        const contentLower = item.content.toLowerCase();
        let score = 0;

        // Exact phrase match (highest score)
        if (contentLower.includes(queryLower)) {
            score += 10;
        }

        // Word matches
        for (const word of queryWords) {
            if (contentLower.includes(word)) {
                score += 2;
            }
        }

        // Tag matches
        for (const tag of item.tags) {
            if (tag.toLowerCase().includes(queryLower)) {
                score += 5;
            }
            for (const word of queryWords) {
                if (tag.toLowerCase().includes(word)) {
                    score += 1;
                }
            }
        }

        return { item, score };
    });

    return scored
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(s => s.item);
}

export const useKnowledgeBaseStore = create<KnowledgeBaseState>()(
    persist(
        (set, get) => ({
            items: [],

            addItem: (content, type, tags) => {
                const newItem: KBItem = {
                    id: uuidv4(),
                    content,
                    type,
                    tags,
                    createdAt: new Date().toISOString(),
                };
                set(state => ({ items: [newItem, ...state.items] }));
                return newItem;
            },

            removeItem: (id) => {
                set(state => ({ items: state.items.filter(item => item.id !== id) }));
            },

            searchItems: (query) => {
                const { items } = get();
                return localSearch(items, query);
            },

            clearAll: () => {
                set({ items: [] });
            },
        }),
        {
            name: 'knowledge-base-storage',
        }
    )
);
