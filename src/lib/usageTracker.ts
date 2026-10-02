import OpenAI from 'openai';
import { Prisma } from '@prisma/client';
import { config } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { getCurrentBillingPeriod } from '@/lib/billingPeriod';
import { getUserTier } from '@/lib/entitlements';
import { costBudgetUsd, tokenBudget } from '@/lib/plans';

const realOpenAI = new OpenAI({
  apiKey: config.openai.apiKey,
  // SDK defaults are 600s and 2 retries: one hung call could hold a function
  // for most of its life (audit 2026-10-02).
  timeout: 90_000,
  maxRetries: 1,
  ...(config.openai.baseURL ? { baseURL: config.openai.baseURL } : {}),
});

/**
 * Embeddings do not follow chat to a gateway.
 *
 * Gateways front chat models; none of them serve `text-embedding-3-large`, and
 * the vector size is baked into the Qdrant collection, so a substituted model
 * does not degrade retrieval — it breaks it. This client therefore resolves its
 * own credentials, which default to OpenAI whatever `baseURL` says.
 *
 * When no override is set this is the same object as `realOpenAI`, so nothing
 * changes for a deployment that never configures a gateway.
 */
const usesSeparateEmbeddingCreds =
  config.openai.embedding.apiKey !== config.openai.apiKey ||
  Boolean(config.openai.baseURL) ||
  Boolean(config.openai.embedding.baseURL);

const realEmbeddingOpenAI = usesSeparateEmbeddingCreds
  ? new OpenAI({
      apiKey: config.openai.embedding.apiKey,
      timeout: 30_000,
      maxRetries: 1,
      ...(config.openai.embedding.baseURL
        ? { baseURL: config.openai.embedding.baseURL }
        : {}),
    })
  : realOpenAI;

let openai: OpenAI = realOpenAI;
let embeddingOpenAI: OpenAI = realEmbeddingOpenAI;

/**
 * Test seam. This module constructs its own OpenAI client, so it is the
 * boundary the embedding and chat mocks have to be injected at.
 *
 * Swapping the client rather than the `tracked*` functions is deliberate: the
 * usage-limit check, the cost calculation and the `ApiUsageLog` write are the
 * reason these wrappers exist, and mocking at the function level would skip
 * every one of them. Production behaviour is unchanged — the default is the
 * client this module has always built.
 */
export const __testing = {
  setOpenAIClient(client: OpenAI | null) {
    // Both clients, deliberately. Production splits chat from embeddings so a
    // chat gateway cannot break retrieval; a test that injects one double
    // still means "intercept every OpenAI call this module makes", and quietly
    // leaving embeddings pointed at the real API would turn a unit test into a
    // billable network call.
    openai = client ?? realOpenAI;
    embeddingOpenAI = client ?? realEmbeddingOpenAI;
  },
  reset() {
    openai = realOpenAI;
    embeddingOpenAI = realEmbeddingOpenAI;
  },
};

type OpenAiPrice = {
  inputPer1M: number;
  outputPer1M: number;
};

/**
 * List prices, USD per 1M tokens, checked against each vendor's own pricing
 * page on 9 Aug 2026. Gateway entries use OpenRouter's model ids because that
 * is the string the provider hands back and therefore the string that lands in
 * `ApiUsageLog.model`.
 *
 * Two things this table does NOT capture, so do not read it as a bill:
 *   - OpenRouter charges 5.5% on credit PURCHASES (5% crypto), not per token.
 *   - Indian buyers owe 18% GST under reverse charge on all of it, recoverable
 *     as input tax credit only if you are GST-registered.
 *
 * Cached-input rates are omitted deliberately. Measured across real usage,
 * input is ~7% of spend on this workload — reasoning is billed as output, and
 * output is where the money goes. A caching column would add precision to the
 * rounding error and none to the number anyone acts on.
 */
