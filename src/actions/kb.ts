'use server';

import { z } from 'zod';
import { QdrantClient } from '@qdrant/js-client-rest';
import OpenAI from 'openai';
import { auth } from '@clerk/nextjs/server';
import { v4 as uuidv4 } from 'uuid';
import { checkKbRateLimit } from '@/lib/rateLimit';

const qdrantClient = new QdrantClient({
    url: process.env.QDRANT_URL || 'http://localhost:6333',
});

const COLLECTION_NAME = 'knowledge_base';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MAX_CONTENT_LENGTH = 5000;
const MAX_QUERY_LENGTH = 1000;
const MAX_TAGS = 10;

function sanitizeTags(tags: string[]): string[] {
    return tags
        .filter((tag) => typeof tag === 'string')
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, MAX_TAGS);
}

// Helper to generate embedding
async function generateEmbedding(text: string): Promise<number[]> {
    const response = await openai.embeddings.create({
        model: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
        input: text,
    });
    return response.data[0].embedding;
}

// Initialize collection if it doesn't exist
async function ensureCollection() {
    try {
        const collections = await qdrantClient.getCollections();
        const collectionExists = collections.collections.some(
            (col) => col.name === COLLECTION_NAME
        );

        if (!collectionExists) {
            // Get embedding dimension from OpenAI (text-embedding-3-small has 1536 dimensions)
            await qdrantClient.createCollection(COLLECTION_NAME, {
                vectors: {
                    size: 1536,
                    distance: 'Cosine',
                },
            });
        }
    } catch (error) {
        console.error('Error ensuring collection:', error);
        throw error;
    }
}

const SaveKbSchema = z.object({
    content: z.string().min(1).max(MAX_CONTENT_LENGTH),
    type: z.string().min(1),
    tags: z.array(z.string()),
});

export async function saveToKnowledgeBase(content: string, type: string, tags: string[]) {
    const parsed = SaveKbSchema.safeParse({
        content: typeof content === 'string' ? content.trim() : '',
        type: typeof type === 'string' ? type.trim() : '',
        tags: Array.isArray(tags) ? tags : [],
    });
    if (!parsed.success) {
        return { success: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
    }
    const { content: trimmedContent, type: trimmedType, tags: tagList } = parsed.data;
    if (!trimmedContent || !trimmedType) {
        return { success: false, error: 'Content and type are required' };
    }

    const { userId } = await auth();
    if (!userId) return { success: false, error: 'Not authenticated' };

    const limit = await checkKbRateLimit(`kb:save:${userId}`);
    if (!limit.allowed) return { success: false, error: limit.error };

    try {
        await ensureCollection();
        const embedding = await generateEmbedding(trimmedContent);
        const id = uuidv4();
        const safeTags = sanitizeTags(tagList);

        // Qdrant supports UUID strings as point IDs
        await qdrantClient.upsert(COLLECTION_NAME, {
            wait: true,
            points: [
                {
                    id: id,
                    vector: embedding,
                    payload: {
                        userId,
                        content: trimmedContent,
                        type: trimmedType,
                        tags: safeTags,
                        createdAt: new Date().toISOString(),
                    },
                },
            ],
        });

        return { success: true };
    } catch (error) {
        console.error("KB Save Error:", error);
        return { success: false, error: "Failed to save to KB" };
    }
}

const SearchKbSchema = z.string().min(1).max(MAX_QUERY_LENGTH);

export async function searchKnowledgeBase(query: string) {
    const parsed = SearchKbSchema.safeParse(typeof query === 'string' ? query.trim() : '');
    if (!parsed.success) return [];

    const { userId } = await auth();
    if (!userId) return [];

    const limit = await checkKbRateLimit(`kb:search:${userId}`);
    if (!limit.allowed) return [];

    try {
        await ensureCollection();
        const embedding = await generateEmbedding(parsed.data);

        const searchResult = await qdrantClient.search(COLLECTION_NAME, {
            vector: embedding,
            limit: 5,
            filter: {
                must: [
                    {
                        key: 'userId',
                        match: {
                            value: userId,
                        },
                    },
                ],
            },
        });

        return searchResult.map((result) => ({
            id: result.id,
            content: result.payload?.content,
            type: result.payload?.type,
            tags: result.payload?.tags || [],
            score: result.score,
        }));
    } catch (error) {
        console.error("KB Search Error:", error);
        return [];
    }
}
