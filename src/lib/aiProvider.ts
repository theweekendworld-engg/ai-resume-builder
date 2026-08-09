import { createOpenAI } from '@ai-sdk/openai';
import { config } from '@/lib/config';

/**
 * The one place a model handle is constructed.
 *
 * ── Why this file can point somewhere other than OpenAI ─────────────────────
 *
 * Measured against real logged usage, one tailored resume costs ~15c on the
 * current gpt-5 defaults and under half a cent on GLM 5.2 or DeepSeek V4-Flash.
 * At a $5/mo plan with 10 free resumes, the free tier alone is $1.54 of COGS
 * per signup — which is a pricing problem long before it is an infra problem.
 *
 * Whether to take that trade is a business call and it is genuinely reversible:
 * swap the env var back and the next request goes to OpenAI. What was NOT
 * reversible was the code — every model resolved through a provider hardwired
 * to one vendor, so "switch later" quietly meant "rewrite later". Now it means
 * what it says.
 *
 * ── The Responses vs Chat Completions detail ────────────────────────────────
 *
 * Calling the provider directly — `provider(model)` — selects OpenAI's
 * Responses API. Gateways like OpenRouter implement Chat Completions and not
 * Responses, so the same call against a gateway 404s at request time, which is
 * exactly the kind of failure that looks like a bad API key. When a baseURL is
 * configured we therefore ask for the chat model explicitly.
 *
 * Consequence worth knowing before you flip it: `reasoningEffort` is passed as
 * `providerOptions.openai`, which OpenAI's own models honour and most others
 * ignore. Since output tokens are ~93% of the bill and reasoning is billed as
 * output, a model that ignores the knob may cost more than this table implies.
 * Measure the first bill, do not assume it.
 */

const baseURL = config.openai.baseURL;

const gatewayHeaders: Record<string, string> = {};
if (config.openai.appUrl) gatewayHeaders['HTTP-Referer'] = config.openai.appUrl;
if (config.openai.appTitle) gatewayHeaders['X-Title'] = config.openai.appTitle;

const provider = createOpenAI({
  apiKey: config.openai.apiKey,
  ...(baseURL ? { baseURL } : {}),
  ...(baseURL && Object.keys(gatewayHeaders).length ? { headers: gatewayHeaders } : {}),
});

/** True when pointed at a third-party gateway rather than OpenAI itself. */
export function isGatewayConfigured(): boolean {
  return Boolean(baseURL);
}

export function aiOpenAI(model: string) {
  // See the note above: Responses API on OpenAI, Chat Completions on a gateway.
  return baseURL ? provider.chat(model) : provider(model);
}
