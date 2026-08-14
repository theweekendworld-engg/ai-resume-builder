import mammoth from 'mammoth';

export async function extractDocxText(buffer: Buffer): Promise<string> {
    const result = await mammoth.extractRawText({ buffer });
    return result.value ?? '';
}
