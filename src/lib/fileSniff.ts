/**
 * What a file actually is, from its first bytes, not the type the browser
 * claimed (launch audit 2026-10-02: uploads trusted `file.type`).
 */
export async function sniffUpload(file: Blob): Promise<'pdf' | 'docx' | 'unknown'> {
    const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return 'pdf'; // %PDF
    if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return 'docx'; // PK.. (zip)
    return 'unknown';
}
