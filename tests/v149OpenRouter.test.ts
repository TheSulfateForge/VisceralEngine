// v1.49 — OpenRouter provider: schema conversion, cost ranking, transport.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    geminiSchemaToJsonSchema,
    rankProviders,
    contentsToMessages,
    OpenRouterGenAI,
    getInputOutputRatio,
    recordOpenRouterUsage,
    DEFAULT_INPUT_OUTPUT_RATIO,
    type RawEndpoint,
} from '../services/openRouterGenAI';
import { OOC_RESPONSE_SCHEMA } from '../schemas/oocSchema';
import { getResponseSchema } from '../schemas/responseSchema';
import { OPENROUTER_ALLOWED_PROVIDERS } from '../config/aiProvider';

// Minimal in-memory localStorage for the node test environment.
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
} as Storage;

// Prices from the OpenRouter provider page (per 1M tokens), as per-token strings.
const per = (m: number) => String(m / 1_000_000);
const ENDPOINTS: RawEndpoint[] = [
    { provider_name: 'Baidu Qianfan', tag: 'baidu', pricing: { prompt: per(0.0447), completion: per(0.1788) }, supported_parameters: ['structured_outputs'] },
    { provider_name: 'Morph', tag: 'morph', pricing: { prompt: per(0.05), completion: per(0.192) }, supported_parameters: ['structured_outputs', 'response_format'] },
    { provider_name: 'Sail Research', tag: 'sail-research', pricing: { prompt: per(0.09), completion: per(0.25) }, supported_parameters: ['response_format'] },
    { provider_name: 'Sail Research', tag: 'sail-research/fp8', pricing: { prompt: per(0.09), completion: per(0.25) }, supported_parameters: ['response_format'] },
    { provider_name: 'Wafer', tag: 'wafer', pricing: { prompt: per(0.045), completion: per(0.50) }, supported_parameters: ['structured_outputs'] },
    { provider_name: 'Wafer', tag: 'wafer/fp8', pricing: { prompt: per(0.19), completion: per(0.65) }, supported_parameters: ['structured_outputs'] },
    { provider_name: 'Relace', tag: 'relace', pricing: { prompt: per(0.0028), completion: per(0.6426) }, supported_parameters: ['structured_outputs'] },
    { provider_name: 'DeepInfra', tag: 'deepinfra', pricing: { prompt: per(0.14), completion: per(0.42) }, supported_parameters: ['structured_outputs'] },
];

describe('v1.49 geminiSchemaToJsonSchema', () => {
    it('lower-cases types, turns nullable into a type union, drops propertyOrdering', () => {
        const out = geminiSchemaToJsonSchema({
            type: 'OBJECT',
            propertyOrdering: ['a', 'b'],
            properties: {
                a: { type: 'STRING', nullable: true, description: 'x' },
                b: { type: 'ARRAY', items: { type: 'INTEGER', enum: ['1'] } },
            },
            required: ['a'],
        }) as Record<string, any>;
        expect(out.type).toBe('object');
        expect(out.propertyOrdering).toBeUndefined();
        expect(out.properties.a).toEqual({ type: ['string', 'null'], description: 'x' });
        expect(out.properties.b.items.type).toBe('integer');
        expect(out.required).toEqual(['a']);
    });

    it('converts the real OOC and narrator schemas with no upper-case types left', () => {
        for (const schema of [OOC_RESPONSE_SCHEMA, getResponseSchema('NARRATIVE')]) {
            const json = JSON.stringify(geminiSchemaToJsonSchema(schema));
            expect(json).not.toMatch(/"type":"(OBJECT|STRING|NUMBER|INTEGER|BOOLEAN|ARRAY)"/);
            expect(json).not.toContain('"nullable"');
        }
    });
});

