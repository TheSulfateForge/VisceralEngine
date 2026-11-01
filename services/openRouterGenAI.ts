// ============================================================================
// services/openRouterGenAI.ts — v1.49 OpenRouter transport
// ============================================================================
//
// A drop-in stand-in for the slice of the @google/genai SDK that VRE uses:
//
//   ai.models.generateContent({ model, contents, config })
//   ai.chats.create({ model, history, config }).sendMessageStream({ message })
//
// Every service already talks to the model through those two calls, so
// swapping the object behind `GeminiClient.ai` moves the WHOLE engine to
// OpenRouter without touching a single call site. Gemini-only config keys
// (safetySettings, thinkingConfig, cachedContent, imageConfig) are ignored.
//
// ROUTING
//   provider.only   = the allowed provider slugs (config/aiProvider.ts)
//   provider.order  = those providers ranked by TOTAL cost for VRE's real
//                     input:output token mix, from OpenRouter's live
//                     per-endpoint price list. OpenRouter tries them in order
//                     and falls back down the list; `only` keeps every
//                     fallback inside the allowed set.
//   The guardrail on the API key enforces the same model + providers
//   server-side, so a bug here can narrow routing but never widen it.
//
// STRUCTURED OUTPUT
//   Gemini `responseSchema` is converted to JSON Schema and sent as
//   response_format json_schema. If no allowed endpoint accepts it, the call
//   is retried once as json_object with the schema written into the system
//   message, and that model stays in json_object mode for the session.

import type { GoogleGenAI } from '@google/genai';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

/** Used for cost ranking until enough real usage has been recorded. */
export const DEFAULT_INPUT_OUTPUT_RATIO = 10;
const RATIO_MIN_COMPLETION_TOKENS = 5000;
const LS_USAGE = 'visceral_openrouter_usage';
const ENDPOINT_TTL_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Gemini schema → JSON Schema
// ---------------------------------------------------------------------------

/**
 * Gemini schemas use upper-case `Type` enum values ('OBJECT', 'STRING', …),
 * a `nullable` flag, and `propertyOrdering`. JSON Schema wants lower-case
 * types and expresses nullability as a type union.
 */
export const geminiSchemaToJsonSchema = (schema: unknown): unknown => {
    if (Array.isArray(schema)) return schema.map(geminiSchemaToJsonSchema);
    if (!schema || typeof schema !== 'object') return schema;

    const src = schema as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(src)) {
        if (key === 'nullable' || key === 'propertyOrdering') continue;
        if (key === 'type' && typeof value === 'string') {
            out.type = value.toLowerCase();
        } else if (key === 'properties' && value && typeof value === 'object') {
            const props: Record<string, unknown> = {};
            for (const [name, sub] of Object.entries(value as Record<string, unknown>)) {
                props[name] = geminiSchemaToJsonSchema(sub);
            }
            out.properties = props;
        } else if (key === 'items' || key === 'anyOf' || key === 'oneOf' || key === 'allOf') {
            out[key] = geminiSchemaToJsonSchema(value);
        } else {
            out[key] = value;
        }
    }
    if (src.nullable === true && typeof out.type === 'string') {
        out.type = [out.type, 'null'];
    }
    return out;
};

// ---------------------------------------------------------------------------
// Usage tracking → input:output ratio for cost ranking
// ---------------------------------------------------------------------------

interface UsageTotals { prompt: number; completion: number }

const readUsage = (): UsageTotals => {
    try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_USAGE) : null;
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed && typeof parsed.prompt === 'number' && typeof parsed.completion === 'number') return parsed;
    } catch { /* ignore */ }
    return { prompt: 0, completion: 0 };
};

export const recordOpenRouterUsage = (promptTokens: number, completionTokens: number): void => {
    if (!(promptTokens > 0) && !(completionTokens > 0)) return;
    const u = readUsage();
    u.prompt += Math.max(0, promptTokens || 0);
    u.completion += Math.max(0, completionTokens || 0);
    try { localStorage.setItem(LS_USAGE, JSON.stringify(u)); } catch { /* ignore */ }
};

