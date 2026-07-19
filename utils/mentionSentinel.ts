/**
 * v1.27: Mention Sentinel + World Roster — dormant-tier NPC & lore recall.
 *
 * THE PROBLEM. Past ~25 NPCs the per-turn context can't hold everyone, and
 * anything outside it effectively stops existing for the model: 'missing'
 * entities rendered nowhere, the model reinvented or contradicted off-screen
 * NPCs, and the death detectors picked up the wreckage ("randomly killed
 * premade NPCs").
 *
 * THE DESIGN — three tiers, near-zero marginal token cost:
 *
 *   Tier 0 — ACTIVE:  present/nearby/just-named NPCs → full canonical block
 *             (personality, voice_sample, ledger). Unchanged from v1.24.
 *   Tier 1 — ROSTER:  every living NPC, names+roles only, ONE line in the
 *             CACHE-STABLE prefix (staticContext). ~4 tokens per NPC, byte-
 *             stable between membership changes, so it rides the implicit
 *             prompt cache. This is how the model "knows their names" and is
 *             told never to invent replacements or kill anyone off-screen.
 *   Tier 2 — DORMANT: full record lives only in the DB. Zero prompt presence
 *             beyond the roster name.
 *
 * THE SENTINEL (pure code, zero AI tokens): every turn we scan the player's
 * input (existing alias matcher) AND the previous model narrative for
 * whole-word mentions of non-active NPCs. A hit hydrates that NPC to Tier 0
 * next turn via the existing forceActiveIds path. Lore gets the same
 * treatment: an exact keyword hit force-injects the entry, bypassing the
 * RAG similarity threshold — an exact match should always beat a cosine
 * score. A cache-stable LORE INDEX line tells the model which topics are
 * already established so it steers toward canon instead of inventing
 * contradictions.
 */

import type { KnownEntity, LoreItem } from '../types';
import { nameMentionedIn } from './engine/entityLifecycle';

const isAlive = (e: KnownEntity): boolean =>
    e.status !== 'dead' && e.status !== 'retired';

const isActiveStatus = (e: KnownEntity): boolean =>
    !e.status || e.status === 'present' || e.status === 'nearby';

/**
 * Scan the previous model narrative for mentions of living, NON-active
 * entities not already retrieved this turn. Returns up to `limit` entities
 * to hydrate to full Tier-0 blocks (via forceActiveIds).
 *
 * Complements findAliasMatchedEntities (ragEngine), which only scans USER
 * turns — this catches the model re-introducing someone on its own
 * ("world_tick: Halric raises the guild tariffs") so the very next turn
 * renders his canonical personality instead of an improvised one.
 */
export function findNarrativeMentionedEntities(
    lastModelText: string,
    entities: KnownEntity[],
    alreadyRetrievedIds: Set<string>,
    limit: number,
): KnownEntity[] {
    if (!lastModelText.trim() || limit <= 0) return [];
    const textLower = lastModelText.toLowerCase();
    const out: KnownEntity[] = [];
    for (const e of entities) {
        if (out.length >= limit) break;
        if (!e.name || alreadyRetrievedIds.has(e.id)) continue;
        if (!isAlive(e) || isActiveStatus(e)) continue; // dormant tier only
        if (nameMentionedIn(textLower, e.name)) out.push(e);
    }
    return out;
}

/**
 * Exact lore keyword hit in the scan text (player input + recent turns).
 * Bypasses the RAG similarity threshold: if the player says "the Sundering",
 * the [Sundering] entry goes in, whatever its embedding score. Multi-word
 * keywords match as a phrase; single-word keywords as a whole word.
 */
export function findExactKeywordLore(
    scanText: string,
    lore: LoreItem[],
    alreadyRetrievedIds: Set<string>,
    limit: number,
): LoreItem[] {
    if (!scanText.trim() || limit <= 0) return [];
    const textLower = scanText.toLowerCase();
    const out: LoreItem[] = [];
    for (const l of lore) {
        if (out.length >= limit) break;
        if (alreadyRetrievedIds.has(l.id)) continue;
        const kw = (l.keyword ?? '').toLowerCase().trim();
        if (kw.length < 4) continue; // too short to trust as an exact signal
        const safe = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`\\b${safe}\\b`).test(textLower)) out.push(l);
    }
    return out;
}

/**
 * Tier-1 roster: ONE cache-stable block naming every living NPC.
 *
 * Cache discipline: membership changes only on creation/death — never on
 * status churn — and entries are sorted by name, so the rendered block is
 * byte-identical between roster changes and rides the implicit prefix cache.
 * Do NOT add per-turn state (status, location, impression) to this block.
 */
export function buildWorldRoster(entities: KnownEntity[]): string {
    const living = entities
        .filter(e => isAlive(e) && e.name?.trim())
        .sort((a, b) => a.name.localeCompare(b.name));
    if (living.length === 0) return '';

    const names = living
        .map(e => (e.role?.trim() ? `${e.name} (${e.role})` : e.name))
        .join('; ');

    return `[WORLD ROSTER — CANON. Every person on this list exists in this world.]
${names}
- People not currently described in [CONTEXT] are simply elsewhere, living their lives. They are NOT gone.
- NEVER invent a replacement for a roster member (no "new blacksmith" if one is listed).
- NEVER kill, retire, or write out a roster member off-screen. On-screen deaths must be earned and explicit.
- If the player references a roster member you lack details for, keep them consistent with their role and say little — their full record will be provided next turn.`;
}

/**
 * Cache-stable lore topic index: keywords only, sorted. Tells the model what
 * canon already exists so it consults/extends rather than contradicts.
 */
export function buildLoreTopicIndex(lore: LoreItem[]): string {
    const keywords = Array.from(
        new Set(lore.map(l => l.keyword?.trim()).filter((k): k is string => !!k))
    ).sort((a, b) => a.localeCompare(b));
    if (keywords.length === 0) return '';

    return `[LORE INDEX — topics with established canon. Do not contradict; full entries surface when relevant.]
${keywords.join('; ')}`;
}