const OPENAI_PRICING_USD_PER_1M: Record<string, OpenAiPrice> = {
  // ── OpenAI. gpt-5*-2025-08-07 snapshots shut down 11 Dec 2026; the named
  // replacements (terra/sol) cost 3-6x more on output, luna costs less.
  'gpt-5.6-sol': { inputPer1M: 5, outputPer1M: 30 },
  'gpt-5.6-terra': { inputPer1M: 2, outputPer1M: 12 },
  'gpt-5.6-luna': { inputPer1M: 0.2, outputPer1M: 1.2 },
  // GPT-6, launched 2026-09-23. Standard tier; Batch/Flex run luna at half this.
  'gpt-6-sol': { inputPer1M: 2, outputPer1M: 10 },
  'gpt-6-luna': { inputPer1M: 0.1, outputPer1M: 0.5 },
  'gpt-5.5': { inputPer1M: 5, outputPer1M: 30 },
  'gpt-5.5-pro': { inputPer1M: 30, outputPer1M: 180 },
  'gpt-5.4': { inputPer1M: 2.5, outputPer1M: 15 },
  'gpt-5.4-mini': { inputPer1M: 0.75, outputPer1M: 4.5 },
  'gpt-5.4-nano': { inputPer1M: 0.2, outputPer1M: 1.25 },
  'gpt-5.1': { inputPer1M: 1.25, outputPer1M: 10 },
  'gpt-5-mini': { inputPer1M: 0.25, outputPer1M: 2 },
  'gpt-5-nano': { inputPer1M: 0.05, outputPer1M: 0.4 },
  'gpt-5': { inputPer1M: 1.25, outputPer1M: 10 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10 },
  'gpt-4.1-mini': { inputPer1M: 0.4, outputPer1M: 1.6 },
  'gpt-4.1': { inputPer1M: 2.5, outputPer1M: 10 },
  'text-embedding-3-small': { inputPer1M: 0.02, outputPer1M: 0 },
  'text-embedding-3-large': { inputPer1M: 0.13, outputPer1M: 0 },

  // ── Via an OpenAI-compatible gateway (config.openai.baseURL).
  'z-ai/glm-5.2': { inputPer1M: 0.07, outputPer1M: 0.22 },
  'deepseek/deepseek-v4-flash-0731': { inputPer1M: 0.09, outputPer1M: 0.18 },
  'qwen/qwen3.7-flash': { inputPer1M: 0.03, outputPer1M: 0.13 },
  'qwen/qwen3.8-max': { inputPer1M: 2, outputPer1M: 6 },
  'moonshotai/kimi-k3': { inputPer1M: 3, outputPer1M: 15 },
  'moonshotai/kimi-k2.7-code': { inputPer1M: 0.7, outputPer1M: 3.5 },
  'tencent/hy3': { inputPer1M: 0.132, outputPer1M: 0.528 },
  'google/gemini-3.6-flash': { inputPer1M: 1.5, outputPer1M: 7.5 },
  'google/gemini-3.5-flash-lite': { inputPer1M: 0.3, outputPer1M: 2.5 },
  'google/gemini-3.1-flash-lite': { inputPer1M: 0.25, outputPer1M: 1.5 },
  'anthropic/claude-sonnet-5': { inputPer1M: 2, outputPer1M: 10 },
  'anthropic/claude-haiku-4.5': { inputPer1M: 1, outputPer1M: 5 },
  'anthropic/claude-opus-5': { inputPer1M: 5, outputPer1M: 25 },
  'openai/gpt-5.6-luna': { inputPer1M: 0.2, outputPer1M: 1.2 },
  'openai/gpt-6-luna': { inputPer1M: 0.1, outputPer1M: 0.5 },
  'openai/gpt-6-sol': { inputPer1M: 2, outputPer1M: 10 },
  'openai/gpt-5.6-terra': { inputPer1M: 2, outputPer1M: 12 },
};

export type TrackableCall = {
  userId: string;
  sessionId?: string;
  operation: string;
  metadata?: Record<string, unknown>;
};

export type UsageLogInput = {
  userId: string;
  sessionId?: string;
  operation: string;
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  latencyMs?: number;
  status?: 'success' | 'failed';
  metadata?: Record<string, unknown>;
};

