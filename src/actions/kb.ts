'use server';

import { QdrantClient } from '@qdrant/js-client-rest';
import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';

const qdrantClient = new QdrantClient({
    url: process.env.QDRANT_URL || 'http://localhost:6333',
});

const COLLECTION_NAME = 'knowledge_base';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

export async function saveToKnowledgeBase(
    userId: string,
    content: string,
    type: string,
    tags: string[]
) {
    if (!userId || !content) return null;

    try {
        await ensureCollection();
        const embedding = await generateEmbedding(content);
        const id = uuidv4();

        // Qdrant supports UUID strings as point IDs
        await qdrantClient.upsert(COLLECTION_NAME, {
            wait: true,
            points: [
                {
                    id: id,
                    vector: embedding,
                    payload: {
                        userId,
                        content,
                        type,
                        tags,
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

export async function searchKnowledgeBase(userId: string, query: string) {
    if (!userId || !query) return [];

    try {
        await ensureCollection();
        const embedding = await generateEmbedding(query);

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