describe('v1.49 rankProviders', () => {
    it('keeps only the allowed providers', () => {
        const r = rankProviders(ENDPOINTS, OPENROUTER_ALLOWED_PROVIDERS, 10);
        expect([...r.order].sort()).toEqual([...OPENROUTER_ALLOWED_PROVIDERS].sort());
        expect(r.order).not.toContain('baidu');
        expect(r.order).not.toContain('deepinfra');
    });

    it('ranks by total cost for the input:output ratio', () => {
        // 10:1 → relace 0.670, morph 0.692, wafer 0.950 (cheapest endpoint), sail 1.150
        expect(rankProviders(ENDPOINTS, OPENROUTER_ALLOWED_PROVIDERS, 10).order)
            .toEqual(['relace', 'morph', 'wafer', 'sail-research']);
        // Output-heavy (2:1) → morph wins: 0.292 vs relace 0.648
        expect(rankProviders(ENDPOINTS, OPENROUTER_ALLOWED_PROVIDERS, 2).order[0]).toBe('morph');
    });

    it('reports which providers accept json_schema', () => {
        const r = rankProviders(ENDPOINTS, OPENROUTER_ALLOWED_PROVIDERS, 10);
        expect(r.structuredProviders.sort()).toEqual(['morph', 'relace', 'wafer']);
    });

    it('keeps unlisted allowed providers at the end so fallback can still reach them', () => {
        const r = rankProviders(ENDPOINTS.filter(e => e.tag !== 'morph'), OPENROUTER_ALLOWED_PROVIDERS, 10);
        expect(r.order[r.order.length - 1]).toBe('morph');
    });
});

describe('v1.49 usage ratio', () => {
    beforeEach(() => store.clear());
    it('uses the default until enough output has been seen, then the measured ratio', () => {
        expect(getInputOutputRatio()).toBe(DEFAULT_INPUT_OUTPUT_RATIO);
        recordOpenRouterUsage(150_000, 6_000);
        expect(getInputOutputRatio()).toBeCloseTo(25);
    });
});

describe('v1.49 contentsToMessages', () => {
    it('handles string, Content and Content[] shapes', () => {
        expect(contentsToMessages('hi')).toEqual([{ role: 'user', content: 'hi' }]);
        expect(contentsToMessages({ parts: [{ text: 'a' }, { text: 'b' }] })).toEqual([{ role: 'user', content: 'ab' }]);
        expect(contentsToMessages([
            { role: 'user', parts: [{ text: 'u' }] },
            { role: 'model', parts: [{ text: 'm' }] },
        ])).toEqual([{ role: 'user', content: 'u' }, { role: 'assistant', content: 'm' }]);
    });
});

// ---------------------------------------------------------------------------
// Transport with a mocked fetch
// ---------------------------------------------------------------------------

const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const sseResponse = (events: unknown[]) => {
    const text = [': OPENROUTER PROCESSING', ...events.map(e => `data: ${JSON.stringify(e)}`), 'data: [DONE]', ''].join('\n');
    return new Response(text, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};

const makeFetch = (handler: (url: string, body: any) => Response) => {
    const calls: Array<{ url: string; body: any }> = [];
    const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/endpoints')) return jsonResponse({ data: { endpoints: ENDPOINTS } });
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ url, body });
        return handler(url, body);
    });
    return { fn: fn as unknown as typeof fetch, calls };
};

