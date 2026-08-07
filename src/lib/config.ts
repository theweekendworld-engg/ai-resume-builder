// Exported for tests; resolves the embedding vector size from the model name
// when an explicit OPENAI_EMBEDDING_SIZE env override is missing or invalid.
export function resolveEmbeddingSize(model: string, override?: string): number {
    const parsedOverride = Number(override);
    if (Number.isFinite(parsedOverride) && parsedOverride > 0) {
        return parsedOverride;
    }

    const normalizedModel = String(model || "").trim().toLowerCase();
    if (normalizedModel === "text-embedding-3-small") return 1536;
    if (normalizedModel === "text-embedding-3-large") return 3072;
    if (normalizedModel === "text-embedding-ada-002") return 1536;
    return 3072;
}

const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-large";

export const config = {
    openai: {
        apiKey: process.env.OPENAI_API_KEY as string,
        model: process.env.OPENAI_MODEL_GENERAL || process.env.OPENAI_MODEL || "gpt-5-mini",
        models: {
            general: process.env.OPENAI_MODEL_GENERAL || process.env.OPENAI_MODEL || "gpt-5",
            jdParse: process.env.OPENAI_MODEL || "gpt-5-mini",
            paraphrase: process.env.OPENAI_MODEL_GENERAL || process.env.OPENAI_MODEL || "gpt-5",
            atsScore: process.env.OPENAI_MODEL || "gpt-5-mini",
            assembly: process.env.OPENAI_MODEL_GENERAL || process.env.OPENAI_MODEL || "gpt-5",
            claimValidation: process.env.OPENAI_MODEL || "gpt-5-mini",
            resumeParse: process.env.OPENAI_MODEL || "gpt-5-mini",
            // R1 per-task keys (ADR-6 / P0.4). No model id at a call site, ever:
            // every one of these is reachable only through `TaskKey` in src/lib/ai/tasks.ts.
            // Cheap tasks default to the small model; anything a human reads defaults to the large one.
            winDraft: process.env.OPENAI_MODEL_WIN_DRAFT || process.env.OPENAI_MODEL || "gpt-5-mini",
            // Escalation tier: multi-PR groups and contexts over ~2k chars
            // (PRD 02 §4.2). Draft accept rate is the R1 north-star input and
            // the cost delta is ~$0.14/user/month, so quality wins here.
            winDraftLarge: process.env.OPENAI_MODEL_WIN_DRAFT_LARGE || process.env.OPENAI_MODEL_GENERAL || "gpt-5",
            winStructure: process.env.OPENAI_MODEL_WIN_STRUCTURE || process.env.OPENAI_MODEL || "gpt-5-mini",
            digestCompose: process.env.OPENAI_MODEL_DIGEST_COMPOSE || process.env.OPENAI_MODEL_GENERAL || process.env.OPENAI_MODEL || "gpt-5",
            monthReview: process.env.OPENAI_MODEL_MONTH_REVIEW || process.env.OPENAI_MODEL_GENERAL || process.env.OPENAI_MODEL || "gpt-5",
            packetThemes: process.env.OPENAI_MODEL_PACKET_THEMES || process.env.OPENAI_MODEL_GENERAL || process.env.OPENAI_MODEL || "gpt-5",
            packetMap: process.env.OPENAI_MODEL_PACKET_MAP || process.env.OPENAI_MODEL || "gpt-5-mini",
            packetCompose: process.env.OPENAI_MODEL_PACKET_COMPOSE || process.env.OPENAI_MODEL_GENERAL || process.env.OPENAI_MODEL || "gpt-5",
            interviewTurn: process.env.OPENAI_MODEL_INTERVIEW_TURN || process.env.OPENAI_MODEL_GENERAL || process.env.OPENAI_MODEL || "gpt-5",
            interviewExtract: process.env.OPENAI_MODEL_INTERVIEW_EXTRACT || process.env.OPENAI_MODEL || "gpt-5-mini",
            radarNormalize: process.env.OPENAI_MODEL_RADAR_NORMALIZE || process.env.OPENAI_MODEL || "gpt-5-mini",
            radarReason: process.env.OPENAI_MODEL_RADAR_REASON || process.env.OPENAI_MODEL_GENERAL || process.env.OPENAI_MODEL || "gpt-5",
            // Resume generation v2. All three default to the quality tier: this
            // is the artifact a candidate sends to an employer, and the audit
            // of 7 Aug showed the mini model silently dropping the two
            // strongest lines on the page. Cost is ~$0.06 per resume against a
            // $5/month subscription — roughly 87 generations before the model
            // bill reaches the price, and nobody tailors 87 resumes a month.
            postingRead: process.env.OPENAI_MODEL_POSTING_READ || process.env.OPENAI_MODEL_GENERAL || "gpt-5",
            bulletSelect: process.env.OPENAI_MODEL_BULLET_SELECT || process.env.OPENAI_MODEL_GENERAL || "gpt-5",
            bulletWrite: process.env.OPENAI_MODEL_BULLET_WRITE || process.env.OPENAI_MODEL_GENERAL || "gpt-5",
        },
        embedding: {
            model: embeddingModel,
            size: resolveEmbeddingSize(embeddingModel, process.env.OPENAI_EMBEDDING_SIZE),
        },
    },
    app: {
        url: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    },
    qdrant: {
        url: process.env.QDRANT_URL as string,
        apiKey: process.env.QDRANT_API_KEY || undefined,
    },
    // Resume generation v2 (src/lib/resume). ON by default: v1 is the path the
    // 7 Aug audit caught fabricating skills and dropping evidence, so this is a
    // kill switch for the NEW path, not an opt-in to it.
    resumeV2: {
        enabled: process.env.RESUME_V2_ENABLED !== "false",
    },
    resumeReuse: {
        enabled: process.env.RESUME_REUSE_ENABLED !== "false",
        minAtsScore: Number(process.env.RESUME_REUSE_MIN_ATS_SCORE ?? 80),
        similarityThreshold: Number(process.env.RESUME_REUSE_SIMILARITY_THRESHOLD ?? 0.65),
    },
    pdfStorage: {
        mode: (
            process.env.PDF_STORAGE_MODE ||
            (process.env.NODE_ENV === "production" ? "blob" : "memory")
        ) as "memory" | "local" | "blob",
        access: (process.env.PDF_STORAGE_ACCESS || "public") as "public" | "private",
        localDir: process.env.PDF_STORAGE_LOCAL_DIR || ".storage/generated-pdfs",
        publicBaseUrl: process.env.PDF_STORAGE_PUBLIC_BASE_URL || "",
        enableStoredPdfFetch: process.env.PDF_STORAGE_ENABLE_FETCH !== "false",
    },
    resumeImportStorage: {
        mode: (
            process.env.RESUME_IMPORT_STORAGE_MODE ||
            (process.env.NODE_ENV === "production" ? "blob" : "memory")
        ) as "memory" | "blob",
        access: (process.env.RESUME_IMPORT_STORAGE_ACCESS || "public") as "public" | "private",
    },
    features: {
        inlineRewriteV2: process.env.FEATURE_INLINE_REWRITE_V2 !== "false",
        jdKeywordMatchHints: process.env.FEATURE_JD_KEYWORD_MATCH_HINTS !== "false",
        telegramSendPdfDocument: process.env.FEATURE_TELEGRAM_SEND_PDF_DOCUMENT !== "false",
        telegramAsyncProcessing: process.env.FEATURE_TELEGRAM_ASYNC_PROCESSING !== "false",
    },
};
