// ────────────────────────────────────────────────────────────────────────────
// v1.58: NPCs KEEP WHAT THEY HAVE SEEN.
//
// The 2026-11-13 Westcross save, turn 68: Lord Prosper Calder walks into his
// own dinner and the narration has Ryan size him up as a man he "has been told
// about and has not yet seen" — eight hours after the two of them stood
// together before the whole court, Prosper backing Ryan's demand for a bride
// price. Two engine causes:
//
// 1. LEDGERS WERE REPLACED, NOT EXTENDED. Every known_entity_updates entry
//    carries a required `ledger`, and the merge spread `...update` over the
//    stored record. The model writes the last two or three beats, so each
//    update erased everything before them. After 68 turns no NPC held more
//    than 4 ledger entries and 65 of 73 held none; Prosper's had narrowed to
//    the carriage and the wine.
// 2. STORY FACTS WERE NOT TIED TO PEOPLE. The memory store (new_memories) is
//    one global list ranked against the player's input. Nothing in it is
//    filed under the NPC it concerns, so an NPC entering a scene brings no
//    history with them unless the player's words happen to retrieve it.
//
// This module: ledgers merge (append, de-duplicate, cap); every memory fact
// that names an NPC is filed on that NPC (`witnessed`); and the prompt shows
// each in-scene NPC the recent ledger plus the entries most relevant to the
// turn.
// ────────────────────────────────────────────────────────────────────────────

import type { KnownEntity, MemoryItem } from '../../types';

export const LEDGER_MAX = 20;
export const WITNESSED_MAX = 24;
/** In-scene prompt: most recent ledger entries, plus relevant older ones. */
export const LEDGER_PROMPT_RECENT = 5;
export const LEDGER_PROMPT_RELEVANT = 3;
export const WITNESSED_PROMPT_MAX = 5;