/** Input tokens per output token, measured from this browser's own play. */
export const getInputOutputRatio = (): number => {
    const u = readUsage();
    if (u.completion < RATIO_MIN_COMPLETION_TOKENS) return DEFAULT_INPUT_OUTPUT_RATIO;
    return Math.min(200, Math.max(1, u.prompt / u.completion));
};

// ---------------------------------------------------------------------------
// Provider ranking by total cost
// ---------------------------------------------------------------------------

export interface RawEndpoint {
    provider_name?: string;
    tag?: string;
    pricing?: { prompt?: string | number; completion?: string | number };
    supported_parameters?: string[];
}

export interface ProviderRanking {
    /** Allowed provider slugs, cheapest total cost first. */
    order: string[];
    /** Allowed providers with an endpoint that accepts json_schema. */
    structuredProviders: string[];
}

const slugOf = (ep: RawEndpoint): string => {
    const fromTag = (ep.tag ?? '').split('/')[0].trim().toLowerCase();
    if (fromTag) return fromTag;
    return (ep.provider_name ?? '').trim().toLowerCase().replace(/\s+/g, '-');
};

const perToken = (v: unknown): number => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
    return Number.isFinite(n) && n >= 0 ? n : Number.POSITIVE_INFINITY;
};

/**
 * Rank the allowed providers by the cost of one "average VRE call":
 * `ratio` input tokens + 1 output token. A provider with several endpoints
 * (Wafer and Sail Research each list two) is ranked by its cheapest one.
 * Allowed providers with no listed endpoint keep their static position at
 * the end, so OpenRouter can still fall back to them.
 */
export const rankProviders = (
    endpoints: RawEndpoint[],
    allowed: readonly string[],
    ratio: number,
): ProviderRanking => {
    const allowedSet = new Set(allowed);
    const best = new Map<string, number>();
    const structured = new Set<string>();

    for (const ep of endpoints) {
        const slug = slugOf(ep);
        if (!allowedSet.has(slug)) continue;
        const cost = perToken(ep.pricing?.prompt) * ratio + perToken(ep.pricing?.completion);
        if (!best.has(slug) || cost < (best.get(slug) as number)) best.set(slug, cost);
        const params = ep.supported_parameters ?? [];
        if (params.includes('structured_outputs')) structured.add(slug);
    }

    const priced = [...best.entries()]
        .filter(([, c]) => Number.isFinite(c))
        .sort((a, b) => a[1] - b[1])
        .map(([s]) => s);
    const rest = allowed.filter(s => !priced.includes(s));
    return { order: [...priced, ...rest], structuredProviders: allowed.filter(s => structured.has(s)) };
};

// ---------------------------------------------------------------------------
// Content conversion (Gemini shapes → chat messages)
// ---------------------------------------------------------------------------

interface ChatMessageOut { role: 'system' | 'user' | 'assistant'; content: string }

