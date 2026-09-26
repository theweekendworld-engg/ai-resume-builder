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

export type ModelGateway = {
    /** Which vendor chat traffic actually goes to. For logs and the admin UI. */
    provider: "openai" | "openrouter" | "custom";
    apiKey: string;
    /** Undefined means OpenAI's own endpoint. */
    baseURL: string | undefined;
};

/**
 * Where chat requests go, and with whose key.
 *
 * ── Why OpenRouter gets its own variable ────────────────────────────────────
 *
 * The obvious shortcut is to overwrite OPENAI_API_KEY with the router key and
 * set a base URL. It works, and it plants a landmine: embeddings are not
 * routable — no gateway serves `text-embedding-3-large`, and the vector size is
 * baked into the Qdrant collection — so they must keep talking to OpenAI. One
 * shared variable means switching chat silently pulls the key out from under
 * retrieval, and the failure is a 401 from a subsystem nobody was touching.
 *
 * A named OPENROUTER_API_KEY makes the two independent. Set it and chat moves;
 * OPENAI_API_KEY keeps doing exactly one job, which is embeddings (and chat, if
 * no router key is present). Nothing has to be un-set to switch, and nothing
 * has to be restored to switch back — which is the whole point of treating the
 * model as a config decision.
 *
 * OPENAI_BASE_URL survives as the generic escape hatch for any other
 * OpenAI-compatible endpoint (Together, Groq, a self-hosted vLLM). The router
 * key wins when both are present, because naming a vendor is more specific
 * than naming a URL.
 *
 * Pure and env-injectable so the precedence is testable — reading
 * `process.env` at module load is not.
 */
export function resolveModelGateway(
    env: Record<string, string | undefined> = process.env,
): ModelGateway {
    const openrouterKey = (env.OPENROUTER_API_KEY || "").trim();
    if (openrouterKey) {
        return {
            provider: "openrouter",
            apiKey: openrouterKey,
            baseURL:
                (env.OPENROUTER_BASE_URL || "").trim() || "https://openrouter.ai/api/v1",
        };
    }

    const customBaseURL = (env.OPENAI_BASE_URL || "").trim();
    return {
        provider: customBaseURL ? "custom" : "openai",
        apiKey: (env.OPENAI_API_KEY || "") as string,
        baseURL: customBaseURL || undefined,
    };
}

const gateway = resolveModelGateway();

/**
 * Scout's default model id, spelled the way the configured gateway names it.
 * OpenRouter namespaces by lab (`openai/gpt-6-luna`); OpenAI does not. Getting
 * this wrong is a 404 at request time that reads like a bad key, so the
 * default follows the gateway instead of relying on someone setting
 * OPENAI_MODEL_SCOUT correctly.
 */
const scoutDefaultModel = gateway.provider === "openrouter" ? "openai/gpt-6-luna" : "gpt-6-luna";