const STOP = new Set([
    'the', 'and', 'that', 'with', 'from', 'this', 'have', 'has', 'had', 'was', 'were', 'his', 'her', 'him', 'she',
    'they', 'them', 'their', 'for', 'not', 'but', 'are', 'you', 'your', 'into', 'onto', 'what', 'when', 'will',
    'would', 'about', 'after', 'before', 'over', 'then', 'than', 'been', 'being', 'also', 'just', 'said', 'told',
]);
const words = (s: string): string[] =>
    (s ?? '').toLowerCase().replace(/[^a-z0-9'\s-]/g, ' ').split(/\s+/)
        .map(w => w.replace(/^'+|'+$/g, '').replace(/'s$/, ''))
        .filter(w => w.length >= 3 && !STOP.has(w));

/** Two entries say the same thing: ≥ 70% of the shorter one's words recur. */
const sameEntry = (a: string, b: string): boolean => {
    const wa = new Set(words(a)), wb = new Set(words(b));
    if (wa.size === 0 || wb.size === 0) return a.trim().toLowerCase() === b.trim().toLowerCase();
    let shared = 0;
    for (const w of wa) if (wb.has(w)) shared++;
    return shared / Math.min(wa.size, wb.size) >= 0.7;
};

/**
 * Merge an update's ledger into the stored one. Entries already present (or a
 * near-restatement of one) are not repeated — a restatement replaces the older
 * wording in place, so the record reads current. New entries append. Oldest
 * fall off past the cap.
 */
export const mergeLedger = (existing: string[] | undefined, incoming: string[] | undefined, max = LEDGER_MAX): string[] => {
    const out = [...(existing ?? [])].filter(s => typeof s === 'string' && s.trim());
    for (const raw of incoming ?? []) {
        if (typeof raw !== 'string') continue;
        const entry = raw.trim();
        if (!entry) continue;
        const at = out.findIndex(e => sameEntry(e, entry));
        if (at >= 0) {
            // Same beat; keep the newer wording, move it to the end (most recent).
            out.splice(at, 1);
        }
        out.push(entry);
    }
    return out.length > max ? out.slice(out.length - max) : out;
};

const TITLES = new Set(['lord', 'lady', 'sir', 'dame', 'king', 'queen', 'prince', 'princess', 'duke', 'duchess',
    'captain', 'master', 'mistress', 'father', 'mother', 'brother', 'sister', 'the', 'of', 'house', 'young', 'old', 'elder']);

/**
 * The words that identify an NPC in prose: the given name, plus a two-word
 * "Title Name" form. A shared surname alone ("Calder") names a family, not
 * a person, so it never counts.
 */
export const identifyingNames = (name: string): string[] => {
    const core = (name ?? '').replace(/\([^)]*\)/g, ' ').replace(/,.*$/, '').trim();
    const parts = core.split(/\s+/).filter(Boolean);
    const given = parts.find(p => !TITLES.has(p.toLowerCase()) && p.length >= 3);
    return given ? [given] : [];
};

const namesIn = (fact: string, names: string[]): boolean =>
    names.some(n => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:'s|’s)?\\b`).test(fact));

/**
 * File memory facts on the NPCs they name. `facts` are this turn's new or
 * updated memories; entities with no `witnessed` field yet are back-filled
 * once from the whole store (so existing saves start with their history).
 */
export const fileWitnessedFacts = (
    entities: KnownEntity[],
    turnFacts: MemoryItem[],
    allMemory: MemoryItem[],
): { entities: KnownEntity[]; filed: Array<{ name: string; count: number }> } => {
    const filed: Array<{ name: string; count: number }> = [];
    const next = entities.map(e => {
        if (e.status === 'dead') return e;
        const names = identifyingNames(e.name);
        if (names.length === 0) return e.witnessed === undefined ? { ...e, witnessed: [] } : e;
        const source = e.witnessed === undefined ? allMemory : turnFacts;
        const hits = source.filter(m => typeof m.fact === 'string' && namesIn(m.fact, names)).map(m => m.fact.trim());
        if (hits.length === 0) return e.witnessed === undefined ? { ...e, witnessed: [] } : e;
        const witnessed = mergeLedger(e.witnessed, hits, WITNESSED_MAX);
        filed.push({ name: e.name, count: hits.length });
        return { ...e, witnessed };
    });
    return { entities: next, filed };
};

const relevance = (entry: string, queryWords: Set<string>): number => {
    if (queryWords.size === 0) return 0;
    let n = 0;
    for (const w of new Set(words(entry))) if (queryWords.has(w)) n++;
    return n;
};

/**
 * Ledger for an in-scene NPC: the most recent entries, plus older entries the
 * current turn touches. Chronological order is kept.
 */
export const selectLedgerForPrompt = (ledger: string[] | undefined, query: string): string[] => {
    const all = (ledger ?? []).filter(Boolean);
    if (all.length <= LEDGER_PROMPT_RECENT + LEDGER_PROMPT_RELEVANT) return all;
    const recentStart = all.length - LEDGER_PROMPT_RECENT;
    const q = new Set(words(query));
    const older = all.slice(0, recentStart)
        .map((entry, i) => ({ i, score: relevance(entry, q) }))
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score || b.i - a.i)
        .slice(0, LEDGER_PROMPT_RELEVANT)
        .map(x => x.i);
    const keep = new Set([...older, ...all.map((_, i) => i).slice(recentStart)]);
    return all.filter((_, i) => keep.has(i));
};

/**
 * What an in-scene NPC has been part of: entries relevant to the turn first,
 * then the most recent, up to the cap. Chronological order is kept.
 */
export const selectWitnessedForPrompt = (witnessed: string[] | undefined, query: string): string[] => {
    const all = (witnessed ?? []).filter(Boolean);
    if (all.length <= WITNESSED_PROMPT_MAX) return all;
    const q = new Set(words(query));
    const ranked = all.map((entry, i) => ({ i, score: relevance(entry, q) }))
        .sort((a, b) => b.score - a.score || b.i - a.i)
        .slice(0, WITNESSED_PROMPT_MAX)
        .map(x => x.i);
    const keep = new Set(ranked);
    return all.filter((_, i) => keep.has(i));
};