const partsText = (parts: unknown): string =>
    Array.isArray(parts)
        ? parts.map(p => (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string')
            ? (p as { text: string }).text : '').join('')
        : '';

const contentToText = (c: unknown): string => {
    if (typeof c === 'string') return c;
    if (c && typeof c === 'object' && 'parts' in c) return partsText((c as { parts: unknown }).parts);
    return '';
};

/** Gemini `contents` (string | Content | Content[]) → chat messages. */
export const contentsToMessages = (contents: unknown): ChatMessageOut[] => {
    if (Array.isArray(contents)) {
        return contents.map(c => {
            const role = (c && typeof c === 'object' && (c as { role?: string }).role === 'model') ? 'assistant' : 'user';
            return { role, content: contentToText(c) } as ChatMessageOut;
        }).filter(m => m.content.length > 0);
    }
    const text = contentToText(contents);
    return text ? [{ role: 'user', content: text }] : [];
};

const systemText = (si: unknown): string => {
    if (typeof si === 'string') return si;
    return contentToText(si);
};

// ---------------------------------------------------------------------------
// Response shape (the parts of GenerateContentResponse VRE reads)
// ---------------------------------------------------------------------------

export interface ShimResponse {
    text: string;
    candidates: Array<{ finishReason?: string; content: { parts: Array<{ text: string }> } }>;
    usageMetadata?: {
        promptTokenCount: number;
        candidatesTokenCount: number;
        cachedContentTokenCount: number;
        thoughtsTokenCount: number;
        totalTokenCount: number;
    };
}

interface OrUsage {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
}

const mapFinish = (r: unknown): string | undefined => {
    if (typeof r !== 'string' || !r) return undefined;
    if (r === 'stop') return 'STOP';
    if (r === 'length') return 'MAX_TOKENS';
    if (r === 'content_filter') return 'SAFETY';
    return r.toUpperCase();
};

const mapUsage = (u: OrUsage | undefined): ShimResponse['usageMetadata'] => {
    if (!u) return undefined;
    return {
        promptTokenCount: u.prompt_tokens ?? 0,
        candidatesTokenCount: u.completion_tokens ?? 0,
        cachedContentTokenCount: u.prompt_tokens_details?.cached_tokens ?? 0,
        thoughtsTokenCount: u.completion_tokens_details?.reasoning_tokens ?? 0,
        totalTokenCount: u.total_tokens ?? ((u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0)),
    };
};

const makeResponse = (text: string, finishReason?: string, usage?: ShimResponse['usageMetadata']): ShimResponse => ({
    text,
    candidates: [{ finishReason, content: { parts: [{ text }] } }],
    usageMetadata: usage,
});

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

type GenConfig = Record<string, unknown>;

export interface OpenRouterGenAIOptions {
    apiKey: string;
    allowedProviders: readonly string[];
    fetchImpl?: typeof fetch;
}

/** Models where json_schema was refused this session → use json_object. */
const schemaUnsupported = new Set<string>();

export class OpenRouterGenAI {
    private readonly apiKey: string;
    private readonly allowed: readonly string[];
    private readonly fetchImpl: typeof fetch;
    private static endpointCache = new Map<string, { at: number; endpoints: RawEndpoint[] }>();

    constructor(opts: OpenRouterGenAIOptions) {
        if (!opts.apiKey) throw new Error('OpenRouter API key is required');
        this.apiKey = opts.apiKey;
        this.allowed = opts.allowedProviders;
        this.fetchImpl = opts.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    }

    /** Present it to the rest of the engine as the Google SDK object. */
    asGoogleGenAI(): GoogleGenAI {
        return this as unknown as GoogleGenAI;
    }

    // ---- public SDK-shaped surface ----------------------------------------

    public readonly models = {
        generateContent: async (req: { model: string; contents: unknown; config?: GenConfig }): Promise<ShimResponse> => {
            const config = req.config ?? {};
            const messages = this.withSystem(systemText(config.systemInstruction), contentsToMessages(req.contents));
            return this.complete(req.model, messages, config);
        },
    };

    public readonly chats = {
        create: (req: { model: string; history?: unknown; config?: GenConfig }) => {
            const config = req.config ?? {};
            const base = this.withSystem(
                systemText(config.systemInstruction),
                contentsToMessages(req.history ?? []),
            );
            return {
                sendMessageStream: async ({ message }: { message: string }): Promise<AsyncIterable<ShimResponse>> =>
                    this.stream(req.model, [...base, { role: 'user', content: message }], config),
                sendMessage: async ({ message }: { message: string }): Promise<ShimResponse> =>
                    this.complete(req.model, [...base, { role: 'user', content: message }], config),
            };
        },
    };

    // ---- routing -----------------------------------------------------------

    private async getEndpoints(model: string): Promise<RawEndpoint[] | null> {
        const hit = OpenRouterGenAI.endpointCache.get(model);
        if (hit && Date.now() - hit.at < ENDPOINT_TTL_MS) return hit.endpoints;
        try {
            const res = await this.fetchImpl(`${OPENROUTER_BASE}/models/${model}/endpoints`, {
                headers: { Authorization: `Bearer ${this.apiKey}` },
            });
            if (!res.ok) return hit?.endpoints ?? null;
            const json = await res.json() as { data?: { endpoints?: RawEndpoint[] } };
            const endpoints = json?.data?.endpoints;
            if (!Array.isArray(endpoints)) return hit?.endpoints ?? null;
            OpenRouterGenAI.endpointCache.set(model, { at: Date.now(), endpoints });
            return endpoints;
        } catch {
            return hit?.endpoints ?? null;
        }
    }

    private async routing(model: string): Promise<{ order: string[]; structuredProviders: string[] | null }> {
        const endpoints = await this.getEndpoints(model);
        if (!endpoints) return { order: [...this.allowed], structuredProviders: null };
        const ranked = rankProviders(endpoints, this.allowed, getInputOutputRatio());
        return { order: ranked.order, structuredProviders: ranked.structuredProviders };
    }

    // ---- request building --------------------------------------------------

    private withSystem(system: string, messages: ChatMessageOut[]): ChatMessageOut[] {
        return system.trim() ? [{ role: 'system', content: system }, ...messages] : messages;
    }

    private async buildBody(
        model: string,
        messages: ChatMessageOut[],
        config: GenConfig,
        stream: boolean,
        forceObjectMode: boolean,
    ): Promise<Record<string, unknown>> {
        const { order, structuredProviders } = await this.routing(model);
        const wantsJson = config.responseMimeType === 'application/json' || !!config.responseSchema;
        const schema = config.responseSchema ? geminiSchemaToJsonSchema(config.responseSchema) : null;

        // json_schema is used when we have a schema, it hasn't been refused this
        // session, and (if pricing data loaded) at least one allowed provider
        // advertises structured_outputs. Routing is then narrowed to those.
        const schemaProviders = structuredProviders === null
            ? order
            : order.filter(s => structuredProviders.includes(s));
        const useSchema = !!schema && !forceObjectMode && !schemaUnsupported.has(model) && schemaProviders.length > 0;

        let finalMessages = messages;
        let responseFormat: Record<string, unknown> | undefined;
        if (useSchema) {
            responseFormat = { type: 'json_schema', json_schema: { name: 'vre_response', strict: false, schema } };
        } else if (wantsJson) {
            responseFormat = { type: 'json_object' };
            const instruction = schema
                ? `Respond with ONLY a single JSON object that conforms to this JSON Schema. No prose outside the JSON.\n${JSON.stringify(schema)}`
                : 'Respond with ONLY a single valid JSON object. No prose outside the JSON.';
            finalMessages = messages[0]?.role === 'system'
                ? [{ role: 'system', content: `${messages[0].content}\n\n${instruction}` }, ...messages.slice(1)]
                : [{ role: 'system', content: instruction }, ...messages];
        }

        const routeOrder = useSchema ? schemaProviders : order;
        const body: Record<string, unknown> = {
            model,
            messages: finalMessages,
            stream,
            // DeepSeek V4.1 Flash reasons by default; reasoning tokens bill as
            // output. Same trap as Gemini's thinkingBudget — turn it off.
            reasoning: { effort: 'none' },
            provider: {
                only: routeOrder,
                order: routeOrder,
                allow_fallbacks: true,
            },
        };
        if (typeof config.temperature === 'number') body.temperature = config.temperature;
        if (typeof config.topP === 'number') body.top_p = config.topP;
        if (typeof config.maxOutputTokens === 'number') body.max_tokens = config.maxOutputTokens;
        if (responseFormat) body.response_format = responseFormat;
        if (stream) body.stream_options = { include_usage: true };
        return body;
    }

    private async post(body: Record<string, unknown>): Promise<Response> {
        const headers: Record<string, string> = {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'X-Title': 'Visceral Realism Engine',
        };
        try {
            if (typeof window !== 'undefined' && window.location?.origin) headers['HTTP-Referer'] = window.location.origin;
        } catch { /* ignore */ }

        const res = await this.fetchImpl(`${OPENROUTER_BASE}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            let detail = '';
            try {
                const j = await res.json() as { error?: { message?: string } };
                detail = j?.error?.message ?? '';
            } catch {
                try { detail = await res.text(); } catch { /* ignore */ }
            }
            throw new OpenRouterHttpError(res.status, detail);
        }
        return res;
    }

    /** Send, and on a structured-output refusal retry once in json_object mode. */
    private async send(model: string, messages: ChatMessageOut[], config: GenConfig, stream: boolean): Promise<Response> {
        const body = await this.buildBody(model, messages, config, stream, false);
        try {
            return await this.post(body);
        } catch (e) {
            const usedSchema = (body.response_format as { type?: string } | undefined)?.type === 'json_schema';
            if (usedSchema && e instanceof OpenRouterHttpError && e.isRoutingRefusal()) {
                schemaUnsupported.add(model);
                console.warn(`[OpenRouter] json_schema refused for ${model} — using json_object mode this session.`, e.message);
                return this.post(await this.buildBody(model, messages, config, stream, true));
            }
            throw e;
        }
    }

    private async complete(model: string, messages: ChatMessageOut[], config: GenConfig): Promise<ShimResponse> {
        const res = await this.send(model, messages, config, false);
        const json = await res.json() as {
            choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
            usage?: OrUsage;
            error?: { message?: string; code?: number };
        };
        if (json?.error) throw new OpenRouterHttpError(json.error.code ?? 500, json.error.message ?? 'Unknown error');
        const choice = json?.choices?.[0];
        recordOpenRouterUsage(json?.usage?.prompt_tokens ?? 0, json?.usage?.completion_tokens ?? 0);
        return makeResponse(choice?.message?.content ?? '', mapFinish(choice?.finish_reason), mapUsage(json?.usage));
    }

    private async stream(model: string, messages: ChatMessageOut[], config: GenConfig): Promise<AsyncIterable<ShimResponse>> {
        const res = await this.send(model, messages, config, true);
        const reader = res.body?.getReader();
        if (!reader) {
            // No streaming body (some environments) — fall back to one chunk.
            const text = await res.text();
            return (async function* () { yield makeResponse(text); })();
        }
        const decoder = new TextDecoder();

        return (async function* (): AsyncGenerator<ShimResponse> {
            let buffer = '';
            let promptTokens = 0;
            let completionTokens = 0;
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    let nl: number;
                    while ((nl = buffer.indexOf('\n')) !== -1) {
                        const line = buffer.slice(0, nl).trim();
                        buffer = buffer.slice(nl + 1);
                        // Lines starting with ':' are OpenRouter keep-alive comments.
                        if (!line.startsWith('data:')) continue;
                        const data = line.slice(5).trim();
                        if (!data || data === '[DONE]') continue;
                        let chunk: {
                            choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
                            usage?: OrUsage;
                            error?: { message?: string; code?: number };
                        };
                        try { chunk = JSON.parse(data); } catch { continue; }
                        if (chunk.error) {
                            throw new OpenRouterHttpError(chunk.error.code ?? 500, chunk.error.message ?? 'Stream error');
                        }
                        const choice = chunk.choices?.[0];
                        const usage = mapUsage(chunk.usage);
                        if (chunk.usage) {
                            promptTokens = chunk.usage.prompt_tokens ?? promptTokens;
                            completionTokens = chunk.usage.completion_tokens ?? completionTokens;
                        }
                        const delta = choice?.delta?.content ?? '';
                        const finish = mapFinish(choice?.finish_reason ?? undefined);
                        if (delta || finish || usage) yield makeResponse(delta, finish, usage);
                    }
                }
            } finally {
                recordOpenRouterUsage(promptTokens, completionTokens);
                try { reader.releaseLock(); } catch { /* ignore */ }
            }
        })();
    }
}

export class OpenRouterHttpError extends Error {
    constructor(public readonly status: number, detail: string) {
        super(`OpenRouter ${status}: ${detail || OpenRouterHttpError.describe(status)}`);
        this.name = 'OpenRouterHttpError';
    }

    static describe(status: number): string {
        switch (status) {
            case 401: return 'Invalid OpenRouter API key.';
            case 402: return 'Out of OpenRouter credits.';
            case 403: return 'Blocked by the key guardrail or monthly limit.';
            case 404: return 'No allowed provider can serve this request.';
            case 429: return 'Rate limited.';
            default: return 'Request failed.';
        }
    }

    /** The request couldn't be routed (vs. auth/billing/rate-limit). */
    isRoutingRefusal(): boolean {
        if (this.status === 404) return true;
        if (this.status === 400 && /response_format|json_schema|structured|no endpoints|not support/i.test(this.message)) return true;
        return false;
    }
}