export const config = {
    openai: {
        /**
         * The CHAT key — OPENROUTER_API_KEY if present, else OPENAI_API_KEY.
         * See `resolveModelGateway`. Embeddings do not use this; they read
         * `embedding.apiKey` below, which is always an OpenAI key.
         */
        apiKey: gateway.apiKey,
        /** 'openai' | 'openrouter' | 'custom'. Undefined baseURL means OpenAI. */
        provider: gateway.provider,
        /**
         * Set OPENROUTER_API_KEY and every task in the map below can name a
         * model from any lab OpenRouter fronts — GLM, DeepSeek, Qwen, Gemini,
         * Claude — with no call-site edits, because rule 1 already forced every
         * model id through this file.
         *
         * The point is not that OpenRouter is better. It is that "we'll switch
         * the model once we have traction" is only true if switching is a
         * config change, and until this existed it was a code change.
         */
        baseURL: gateway.baseURL,
        /**
         * Attribution headers OpenRouter uses for its public leaderboards.
         * Harmless anywhere else, and only sent when a baseURL is configured.
         */
        appUrl: process.env.OPENAI_GATEWAY_APP_URL || undefined,
        appTitle: process.env.OPENAI_GATEWAY_APP_TITLE || undefined,
        model: process.env.OPENAI_MODEL_GENERAL || process.env.OPENAI_MODEL || "gpt-5.6-luna",
        models: {
            general: process.env.OPENAI_MODEL_GENERAL || process.env.OPENAI_MODEL || "gpt-5.6-luna",
            jdParse: process.env.OPENAI_MODEL || "gpt-5.6-luna",
            paraphrase: process.env.OPENAI_MODEL_GENERAL || process.env.OPENAI_MODEL || "gpt-5.6-luna",
            atsScore: process.env.OPENAI_MODEL || "gpt-5.6-luna",
            assembly: process.env.OPENAI_MODEL_GENERAL || process.env.OPENAI_MODEL || "gpt-5.6-luna",
            claimValidation: process.env.OPENAI_MODEL || "gpt-5.6-luna",
            resumeParse: process.env.OPENAI_MODEL || "gpt-5.6-luna",
            // R1 per-task keys (ADR-6 / P0.4). No model id at a call site, ever:
            // every one of these is reachable only through `TaskKey` in src/lib/ai/tasks.ts.
            //
            // ── Why every task now names the same cheap model ──────────────
            //
            // These used to split into a small tier and a large tier. Measured
            // against real logged usage, that split cost ~15c per tailored
            // resume — $1.54 of COGS for the 10 free resumes a signup gets,
            // against a $5/month plan. gpt-5.6-luna is ~2c for the same run,
            // and unlike gpt-5/gpt-5-mini it survives the 11 Dec 2026 snapshot
            // shutdown; OpenAI's named replacements (terra, sol) cost 3-6x MORE
            // on output than what was here before.
            //
            // The tiering is not gone, it is unset: every key below still reads
            // its own env var first, so raising one task back to a stronger
            // model is one line in the environment and no deploy. What has NOT
            // been done is proving luna writes as well as gpt-5 did — the
            // Resume v2 eval corpus is the instrument for that, and it has not
            // been run against this model.
            winDraft: process.env.OPENAI_MODEL_WIN_DRAFT || process.env.OPENAI_MODEL || "gpt-5.6-luna",
            // Escalation tier: multi-PR groups and contexts over ~2k chars
            // (PRD 02 §4.2). Draft accept rate is the R1 north-star input, so
            // if any task earns a stronger model back first, it is this one.
            winDraftLarge: process.env.OPENAI_MODEL_WIN_DRAFT_LARGE || process.env.OPENAI_MODEL_GENERAL || "gpt-5.6-luna",
            winStructure: process.env.OPENAI_MODEL_WIN_STRUCTURE || process.env.OPENAI_MODEL || "gpt-5.6-luna",
            digestCompose: process.env.OPENAI_MODEL_DIGEST_COMPOSE || process.env.OPENAI_MODEL_GENERAL || process.env.OPENAI_MODEL || "gpt-5.6-luna",
            monthReview: process.env.OPENAI_MODEL_MONTH_REVIEW || process.env.OPENAI_MODEL_GENERAL || process.env.OPENAI_MODEL || "gpt-5.6-luna",
            packetThemes: process.env.OPENAI_MODEL_PACKET_THEMES || process.env.OPENAI_MODEL_GENERAL || process.env.OPENAI_MODEL || "gpt-5.6-luna",
            packetMap: process.env.OPENAI_MODEL_PACKET_MAP || process.env.OPENAI_MODEL || "gpt-5.6-luna",
            packetCompose: process.env.OPENAI_MODEL_PACKET_COMPOSE || process.env.OPENAI_MODEL_GENERAL || process.env.OPENAI_MODEL || "gpt-5.6-luna",
            interviewTurn: process.env.OPENAI_MODEL_INTERVIEW_TURN || process.env.OPENAI_MODEL_GENERAL || process.env.OPENAI_MODEL || "gpt-5.6-luna",
            interviewExtract: process.env.OPENAI_MODEL_INTERVIEW_EXTRACT || process.env.OPENAI_MODEL || "gpt-5.6-luna",
            radarNormalize: process.env.OPENAI_MODEL_RADAR_NORMALIZE || process.env.OPENAI_MODEL || "gpt-5.6-luna",
            radarReason: process.env.OPENAI_MODEL_RADAR_REASON || process.env.OPENAI_MODEL_GENERAL || process.env.OPENAI_MODEL || "gpt-5.6-luna",
            // Resume generation v2 — the artifact a candidate actually sends to
            // an employer, and so the three keys with the most to lose.
            //
            // The 7 Aug audit caught gpt-5-mini silently dropping the two
            // strongest lines on the page, which is why these were pinned to
            // the quality tier. That finding has NOT been retested on
            // gpt-5.6-luna, and it is the specific failure to watch for: not
            // fabrication (the numeric guard catches that) but omission, which
            // nothing automated catches. If resumes start reading thin, raise
            // OPENAI_MODEL_BULLET_WRITE first and re-run the eval corpus.
            postingRead: process.env.OPENAI_MODEL_POSTING_READ || process.env.OPENAI_MODEL_GENERAL || "gpt-5.6-luna",
            bulletSelect: process.env.OPENAI_MODEL_BULLET_SELECT || process.env.OPENAI_MODEL_GENERAL || "gpt-5.6-luna",
            bulletWrite: process.env.OPENAI_MODEL_BULLET_WRITE || process.env.OPENAI_MODEL_GENERAL || "gpt-5.6-luna",
            // Agentic assembly. Deliberately reads OPENAI_MODEL_GENERAL rather
            // than the cheap tier: this call makes every editorial judgement in
            // the document in one pass, and it is the one place where a weaker
            // model shows up as a worse resume rather than a slower one.
            resumeAssemble: process.env.OPENAI_MODEL_RESUME_ASSEMBLE || process.env.OPENAI_MODEL_GENERAL || "gpt-5.6-luna",
            // Scout. Defaults to gpt-6-luna ($0.10/$0.50 per 1M, launched
            // 2026-09-23) and deliberately does NOT read OPENAI_MODEL_GENERAL:
            // the resume path stays on the model its eval corpus measured,
            // while Scout — new, extraction-heavy, high-volume — takes the
            // cheaper one. One env var moves all five. See
            // docs/impl/06-scout-agent.md §3.
            scoutClassify: process.env.OPENAI_MODEL_SCOUT || scoutDefaultModel,
            scoutFitExplain: process.env.OPENAI_MODEL_SCOUT || scoutDefaultModel,
            scoutResearchExtract: process.env.OPENAI_MODEL_SCOUT || scoutDefaultModel,
            scoutDigest: process.env.OPENAI_MODEL_SCOUT || scoutDefaultModel,
            outreachDraft: process.env.OPENAI_MODEL_SCOUT || scoutDefaultModel,
            scoutFitMatch: process.env.OPENAI_MODEL_SCOUT || scoutDefaultModel,
            scoutPostingRead: process.env.OPENAI_MODEL_SCOUT || scoutDefaultModel,
        },
        /**
         * Embeddings keep their own credentials, and that is load-bearing.
         *
         * `baseURL` above moves CHAT to a gateway. Embeddings cannot follow:
         * gateways front chat models and none serve `text-embedding-3-large`,
         * and the vector size is baked into the Qdrant collection — so a
         * substituted model does not degrade retrieval, it breaks it.
         *
         * Note this reads OPENAI_API_KEY *directly* rather than
         * `config.openai.apiKey`, which is the whole reason the router gets its
         * own variable: setting OPENROUTER_API_KEY moves chat and leaves this
         * untouched. Nothing to remember, nothing to restore.
         *
         * OPENAI_EMBEDDING_API_KEY exists only for the rarer case of billing
         * embeddings to a different OpenAI account.
         */
        embedding: {
            model: embeddingModel,
            size: resolveEmbeddingSize(embeddingModel, process.env.OPENAI_EMBEDDING_SIZE),
            apiKey: (process.env.OPENAI_EMBEDDING_API_KEY ||
                process.env.OPENAI_API_KEY) as string,
            baseURL: process.env.OPENAI_EMBEDDING_BASE_URL || undefined,
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
        /*
         * Recalibrated for the coverage scale.
         *
         * `Resume.atsScore` now stores requirement coverage, and the two
         * scales do not overlap: the old keyword score reliably returned ~95,
         * while three live v2 runs scored 73, 66 and 61. At 80 the fast path
         * had stopped firing for anything v2 produced — every generation paid
         * the full cost and the full wait — and the ONLY rows that could still
         * match were pre-rebuild resumes carrying inflated scores. Reuse was
         * biased toward serving exactly the documents the rebuild replaced.
         *
         * 70 is "this resume answered most of what that posting asked for",
         * which is the question reuse is actually asking.
         */
        minCoverageScore: Number(process.env.RESUME_REUSE_MIN_COVERAGE_SCORE ?? 70),
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
