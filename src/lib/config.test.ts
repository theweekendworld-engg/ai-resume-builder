import { describe, test, expect } from 'bun:test';
import { resolveEmbeddingSize } from './config';

describe('resolveEmbeddingSize', () => {
    test('text-embedding-3-small returns 1536 with no override', () => {
        expect(resolveEmbeddingSize('text-embedding-3-small', undefined)).toBe(1536);
    });

    test('text-embedding-3-large returns 3072 with no override', () => {
        expect(resolveEmbeddingSize('text-embedding-3-large', undefined)).toBe(3072);
    });

    test('blank override falls back to model default', () => {
        expect(resolveEmbeddingSize('text-embedding-3-small', '')).toBe(1536);
    });

    test('non-numeric override falls back to model default', () => {
        expect(resolveEmbeddingSize('text-embedding-3-small', 'not-a-number')).toBe(1536);
    });

    test('valid positive override is honored', () => {
        expect(resolveEmbeddingSize('text-embedding-3-small', '768')).toBe(768);
    });

    test('unknown model falls back to 3072', () => {
        expect(resolveEmbeddingSize('some-future-model', undefined)).toBe(3072);
    });

    test('text-embedding-ada-002 returns 1536', () => {
        expect(resolveEmbeddingSize('text-embedding-ada-002', undefined)).toBe(1536);
    });

    test('case is normalized', () => {
        expect(resolveEmbeddingSize('TEXT-EMBEDDING-3-SMALL', undefined)).toBe(1536);
    });

    test('zero or negative overrides are ignored', () => {
        expect(resolveEmbeddingSize('text-embedding-3-small', '0')).toBe(1536);
        expect(resolveEmbeddingSize('text-embedding-3-small', '-50')).toBe(1536);
    });
});
