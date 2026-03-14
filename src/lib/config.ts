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
        },
        embedding: {
            model: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-large",
            size: Number(process.env.OPENAI_EMBEDDING_SIZE || 3072),
        },
    },
    app: {
        url: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    },
    qdrant: {
        url: process.env.QDRANT_URL as string,
        apiKey: process.env.QDRANT_API_KEY || undefined,
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
        localDir: process.env.PDF_STORAGE_LOCAL_DIR || ".storage/generated-pdfs",
        publicBaseUrl: process.env.PDF_STORAGE_PUBLIC_BASE_URL || "",
        enableStoredPdfFetch: process.env.PDF_STORAGE_ENABLE_FETCH !== "false",
    },
    features: {
        inlineRewriteV2: process.env.FEATURE_INLINE_REWRITE_V2 !== "false",
        jdKeywordMatchHints: process.env.FEATURE_JD_KEYWORD_MATCH_HINTS !== "false",
        telegramSendPdfDocument: process.env.FEATURE_TELEGRAM_SEND_PDF_DOCUMENT !== "false",
        telegramAsyncProcessing: process.env.FEATURE_TELEGRAM_ASYNC_PROCESSING !== "false",
    },
};
