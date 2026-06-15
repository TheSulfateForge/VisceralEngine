// ============================================================================
// GEMINI CONTEXT CACHE (v1.19)
// ----------------------------------------------------------------------------
// Maintains a short-lived cache of the static SYSTEM_INSTRUCTIONS so we don't
// repay the token cost on every turn. Keyed by (model, content hash). The
// Gemini caches API handles server-side expiry; we treat expiry as a miss
// and rebuild on demand.
//
// IMPORTANT: The cache is "best-effort" — if Gemini's caches endpoint refuses
// (too-small prompt, unsupported model, permission error, etc.), getOrCreate()
// returns null and the caller transparently falls back to inline
// systemInstruction. No user-visible behavior changes on cache failure.
// ============================================================================

import type { GoogleGenAI } from "@google/genai";

/** Minimum tokens required to cache content (Google enforces a lower bound). */
const MIN_CACHEABLE_TOKENS = 1024;

/** Default TTL for cached content, in seconds. 1 hour matches Google defaults. */
const DEFAULT_CACHE_TTL_SECONDS = 3600;

/** Rough "4 chars per token" heuristic — Gemini tokenization varies, but this
 *  is close enough to decide whether a prompt is even worth trying to cache. */
const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

/** FNV-1a 32-bit hash — fast, no dependencies, collision rate acceptable
 *  for our use case (handful of distinct system prompts per session). */
const hashContent = (text: string): string => {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
};

interface CacheEntry {
    /** Resource name returned by caches.create(), e.g. "cachedContents/abc123". */
    name: string;
    /** Epoch ms when we locally consider this cache expired (TTL - safety buffer). */
    expiresAtMs: number;
    /** Hash of the content that was cached, to detect drift. */
    contentHash: string;
}

/** localStorage key prefix for persisted cache pointers (review item 6). */
const STORAGE_PREFIX = 'visceral_sys_cache_';
/** Set this localStorage flag to '1' to force-disable explicit caching — e.g.
 *  to confirm via usageMetadata that 2.5 implicit caching already covers you. */
const DISABLE_FLAG = 'visceral_disable_explicit_cache';

const hasLocalStorage = (): boolean => {
    try { return typeof localStorage !== 'undefined'; } catch { return false; }
};

export class SystemInstructionCache {
    /** Per-model cache. Key: `${modelName}` (one cache per model family). */
    private readonly entries = new Map<string, CacheEntry>();

    /** Models known to reject cache requests (updated at runtime on 4xx). */
    private readonly blocklist = new Set<string>();

    constructor() {
        // Review item 6: hydrate persisted cache pointers so a PWA reload reuses
        // a still-valid server-side cache instead of paying to recreate it.
        if (!hasLocalStorage()) return;
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
                const raw = localStorage.getItem(key);
                if (!raw) continue;
                const entry = JSON.parse(raw) as CacheEntry;
                if (entry && entry.name && entry.expiresAtMs > Date.now()) {
                    this.entries.set(key.slice(STORAGE_PREFIX.length), entry);
                }
            }
        } catch { /* corrupt entry — ignore, we'll rebuild on demand */ }
    }

    private persist(modelName: string, entry: CacheEntry): void {
        if (!hasLocalStorage()) return;
        try { localStorage.setItem(STORAGE_PREFIX + modelName, JSON.stringify(entry)); } catch { /* quota */ }
    }

    private removePersisted(modelName: string): void {
        if (!hasLocalStorage()) return;
        try { localStorage.removeItem(STORAGE_PREFIX + modelName); } catch { /* ignore */ }
    }

    /**
     * Returns a cached-content resource name for the given static prompt, or
     * null if caching isn't viable. Safe to call on every turn — reuses an
     * existing unexpired cache when the content hash matches.
     */
    public async getOrCreate(
        ai: GoogleGenAI,
        modelName: string,
        staticPrompt: string,
        ttlSeconds: number = DEFAULT_CACHE_TTL_SECONDS,
    ): Promise<string | null> {
        if (this.blocklist.has(modelName)) return null;

        // Review item 6: honor the manual kill-switch.
        if (hasLocalStorage()) {
            try { if (localStorage.getItem(DISABLE_FLAG) === '1') return null; } catch { /* ignore */ }
        }

        // Skip tiny prompts that Google would reject anyway.
        if (estimateTokens(staticPrompt) < MIN_CACHEABLE_TOKENS) return null;

        const contentHash = hashContent(staticPrompt);
        const now = Date.now();
        const existing = this.entries.get(modelName);

        // Fast path: cache is fresh and content hasn't drifted.
        if (existing && existing.contentHash === contentHash && now < existing.expiresAtMs) {
            return existing.name;
        }

        // Stale / mismatched / missing — try to create a new one.
        try {
            // Note: caches.create() signature in @google/genai v1.39.
            // If the SDK shape diverges, the catch below will blocklist the model.
            const caches = (ai as unknown as {
                caches?: {
                    create: (args: {
                        model: string;
                        config: {
                            systemInstruction?: string;
                            contents?: unknown;
                            ttl?: string;
                        };
                    }) => Promise<{ name?: string }>;
                };
            }).caches;

            if (!caches || typeof caches.create !== 'function') {
                this.blocklist.add(modelName);
                return null;
            }

            const created = await caches.create({
                model: modelName,
                config: {
                    systemInstruction: staticPrompt,
                    ttl: `${ttlSeconds}s`,
                },
            });

            if (!created?.name) {
                this.blocklist.add(modelName);
                return null;
            }

            // Expire 60s early to avoid races with server-side TTL.
            const expiresAtMs = now + (ttlSeconds - 60) * 1000;
            const entry: CacheEntry = { name: created.name, expiresAtMs, contentHash };
            this.entries.set(modelName, entry);
            this.persist(modelName, entry);  // Review item 6
            return created.name;
        } catch (err) {
            // Any failure (min-token rejection, unsupported model, auth) →
            // blocklist for this session. Caller falls back to inline prompt.
            this.blocklist.add(modelName);
            if (typeof console !== 'undefined' && typeof console.warn === 'function') {
                console.warn(`[geminiCache] Caching disabled for ${modelName}:`, err);
            }
            return null;
        }
    }

    /**
     * Invalidate the cache for a model — call on 404 "cache not found" errors
     * so the next request rebuilds. Does NOT re-enable a blocklisted model.
     */
    public invalidate(modelName: string): void {
        this.entries.delete(modelName);
        this.removePersisted(modelName);  // Review item 6
    }
}

/** Module-level singleton. Shared across all GeminiClient instances. */
export const systemInstructionCache = new SystemInstructionCache();
