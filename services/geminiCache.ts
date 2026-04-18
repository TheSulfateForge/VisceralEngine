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

export class SystemInstructionCache {
    /** Per-model cache. Key: `${modelName}` (one cache per model family). */
    private readonly entries = new Map<string, CacheEntry>();

    /** Models known to reject cache requests (updated at runtime on 4xx). */
    private readonly blocklist = new Set<string>();

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
            this.entries.set(modelName, {
                name: created.name,
                expiresAtMs,
                contentHash,
            });
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
    }
}

/** Module-level singleton. Shared across all GeminiClient instances. */
export const systemInstructionCache = new SystemInstructionCache();
