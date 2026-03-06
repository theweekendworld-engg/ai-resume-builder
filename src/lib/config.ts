export const config = {
    openai: {
        apiKey: process.env.OPENAI_API_KEY as string,
        model: process.env.OPENAI_MODEL_GENERAL || process.env.OPENAI_MODEL || "gpt-4.1-mini",
        models: {
            general: process.env.OPENAI_MODEL_GENERAL || process.env.OPENAI_MODEL || "gpt-4.1-mini",
            jdParse: process.env.OPENAI_MODEL_JD_PARSE || "gpt-4.1-mini",
            paraphrase: process.env.OPENAI_MODEL_PARAPHRASE || "gpt-4.1",
            atsScore: process.env.OPENAI_MODEL_ATS_SCORE || "gpt-4.1-mini",
            assembly: process.env.OPENAI_MODEL_ASSEMBLY || "gpt-4.1",
            claimValidation: process.env.OPENAI_MODEL_CLAIM_VALIDATION || "gpt-4.1-mini",
            resumeParse: process.env.OPENAI_MODEL_RESUME_PARSE || "gpt-4.1-mini",
        },
    },
    app: {
        url: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    },
    resumeReuse: {
        enabled: process.env.RESUME_REUSE_ENABLED !== "false",
        minAtsScore: Number(process.env.RESUME_REUSE_MIN_ATS_SCORE ?? 80),
        similarityThreshold: Number(process.env.RESUME_REUSE_SIMILARITY_THRESHOLD ?? 0.65),
    },
    pdfStorage: {
        mode: (process.env.PDF_STORAGE_MODE || "local") as "local" | "blob",
        localDir: process.env.PDF_STORAGE_LOCAL_DIR || ".storage/generated-pdfs",
        publicBaseUrl: process.env.PDF_STORAGE_PUBLIC_BASE_URL || "",
        enableStoredPdfFetch: process.env.PDF_STORAGE_ENABLE_FETCH !== "false",
    },
};