// Moved to its own module so this file can import `entitlements` for the
// per-tier token budget without creating a cycle. Re-exported because a dozen
// call sites import it from here.
export { getCurrentBillingPeriod };

function toTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Per-call cost precision.
 *
 * 2dp silently floors every sub-cent call to $0.00 — and under the Career OS
 * model most calls ARE sub-cent (win drafting ~$0.001, digest compose ~$0.002).
 * That would make the per-feature cost tripwires in PRD 08 §4.3 read zero for
 * exactly the high-volume operations they exist to watch. Store micro-dollars.
 */
function toMicroDollars(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/** Warn once per unknown model rather than on every call. */
const unpricedModels = new Set<string>();

/**
 * An unknown model priced at zero is worse than an unknown model that throws.
 *
 * The fallback here is still $0 — a pricing gap must never fail a user's
 * request — but it used to be SILENT, which meant the first thing a model
 * switch did was make every per-feature cost tripwire in PRD 08 §4.3 read zero.
 * Spend does not vanish because the table is stale; only the alarm does. So the
 * gap now announces itself, once, with the string you need to add.
 */
function resolveOpenAiPrice(model: string): OpenAiPrice {
  const normalized = (model || '').toLowerCase().trim();
  const price = OPENAI_PRICING_USD_PER_1M[normalized];
  if (price) return price;

  if (normalized && !unpricedModels.has(normalized)) {
    unpricedModels.add(normalized);
    console.warn(
      `[usage] no price for model "${normalized}" — cost is being logged as $0. ` +
        `Add it to OPENAI_PRICING_USD_PER_1M in src/lib/usageTracker.ts.`,
    );
  }
  return { inputPer1M: 0, outputPer1M: 0 };
}

/** Exported for the test that keeps the two model maps in sync. */
export const __pricing = {
  has(model: string): boolean {
    return Boolean(OPENAI_PRICING_USD_PER_1M[(model || '').toLowerCase().trim()]);
  },
};

export function calculateOpenAiCostUsd(params: {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}): number {
  const price = resolveOpenAiPrice(params.model);
  const inputTokens = Math.max(0, params.inputTokens ?? 0);
  const outputTokens = Math.max(0, params.outputTokens ?? 0);
  const inputCost = (inputTokens / 1_000_000) * price.inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * price.outputPer1M;
  return toMicroDollars(inputCost + outputCost);
}

export async function logUsageEvent(input: UsageLogInput): Promise<void> {
  const totalTokens = Math.max(0, input.totalTokens ?? ((input.inputTokens ?? 0) + (input.outputTokens ?? 0)));

  await prisma.apiUsageLog.create({
    data: {
      userId: input.userId,
      sessionId: input.sessionId,
      operation: input.operation,
      provider: input.provider,
      model: input.model,
      inputTokens: Math.max(0, input.inputTokens ?? 0),
      outputTokens: Math.max(0, input.outputTokens ?? 0),
      totalTokens,
      costUsd: Math.max(0, input.costUsd ?? 0),
      latencyMs: Math.max(0, input.latencyMs ?? 0),
      status: input.status ?? 'success',
      metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : undefined,
    },
  });
}

/**
 * The backstop, per tier.
 *
 * One global number gave a paying Search customer the same ceiling as an
 * anonymous free account — either too tight to sell or too loose to protect
 * us, and it could not be both. `USAGE_MAX_MONTHLY_TOKENS_PER_USER` is still
 * honoured as a hard cap ACROSS all tiers, so an existing deployment that set
 * it keeps its ceiling.
 *
 * This is a cost and abuse backstop, not a product limit. A user should meet
 * their feature quota — ten resumes, three Month in Reviews — long before they
 * meet this, and if they do not, the tier's budget is set wrong.
 */
async function budgetFor(userId: string): Promise<{ tokens: number; costUsd: number }> {
  const tier = await getUserTier(userId);
  const globalTokens = process.env.USAGE_MAX_MONTHLY_TOKENS_PER_USER;
  const globalCost = process.env.USAGE_MAX_MONTHLY_COST_USD_PER_USER;
  return {
    tokens: globalTokens ? Math.min(tokenBudget(tier), Number(globalTokens)) : tokenBudget(tier),
    costUsd: globalCost ? Math.min(costBudgetUsd(tier), Number(globalCost)) : costBudgetUsd(tier),
  };
}

/** Thrown when a user has spent their monthly model budget. Callers can say so plainly. */
export class UsageLimitError extends Error {
  readonly code = 'usage_limit' as const;
  constructor(message: string) {
    super(message);
    this.name = 'UsageLimitError';
  }
}

/** Anonymous /score traffic is pooled under one id; it gets its own monthly ceiling. */
const ANON_ID = 'anon';
function anonBudgetUsd(): number {
  const value = Number(process.env.ANON_MONTHLY_COST_USD);
  return Number.isFinite(value) && value > 0 ? value : 25;
}

/** Live totals, cached briefly per instance: a cap must move with spend. */
const USAGE_CACHE_MS = 15_000;
const usageCache = new Map<string, { at: number; totalTokens: number; totalCostUsd: number }>();

/**
 * Always the live sum of ApiUsageLog for the period, every status included.
 *
 * It used to prefer the stored UserUsageSummary, which only admin pages
 * refresh, so the cap froze for any user an admin had looked at; and it
 * counted only successful calls, so failed calls (which still bill tokens)
 * were free (launch audit, 2026-10-02).
 */
async function getCurrentPeriodUsage(userId: string): Promise<{ totalTokens: number; totalCostUsd: number }> {
  const cached = usageCache.get(userId);
  if (cached && Date.now() - cached.at < USAGE_CACHE_MS) return cached;

  const { start, end } = getCurrentBillingPeriod();
  const aggregate = await prisma.apiUsageLog.aggregate({
    where: { userId, createdAt: { gte: start, lt: end } },
    _sum: { totalTokens: true, costUsd: true },
  });
  const usage = {
    at: Date.now(),
    totalTokens: aggregate._sum.totalTokens ?? 0,
    totalCostUsd: aggregate._sum.costUsd ?? 0,
  };
  usageCache.set(userId, usage);
  if (usageCache.size > 5_000) usageCache.delete(usageCache.keys().next().value as string);
  return usage;
}

/**
 * The per-user monthly backstop, in front of every model call
 * (`generateStructured`, the resume loop, and the tracked wrappers). Not a
 * product limit: feature quotas bind long before this. Infrastructure errors
 * fail open (logged); a limit reached throws UsageLimitError.
 */
export async function enforceUsageLimit(userId: string): Promise<void> {
  let usage: { totalTokens: number; totalCostUsd: number };
  let tokenLimit: number;
  let costLimit: number;
  try {
    if (userId === ANON_ID) {
      tokenLimit = Number.POSITIVE_INFINITY;
      costLimit = anonBudgetUsd();
    } else {
      ({ tokens: tokenLimit, costUsd: costLimit } = await budgetFor(userId));
    }
    const tokenCapped = Number.isFinite(tokenLimit) && tokenLimit > 0;
    const costCapped = Number.isFinite(costLimit) && costLimit > 0;
    if (!tokenCapped && !costCapped) return;
    usage = await getCurrentPeriodUsage(userId);
  } catch (error) {
    console.error('[usage] budget check unavailable; allowing', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  if (Number.isFinite(tokenLimit) && tokenLimit > 0 && usage.totalTokens >= tokenLimit) {
    throw new UsageLimitError('You have used this month\'s AI allowance. It resets on the 1st, or upgrade for more.');
  }
  if (Number.isFinite(costLimit) && costLimit > 0 && usage.totalCostUsd >= costLimit) {
    throw new UsageLimitError(userId === ANON_ID
      ? 'The free check is busy right now. Sign up to keep going.'
      : 'You have used this month\'s AI allowance. It resets on the 1st, or upgrade for more.');
  }
}

export const __usageTesting = {
  clearCache() {
    usageCache.clear();
  },
};

type ResponseCreateParamsNonStreaming = Parameters<OpenAI['responses']['create']>[0] & { stream?: false };

export async function trackedResponsesCreate(
  params: ResponseCreateParamsNonStreaming,
  tracking: TrackableCall
): Promise<Awaited<ReturnType<OpenAI['responses']['create']>>> {
  await enforceUsageLimit(tracking.userId);

  const start = Date.now();
  try {
    const result = await openai.responses.create({ ...params, stream: false });
    const latencyMs = Date.now() - start;
    const usage = result.usage;
    const inputTokens = usage?.input_tokens ?? 0;
    const outputTokens = usage?.output_tokens ?? 0;

    await logUsageEvent({
      userId: tracking.userId,
      sessionId: tracking.sessionId,
      operation: tracking.operation,
      provider: 'openai',
      model: String(params.model ?? ''),
      inputTokens,
      outputTokens,
      totalTokens: usage?.total_tokens ?? inputTokens + outputTokens,
      costUsd: calculateOpenAiCostUsd({
        model: String(params.model ?? ''),
        inputTokens,
        outputTokens,
      }),
      latencyMs,
      status: 'success',
      metadata: tracking.metadata,
    });

    return result as Awaited<ReturnType<OpenAI['responses']['create']>>;
  } catch (error: unknown) {
    await logUsageEvent({
      userId: tracking.userId,
      sessionId: tracking.sessionId,
      operation: tracking.operation,
      provider: 'openai',
      model: String(params.model ?? ''),
      latencyMs: Date.now() - start,
      status: 'failed',
      metadata: {
        ...(tracking.metadata ?? {}),
        error: error instanceof Error ? error.message : 'Unknown OpenAI error',
      },
    });
    throw error;
  }
}

export async function trackedChatCompletion(
  params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
  tracking: TrackableCall
) {
  await enforceUsageLimit(tracking.userId);

  const start = Date.now();
  try {
    const result = await openai.chat.completions.create(params);
    const latencyMs = Date.now() - start;
    const inputTokens = result.usage?.prompt_tokens ?? 0;
    const outputTokens = result.usage?.completion_tokens ?? 0;

    await logUsageEvent({
      userId: tracking.userId,
      sessionId: tracking.sessionId,
      operation: tracking.operation,
      provider: 'openai',
      model: String(params.model),
      inputTokens,
      outputTokens,
      totalTokens: result.usage?.total_tokens ?? (inputTokens + outputTokens),
      costUsd: calculateOpenAiCostUsd({
        model: String(params.model),
        inputTokens,
        outputTokens,
      }),
      latencyMs,
      status: 'success',
      metadata: tracking.metadata,
    });

    return result;
  } catch (error: unknown) {
    await logUsageEvent({
      userId: tracking.userId,
      sessionId: tracking.sessionId,
      operation: tracking.operation,
      provider: 'openai',
      model: String(params.model),
      latencyMs: Date.now() - start,
      status: 'failed',
      metadata: {
        ...(tracking.metadata ?? {}),
        error: error instanceof Error ? error.message : 'Unknown OpenAI error',
      },
    });
    throw error;
  }
}

export async function trackedEmbeddingCreate(
  params: OpenAI.EmbeddingCreateParams,
  tracking: TrackableCall
) {
  await enforceUsageLimit(tracking.userId);

  const start = Date.now();
  try {
    const result = await embeddingOpenAI.embeddings.create(params);
    const inputTokens = result.usage?.prompt_tokens ?? 0;

    await logUsageEvent({
      userId: tracking.userId,
      sessionId: tracking.sessionId,
      operation: tracking.operation,
      provider: 'openai',
      model: String(params.model),
      inputTokens,
      outputTokens: 0,
      totalTokens: inputTokens,
      costUsd: calculateOpenAiCostUsd({
        model: String(params.model),
        inputTokens,
        outputTokens: 0,
      }),
      latencyMs: Date.now() - start,
      status: 'success',
      metadata: tracking.metadata,
    });

    return result;
  } catch (error: unknown) {
    await logUsageEvent({
      userId: tracking.userId,
      sessionId: tracking.sessionId,
      operation: tracking.operation,
      provider: 'openai',
      model: String(params.model),
      latencyMs: Date.now() - start,
      status: 'failed',
      metadata: {
        ...(tracking.metadata ?? {}),
        error: error instanceof Error ? error.message : 'Unknown embedding error',
      },
    });
    throw error;
  }
}

type OperationSummary = {
  calls: number;
  tokens: number;
  costUsd: number;
  avgLatencyMs: number;
};

function summarizeLogs(logs: Array<{
  operation: string;
  totalTokens: number;
  costUsd: number;
  latencyMs: number;
}>): Record<string, OperationSummary> {
  const buckets = new Map<string, { calls: number; tokens: number; costUsd: number; latencyMs: number }>();
  for (const log of logs) {
    const current = buckets.get(log.operation) ?? { calls: 0, tokens: 0, costUsd: 0, latencyMs: 0 };
    current.calls += 1;
    current.tokens += log.totalTokens;
    current.costUsd += log.costUsd;
    current.latencyMs += log.latencyMs;
    buckets.set(log.operation, current);
  }

  const result: Record<string, OperationSummary> = {};
  for (const [operation, entry] of buckets.entries()) {
    result[operation] = {
      calls: entry.calls,
      tokens: entry.tokens,
      costUsd: Math.round(entry.costUsd * 10000) / 10000,
      avgLatencyMs: entry.calls > 0 ? Math.round(entry.latencyMs / entry.calls) : 0,
    };
  }

  return result;
}

export async function upsertUserUsageSummary(params: {
  userId: string;
  periodStart?: Date;
  periodEnd?: Date;
}): Promise<void> {
  const period = params.periodStart && params.periodEnd
    ? { start: params.periodStart, end: params.periodEnd }
    : getCurrentBillingPeriod();

  const logs = await prisma.apiUsageLog.findMany({
    where: {
      userId: params.userId,
      createdAt: { gte: period.start, lt: period.end },
      status: 'success',
    },
    select: {
      operation: true,
      totalTokens: true,
      costUsd: true,
      latencyMs: true,
    },
  });

  const totalTokens = logs.reduce((acc, log) => acc + log.totalTokens, 0);
  const totalCostUsd = toTwoDecimals(logs.reduce((acc, log) => acc + log.costUsd, 0));
  const totalGenerations = logs.filter((log) => log.operation === 'resume_assembly').length;
  const totalPdfs = logs.filter((log) => log.operation === 'pdf_storage').length;
  const breakdown = summarizeLogs(logs);

  await prisma.userUsageSummary.upsert({
    where: {
      userId_periodStart: {
        userId: params.userId,
        periodStart: period.start,
      },
    },
    update: {
      periodEnd: period.end,
      totalTokens,
      totalCostUsd,
      totalGenerations,
      totalPdfs,
      breakdown: breakdown as Prisma.InputJsonValue,
    },
    create: {
      userId: params.userId,
      periodStart: period.start,
      periodEnd: period.end,
      totalTokens,
      totalCostUsd,
      totalGenerations,
      totalPdfs,
      breakdown: breakdown as Prisma.InputJsonValue,
    },
  });
}

export async function upsertAllUserUsageSummaries(params?: {
  periodStart?: Date;
  periodEnd?: Date;
}): Promise<number> {
  const period = params?.periodStart && params?.periodEnd
    ? { start: params.periodStart, end: params.periodEnd }
    : getCurrentBillingPeriod();

  const users = await prisma.apiUsageLog.findMany({
    where: { createdAt: { gte: period.start, lt: period.end } },
    distinct: ['userId'],
    select: { userId: true },
  });

  for (const user of users) {
    await upsertUserUsageSummary({
      userId: user.userId,
      periodStart: period.start,
      periodEnd: period.end,
    });
  }

  return users.length;
}