describe('v1.49 OpenRouterGenAI transport', () => {
    beforeEach(() => store.clear());

    it('generateContent sends the routing block, reasoning off, and json_schema', async () => {
        const { fn, calls } = makeFetch(() => jsonResponse({
            choices: [{ message: { content: '{"reply":"ok"}' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
        }));
        const ai = new OpenRouterGenAI({ apiKey: 'sk-test', allowedProviders: OPENROUTER_ALLOWED_PROVIDERS, fetchImpl: fn });
        const res = await ai.models.generateContent({
            model: 'deepseek/deepseek-v4.1-flash',
            contents: 'question',
            config: { systemInstruction: 'sys', temperature: 0.4, responseMimeType: 'application/json', responseSchema: OOC_RESPONSE_SCHEMA, safetySettings: [] },
        });
        expect(res.text).toBe('{"reply":"ok"}');
        expect(res.candidates[0].finishReason).toBe('STOP');
        const body = calls[0].body;
        expect(body.model).toBe('deepseek/deepseek-v4.1-flash');
        expect(body.reasoning).toEqual({ effort: 'none' });
        expect(body.response_format.type).toBe('json_schema');
        expect(body.provider.allow_fallbacks).toBe(true);
        // json_schema routes only to providers that advertise structured_outputs, cheapest first.
        expect(body.provider.only).toEqual(['relace', 'morph', 'wafer']);
        expect(body.provider.order).toEqual(['relace', 'morph', 'wafer']);
        expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' });
        expect(body.safetySettings).toBeUndefined();
    });

    it('falls back to json_object across all four providers when json_schema is refused', async () => {
        let n = 0;
        const { fn, calls } = makeFetch(() => {
            n++;
            if (n === 1) return jsonResponse({ error: { message: 'No endpoints found that support the requested parameters', code: 404 } }, 404);
            return jsonResponse({ choices: [{ message: { content: '{"reply":"fallback"}' }, finish_reason: 'stop' }] });
        });
        const ai = new OpenRouterGenAI({ apiKey: 'sk-test', allowedProviders: OPENROUTER_ALLOWED_PROVIDERS, fetchImpl: fn });
        const res = await ai.models.generateContent({
            model: 'test/fallback-model',
            contents: 'q',
            config: { systemInstruction: 'sys', responseMimeType: 'application/json', responseSchema: OOC_RESPONSE_SCHEMA },
        });
        expect(res.text).toBe('{"reply":"fallback"}');
        expect(calls).toHaveLength(2);
        expect(calls[1].body.response_format).toEqual({ type: 'json_object' });
        expect(calls[1].body.provider.only).toEqual(['relace', 'morph', 'wafer', 'sail-research']);
        expect(calls[1].body.messages[0].content).toContain('JSON Schema');
    });

    it('does not retry auth / billing errors', async () => {
        const { fn, calls } = makeFetch(() => jsonResponse({ error: { message: 'Insufficient credits', code: 402 } }, 402));
        const ai = new OpenRouterGenAI({ apiKey: 'sk-test', allowedProviders: OPENROUTER_ALLOWED_PROVIDERS, fetchImpl: fn });
        await expect(ai.models.generateContent({ model: 'm/x', contents: 'q', config: { responseSchema: OOC_RESPONSE_SCHEMA } }))
            .rejects.toThrow(/OpenRouter 402/);
        expect(calls).toHaveLength(1);
    });

    it('chats.create streams deltas, maps history roles, and reports usage', async () => {
        const { fn, calls } = makeFetch(() => sseResponse([
            { choices: [{ delta: { content: '{"narr' } }] },
            { choices: [{ delta: { content: 'ative":"x"}' } }] },
            { choices: [{ delta: {}, finish_reason: 'length' }] },
            { choices: [], usage: { prompt_tokens: 5000, completion_tokens: 400, total_tokens: 5400, prompt_tokens_details: { cached_tokens: 4000 } } },
        ]));
        const ai = new OpenRouterGenAI({ apiKey: 'sk-test', allowedProviders: OPENROUTER_ALLOWED_PROVIDERS, fetchImpl: fn });
        const chat = ai.chats.create({
            model: 'deepseek/deepseek-v4.1-flash',
            history: [{ role: 'user', parts: [{ text: 'hello' }] }, { role: 'model', parts: [{ text: 'world' }] }],
            config: { systemInstruction: 'sys', responseMimeType: 'application/json', responseSchema: OOC_RESPONSE_SCHEMA, cachedContent: 'ignored' },
        });
        const stream = await chat.sendMessageStream({ message: 'turn' });
        let text = '';
        let finish: string | undefined;
        let cached = 0;
        for await (const piece of stream) {
            text += piece.text;
            finish = piece.candidates[0].finishReason ?? finish;
            if (piece.usageMetadata) cached = piece.usageMetadata.cachedContentTokenCount;
        }
        expect(text).toBe('{"narrative":"x"}');
        expect(finish).toBe('MAX_TOKENS');
        expect(cached).toBe(4000);
        const body = calls[0].body;
        expect(body.stream).toBe(true);
        expect(body.stream_options).toEqual({ include_usage: true });
        expect(body.messages.map((m: any) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
        expect(body.cachedContent).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// End to end through GeminiService with provider = 'openrouter'
// ---------------------------------------------------------------------------

import { GeminiService } from '../geminiService';
import { Role } from '../types';
import { SYSTEM_INSTRUCTIONS } from '../systemInstructions';

describe('v1.49 GeminiService on OpenRouter', () => {
    beforeEach(() => store.clear());

    const install = (handler: (body: any) => Response) => {
        const bodies: any[] = [];
        globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url.includes('googleapis')) throw new Error('Gemini API must not be called on OpenRouter');
            if (url.endsWith('/endpoints')) return jsonResponse({ data: { endpoints: ENDPOINTS } });
            const body = JSON.parse(String(init?.body));
            bodies.push(body);
            return handler(body);
        }) as unknown as typeof fetch;
        return bodies;
    };

    it('narrator turn streams through OpenRouter, skips the Gemini cache, parses the JSON', async () => {
        const bodies = install(() => sseResponse([
            { choices: [{ delta: { content: '{"narrative":"The door opens.","scene_mode":"NARRATIVE","tension_level":10,"time_passed_minutes":1}' }, finish_reason: 'stop' }] },
            { choices: [], usage: { prompt_tokens: 12000, completion_tokens: 300, total_tokens: 12300 } },
        ]));
        const svc = new GeminiService('sk-or-test', 'deepseek/deepseek-v4.1-flash', 'openrouter');
        const res = await svc.sendMessage(
            SYSTEM_INSTRUCTIONS,
            [{ id: '1', role: Role.USER, text: 'I open the door.', timestamp: Date.now() } as any],
            undefined, undefined, 'reminder', undefined, 'world state', 'campaign canon', 'low',
        );
        expect(res.engineError).toBeUndefined();
        expect(res.narrative).toBe('The door opens.');
        expect(res.usageMetadata?.promptTokenCount).toBe(12000);
        const body = bodies[0];
        expect(body.model).toBe('deepseek/deepseek-v4.1-flash');
        // Static block inline as the system message (no Gemini cachedContent).
        expect(body.messages[0].role).toBe('system');
        expect(body.messages[0].content.startsWith(SYSTEM_INSTRUCTIONS)).toBe(true);
        expect(body.messages[0].content).toContain('campaign canon');
        expect(body.messages[body.messages.length - 1].content).toContain('I open the door.');
    });

    it('summary and world pulse use the selected model, and image generation is off', async () => {
        const bodies = install(() => jsonResponse({
            choices: [{ message: { content: '{"summary":"s","memory_candidates":[],"developments":[],"opportunities":[]}' }, finish_reason: 'stop' }],
        }));
        const svc = new GeminiService('sk-or-test', 'deepseek/deepseek-v4.1-flash', 'openrouter');
        await svc.summarizeHistoryWithSalvage([{ id: '1', role: Role.USER, text: 'x', timestamp: 0 } as any]);
        await svc.worldPulse({ knownEntities: [], socialGraph: [], worldTags: [] } as any, 5);
        expect(bodies.map(b => b.model)).toEqual(['deepseek/deepseek-v4.1-flash', 'deepseek/deepseek-v4.1-flash']);
        expect(await svc.generateImage('a portrait')).toBeNull();
        expect(bodies).toHaveLength(2);
    });
});
