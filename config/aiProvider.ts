// ============================================================================
// config/aiProvider.ts — v1.49 AI provider toggle (Gemini | OpenRouter)
// ============================================================================
//
// One switch decides which backend every model call in the engine uses:
// narrator turns, OOC, summaries, world pulse, character/scenario/world/skill
// generation. Nothing calls a model by a hardcoded name any more — every
// service reads the ACTIVE model from here (via GeminiService.modelName).
//
// Settings live in localStorage only. The OpenRouter key never leaves the
// browser except in the Authorization header of requests to openrouter.ai.
//
// The provider allowlist below is the client-side half of the lock. The hard
// half is the OpenRouter guardrail on the API key ("Only Allow…" mode, same
// model + same four providers), which OpenRouter enforces server-side no
// matter what this file says.

import { create } from 'zustand';

export type AiProvider = 'gemini' | 'openrouter';

/** Models selectable while OpenRouter is the active provider. */
export const OPENROUTER_MODELS = [
    'deepseek/deepseek-v4.1-flash',
] as const;

/**
 * OpenRouter provider slugs VRE may route to. These four were checked by hand
 * for terms that permit adult content. Order here is only the static fallback
 * order used when live pricing can't be fetched — at runtime the order is
 * re-ranked by total cost (see services/openRouterGenAI.ts).
 */
export const OPENROUTER_ALLOWED_PROVIDERS = [
    'relace',
    'morph',
    'wafer',
    'sail-research',
] as const;

const LS_PROVIDER = 'visceral_ai_provider';
const LS_OR_KEY = 'visceral_openrouter_key';
const LS_OR_MODEL = 'visceral_openrouter_model';

const lsGet = (k: string): string | null => {
    try { return typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null; } catch { return null; }
};
const lsSet = (k: string, v: string | null): void => {
    try {
        if (typeof localStorage === 'undefined') return;
        if (v === null || v === '') localStorage.removeItem(k);
        else localStorage.setItem(k, v);
    } catch { /* storage unavailable — setting stays in memory for this session */ }
};

const readProvider = (): AiProvider => (lsGet(LS_PROVIDER) === 'openrouter' ? 'openrouter' : 'gemini');
const readOrModel = (): string => {
    const saved = lsGet(LS_OR_MODEL);
    return saved && (OPENROUTER_MODELS as readonly string[]).includes(saved) ? saved : OPENROUTER_MODELS[0];
};

interface AiProviderState {
    provider: AiProvider;
    openRouterKey: string;
    openRouterModel: string;
    setProvider: (p: AiProvider) => void;
    setOpenRouterKey: (key: string) => void;
    setOpenRouterModel: (model: string) => void;
}

export const useAiProviderStore = create<AiProviderState>((set) => ({
    provider: readProvider(),
    openRouterKey: lsGet(LS_OR_KEY) ?? '',
    openRouterModel: readOrModel(),
    setProvider: (p) => { lsSet(LS_PROVIDER, p); set({ provider: p }); },
    setOpenRouterKey: (key) => { const k = key.trim(); lsSet(LS_OR_KEY, k); set({ openRouterKey: k }); },
    setOpenRouterModel: (model) => {
        if (!(OPENROUTER_MODELS as readonly string[]).includes(model)) return;
        lsSet(LS_OR_MODEL, model);
        set({ openRouterModel: model });
    },
}));

/** Non-React read of the active provider. */
export const getActiveProvider = (): AiProvider => useAiProviderStore.getState().provider;

/**
 * The model every call should use. `geminiModel` is the per-save Gemini
 * selection (gameWorld.currentModel); it only applies when Gemini is active.
 */
export const getActiveModelName = (geminiModel: string): string =>
    getActiveProvider() === 'openrouter' ? useAiProviderStore.getState().openRouterModel : geminiModel;

/** Image generation is a Google-only feature (gemini-2.5-flash-image). */
export const isImageGenerationAvailable = (provider: AiProvider = getActiveProvider()): boolean =>
    provider === 'gemini';
