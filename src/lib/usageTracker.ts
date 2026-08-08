import OpenAI from 'openai';
import { Prisma } from '@prisma/client';
import { config } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { getCurrentBillingPeriod } from '@/lib/billingPeriod';
import { getUserTier } from '@/lib/entitlements';
import { costBudgetUsd, tokenBudget } from '@/lib/plans';

const realOpenAI = new OpenAI({ apiKey: config.openai.apiKey });
let openai: OpenAI = realOpenAI;

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
    openai = client ?? realOpenAI;
  },
  reset() {
    openai = realOpenAI;
  },
};

type OpenAiPrice = {
  inputPer1M: number;
  outputPer1M: number;
};

const OPENAI_PRICING_USD_PER_1M: Record<string, OpenAiPrice> = {
  'gpt-5-mini': { inputPer1M: 0.25, outputPer1M: 2 },
  'gpt-5': { inputPer1M: 1.25, outputPer1M: 10 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10 },
  'gpt-4.1-mini': { inputPer1M: 0.4, outputPer1M: 1.6 },
  'gpt-4.1': { inputPer1M: 2.5, outputPer1M: 10 },
  'text-embedding-3-small': { inputPer1M: 0.02, outputPer1M: 0 },
  'text-embedding-3-large': { inputPer1M: 0.13, outputPer1M: 0 },
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

function resolveOpenAiPrice(model: string): OpenAiPrice {
  const normalized = (model || '').toLowerCase().trim();
  return OPENAI_PRICING_USD_PER_1M[normalized] ?? { inputPer1M: 0, outputPer1M: 0 };
}

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

async function getCurrentPeriodUsage(userId: string): Promise<{ totalTokens: number; totalCostUsd: number }> {
  const { start, end } = getCurrentBillingPeriod();

  const summary = await prisma.userUsageSummary.findUnique({
    where: {
      userId_periodStart: {
        userId,
        periodStart: start,
      },
    },
    select: {
      totalTokens: true,
      totalCostUsd: true,
    },
  });

  if (summary) {
    return {
      totalTokens: summary.totalTokens,
      totalCostUsd: summary.totalCostUsd,
    };
  }

  const aggregate = await prisma.apiUsageLog.aggregate({
    where: {
      userId,
      createdAt: { gte: start, lt: end },
      status: 'success',
    },
    _sum: {
      totalTokens: true,
      costUsd: true,
    },
  });

  return {
    totalTokens: aggregate._sum.totalTokens ?? 0,
    totalCostUsd: aggregate._sum.costUsd ?? 0,
  };
}

export async function enforceUsageLimit(userId: string): Promise<void> {
  const { tokens: tokenLimit, costUsd: costLimit } = await budgetFor(userId);
  const tokenCapped = Number.isFinite(tokenLimit) && tokenLimit > 0;
  const costCapped = Number.isFinite(costLimit) && costLimit > 0;
  if (!tokenCapped && !costCapped) return;

  const usage = await getCurrentPeriodUsage(userId);

  if (tokenCapped && usage.totalTokens >= tokenLimit) {
    throw new Error('Monthly token usage limit reached for your account');
  }

  if (costCapped && usage.totalCostUsd >= costLimit) {
    throw new Error('Monthly usage cost limit reached for your account');
  }
}

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
    const result = await openai.embeddings.create(params);
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
