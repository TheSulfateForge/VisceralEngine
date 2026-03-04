/**
 * contentValidation.ts — v1.7 CHANGES
 *
 * KEY CHANGE: sanitiseBannedNames() and sanitiseAllFields() now use the
 * nameResolver module for immediate resolution instead of wrapping in
 * [RENAME:X] markers.
 *
 * This file shows ONLY the functions that change. All other functions
 * (findExpiredConditions, checkMemoryDuplicate, checkLoreDuplicate, etc.)
 * remain unchanged.
 */

import { BANNED_NAMES } from '../constants';
import { ModelResponseSchema, LoreItem, MemoryItem } from '../types';
import { resolveAllBannedNames, resolveWithTracking } from './nameResolver';

// ---------------------------------------------------------------------------
// Core: banned name detector (UNCHANGED)
// ---------------------------------------------------------------------------

export const findBannedNames = (text: string): string[] => {
    return BANNED_NAMES.filter(name => {
        const pattern = new RegExp(`\\b${name}\\b`);
        return pattern.test(text);
    });
};

// ---------------------------------------------------------------------------
// CHANGED: sanitiseBannedNames() — now resolves immediately via nameMap
// ---------------------------------------------------------------------------

/**
 * Replaces banned names in text with their mapped replacements.
 *
 * v1.7 CHANGE: No longer wraps in [RENAME:X] markers. Instead, uses the
 * nameResolver module to immediately substitute compliant replacement names.
 * The nameMap is passed in and may be mutated to add new mappings.
 *
 * SIGNATURE CHANGE: Now requires a nameMap parameter.
 * All call sites must be updated to pass the map.
 */
export const sanitiseBannedNames = (
    text: string,
    nameMap: Record<string, string>
): { result: string; violations: string[] } => {
    if (!text) return { result: text, violations: [] };

    const { result, violations } = resolveWithTracking(text, nameMap);
    return { result, violations };
};

// ---------------------------------------------------------------------------
// containsRenameMarker — UNCHANGED but now mostly vestigial
// (kept for backwards compatibility during transition)
// ---------------------------------------------------------------------------

/**
 * @deprecated v1.7 — Vestigial safety net from the [RENAME:X] marker system.
 * The v1.7 nameResolver now resolves banned names immediately. This function
 * is kept only as a fallback guard in sanitiseAllFields(). Remove once
 * confirmed that no [RENAME:X] markers appear in production save files.
 */
export const containsRenameMarker = (text: string): boolean =>
    /\[RENAME:[^\]]+\]/i.test(text);

// ---------------------------------------------------------------------------
// CHANGED: sanitiseAllFields() — passes nameMap through all sanitisation
// ---------------------------------------------------------------------------

export interface FullSanitisationResult {
    sanitisedResponse: ModelResponseSchema;
    allViolations: string[];
}

/**
 * Sanitises ALL string fields in the AI response before anything touches state.
 *
 * v1.7 CHANGE: Accepts a nameMap parameter. All field sanitisation now
 * resolves immediately rather than wrapping in [RENAME:X].
 * The entity filter (section 11) no longer needs to drop RENAME-marker
 * entities because markers are resolved before they reach state.
 *
 * SIGNATURE CHANGE: Now requires a nameMap parameter.
 */
export const sanitiseAllFields = (
    response: ModelResponseSchema,
    nameMap: Record<string, string>
): FullSanitisationResult => {
    const allViolations: string[] = [];
    const track = (violations: string[]) => {
        violations.forEach(v => { if (!allViolations.includes(v)) allViolations.push(v); });
    };

    const r: ModelResponseSchema = JSON.parse(JSON.stringify(response));

    // Helper: resolve a single string field
    const clean = (text: string): string => {
        const { result, violations } = sanitiseBannedNames(text, nameMap);
        track(violations);
        return result;
    };

    // 1. Narrative
    r.narrative = clean(r.narrative ?? '');

    // 2. thought_process
    if (r.thought_process) {
        r.thought_process = clean(r.thought_process);
    }

    // 3. character_updates — added_conditions
    if (r.character_updates?.added_conditions) {
        r.character_updates.added_conditions = r.character_updates.added_conditions.map(clean);
    }

    // 4. new_memory.fact
    if (r.new_memory?.fact) {
        r.new_memory.fact = clean(r.new_memory.fact);
    }

    // 5. new_lore — keyword and content
    // v1.7: Since we now resolve immediately, [RENAME:X] markers should never
    // survive. But we keep the containsRenameMarker guard as a safety net.
    if (r.new_lore) {
        r.new_lore.keyword = clean(r.new_lore.keyword);
        r.new_lore.content = clean(r.new_lore.content);

        // Safety net: if somehow a marker survived resolution, null it out
        if (containsRenameMarker(r.new_lore.keyword) || containsRenameMarker(r.new_lore.content)) {
            r.new_lore = null;
        }
    }

    // 6. npc_interaction
    if (r.npc_interaction) {
        const fields: Array<keyof typeof r.npc_interaction> = ['speaker', 'dialogue', 'subtext', 'biological_tells'];
        const interaction = r.npc_interaction as unknown as Record<string, unknown>;
        for (const field of fields) {
            if (typeof r.npc_interaction[field] === 'string') {
                interaction[field] = clean(r.npc_interaction[field] as string);
            }
        }
    }

    // 7. world_tick — npc_actions
    if (r.world_tick?.npc_actions) {
        r.world_tick.npc_actions = r.world_tick.npc_actions.map(action => ({
            ...action,
            npc_name: clean(action.npc_name),
            action: clean(action.action),
        }));
    }

    // 8. world_tick — environment_changes
    if (r.world_tick?.environment_changes) {
        r.world_tick.environment_changes = r.world_tick.environment_changes.map(clean);
    }

    // 9. world_tick — emerging_threats
    if (r.world_tick?.emerging_threats) {
        r.world_tick.emerging_threats = r.world_tick.emerging_threats.map(threat => ({
            ...threat,
            description: clean(threat.description),
        }));
    }

    // 10. hidden_update
    if (r.hidden_update) {
        r.hidden_update = clean(r.hidden_update);
    }

    // 11. known_entity_updates
    // v1.7: No longer need to filter out RENAME-marker entities since
    // resolution is immediate. We still sanitise all fields.
    if (r.known_entity_updates) {
        r.known_entity_updates = r.known_entity_updates.map(entity => ({
            ...entity,
            name: clean(entity.name),
            role: clean(entity.role),
            impression: clean(entity.impression),
            leverage: clean(entity.leverage),
            ledger: (entity.ledger ?? []).map(clean),
        }));
    }

    return { sanitisedResponse: r, allViolations };
};

// ---------------------------------------------------------------------------
// Memory deduplication
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
    'a','an','the','and','or','but','in','on','at','to','for','of','with',
    'his','her','their','its','is','are','was','were','has','have','had',
    'that','this','it','he','she','they','we','i','you','be','been','being',
]);
import {
    MEMORY_SIMILARITY_THRESHOLD, LORE_SIMILARITY_THRESHOLD,
    LORE_SAME_TOPIC_SIMILARITY_THRESHOLD,
    BIO_MODIFIER_CEILING, BIO_MODIFIER_DECAY_RATE,
    CONDITION_SIMILARITY_THRESHOLD
} from '../config/engineConfig';

export const significantWords = (text: string): Set<string> => {
    return new Set(
        text.toLowerCase()
            .replace(/[^a-z0-9 ]/g, '')
            .split(' ')
            .filter(w => w.length > 2 && !STOP_WORDS.has(w))
    );
};

export const jaccardSimilarity = (a: Set<string>, b: Set<string>): number => {
    const intersection = new Set([...a].filter(w => b.has(w)));
    const union = new Set([...a, ...b]);
    return union.size === 0 ? 0 : intersection.size / union.size;
};

/**
 * v1.12: Bi-gram Jaccard similarity — catches keyword-synonym variations that
 * word-level Jaccard misses. "Floor 1 Acoustics" vs "Acoustics of Floor 1"
 * have low word-Jaccard because "of" is a stop word, but high bi-gram overlap.
 * 
 * Also handles synonym pairs like "Gear" / "Specs", "Infiltration" / "Guild Infiltration"
 * by extracting consecutive word pairs and comparing overlap.
 */
export const bigramJaccardSimilarity = (a: string, b: string): number => {
    const toBigrams = (text: string): Set<string> => {
        const words = text.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 1);
        const bigrams = new Set<string>();
        for (let i = 0; i < words.length - 1; i++) {
            bigrams.add(`${words[i]}_${words[i + 1]}`);
        }
        // Also add individual significant words (length > 3) as unigrams
        // This ensures single-keyword overlap still counts
        words.filter(w => w.length > 3).forEach(w => bigrams.add(w));
        return bigrams;
    };
    const bigramsA = toBigrams(a);
    const bigramsB = toBigrams(b);
    const intersection = new Set([...bigramsA].filter(b => bigramsB.has(b)));
    const union = new Set([...bigramsA, ...bigramsB]);
    return union.size === 0 ? 0 : intersection.size / union.size;
};

export const checkMemoryDuplicate = (
    newFact: string,
    existingMemory: MemoryItem[]
): { isDuplicate: boolean; isUpdate: boolean; existingIndex: number } => {
    const newWords = significantWords(newFact);

    for (let i = 0; i < existingMemory.length; i++) {
        const existingWords = significantWords(existingMemory[i].fact);
        const similarity = jaccardSimilarity(newWords, existingWords);

        if (similarity >= MEMORY_SIMILARITY_THRESHOLD) {
            const isUpdate = newFact.length > existingMemory[i].fact.length;
            return { isDuplicate: !isUpdate, isUpdate, existingIndex: i };
        }
    }

    return { isDuplicate: false, isUpdate: false, existingIndex: -1 };
};

/**
 * v1.12: Auto-consolidate memory when cap is hit.
 * Groups memories by significant word overlap (clusters), then replaces each
 * cluster with the single longest/most-recent entry. Frees slots for new memories.
 *
 * Returns a new array with clusters consolidated.
 */
export const autoConsolidateMemory = (
    memory: MemoryItem[],
    debugLogs: { push: (log: { timestamp: string; message: string; type: string }) => void }
): MemoryItem[] => {
    if (memory.length < 30) return memory; // Only consolidate when getting close to cap

    // Build adjacency clusters using a lower threshold (0.40) than dedup (0.55)
    // This catches "near-related" memories about the same event
    const CLUSTER_THRESHOLD = 0.40;
    const visited = new Set<number>();
    const clusters: number[][] = [];

    for (let i = 0; i < memory.length; i++) {
        if (visited.has(i)) continue;
        const cluster = [i];
        visited.add(i);
        const wordsI = significantWords(memory[i].fact);

        for (let j = i + 1; j < memory.length; j++) {
            if (visited.has(j)) continue;
            const wordsJ = significantWords(memory[j].fact);
            const sim = jaccardSimilarity(wordsI, wordsJ);
            if (sim >= CLUSTER_THRESHOLD) {
                cluster.push(j);
                visited.add(j);
            }
        }

        if (cluster.length > 1) {
            clusters.push(cluster);
        }
    }

    if (clusters.length === 0) return memory;

    // For each cluster, keep the longest entry (most information)
    const toRemove = new Set<number>();
    let freedCount = 0;

    for (const cluster of clusters) {
        // Sort by fact length descending — keep the longest
        const sorted = [...cluster].sort((a, b) => memory[b].fact.length - memory[a].fact.length);
        const keeper = sorted[0];
        for (let k = 1; k < sorted.length; k++) {
            toRemove.add(sorted[k]);
            freedCount++;
        }

        debugLogs.push({
            timestamp: new Date().toISOString(),
            message: `[MEMORY CONSOLIDATION — v1.12] Cluster of ${cluster.length} merged → keeping: "${memory[keeper].fact.substring(0, 60)}" | Removed ${cluster.length - 1} near-duplicates`,
            type: 'info'
        });
    }

    const consolidated = memory.filter((_, i) => !toRemove.has(i));

    debugLogs.push({
        timestamp: new Date().toISOString(),
        message: `[MEMORY CONSOLIDATION — v1.12] Freed ${freedCount} slots (${memory.length} → ${consolidated.length})`,
        type: 'success'
    });

    return consolidated;
};

// ---------------------------------------------------------------------------
// Lore deduplication helpers
// ---------------------------------------------------------------------------

export const findExistingLore = (keyword: string, lore: LoreItem[]): LoreItem | undefined => {
    return lore.find(l => l.keyword.toLowerCase() === keyword.toLowerCase());
};

/**
 * v1.4 / v1.5: Semantic duplicate detector for lore entries.
 * Uses the same Jaccard / significant-word algorithm as checkMemoryDuplicate,
 * but at a slightly lower threshold (0.60 vs 0.65) since lore keywords are shorter.
 * Combines keyword + content for a richer signal.
 *
 * v1.5 FIX 8: When both the new entry and an existing entry share the same leading
 * keyword prefix (e.g., both start with "Tharnic"), a stricter threshold of 0.40
 * is applied. This catches intra-topic near-duplicates (like multiple "Tharnic Security"
 * variants) that would slip past the standard 0.60 threshold.
 *
 * Returns:
 *   isDuplicate: true  → suppress the new entry entirely
 *   isUpdate:    true  → new entry is substantially longer; offer as a replacement
 *   existingIndex      → index of the matching existing entry
 */
export const checkLoreDuplicate = (
    newKeyword: string,
    newContent: string,
    existingLore: LoreItem[]
): { isDuplicate: boolean; isUpdate: boolean; existingIndex: number } => {
    const newText = `${newKeyword} ${newContent}`;
    const newWords = significantWords(newText);
    // Extract the first word of the keyword as the topic prefix (e.g., "Tharnic" from "Tharnic Security")
    const newPrefix = newKeyword.trim().split(/\s+/)[0].toLowerCase();

    for (let i = 0; i < existingLore.length; i++) {
        const existingText = `${existingLore[i].keyword} ${existingLore[i].content}`;
        const existingWords = significantWords(existingText);
        const existingPrefix = existingLore[i].keyword.trim().split(/\s+/)[0].toLowerCase();

        // FIX 8: Use stricter threshold when both entries share a meaningful topic prefix.
        // Minimum prefix length of 4 prevents short prefixes like "The" or "A" from triggering.
        const sharedPrefix = newPrefix === existingPrefix && newPrefix.length >= 4;
        const threshold = sharedPrefix ? LORE_SAME_TOPIC_SIMILARITY_THRESHOLD : LORE_SIMILARITY_THRESHOLD;

        const similarity = jaccardSimilarity(newWords, existingWords);

        if (similarity >= threshold) {
            // isUpdate = true when the new entry is substantially longer (an expansion)
            const isUpdate = newContent.length > existingLore[i].content.length * 1.25;
            return { isDuplicate: !isUpdate, isUpdate, existingIndex: i };
        }
    }

    // v1.12 FIX CV-3: Bi-gram fallback for keyword-synonym variations
    // Only triggers for entries with shared topic prefix that escaped word-Jaccard
    for (let i = 0; i < existingLore.length; i++) {
        const existingPrefix = existingLore[i].keyword.trim().split(/\s+/)[0].toLowerCase();
        const sharedPrefix = newPrefix === existingPrefix && newPrefix.length >= 4;
        if (!sharedPrefix) continue;

        const bigramSim = bigramJaccardSimilarity(
            `${newKeyword} ${newContent}`,
            `${existingLore[i].keyword} ${existingLore[i].content}`
        );

        // Lower threshold for bi-gram: 0.30 catches "Syndicate Tracking Gear" vs "Syndicate Tracking Specs"
        if (bigramSim >= 0.30) {
            const isUpdate = newContent.length > existingLore[i].content.length * 1.25;
            return { isDuplicate: !isUpdate, isUpdate, existingIndex: i };
        }
    }

    return { isDuplicate: false, isUpdate: false, existingIndex: -1 };
};

// ---------------------------------------------------------------------------
// Condition semantic deduplication (v1.5)
// ---------------------------------------------------------------------------

export const checkConditionDuplicate = (
    newCondition: string,
    existingConditions: string[]
): { isDuplicate: boolean; existingIndex: number } => {
    const newWords = significantWords(newCondition);
    for (let i = 0; i < existingConditions.length; i++) {
        const sim = jaccardSimilarity(newWords, significantWords(existingConditions[i]));
        if (sim >= CONDITION_SIMILARITY_THRESHOLD) {
            return { isDuplicate: true, existingIndex: i };
        }
    }
    return { isDuplicate: false, existingIndex: -1 };
};

/**
 * v1.12: Extracts the mechanical effect from a condition's parenthetical modifier.
 * "Heavy Breathing (Stamina Recovery -5%)" → "stamina recovery -5%"
 * "Winded (Stamina Recovery -5%)" → "stamina recovery -5%"
 * 
 * Two conditions with identical mechanical effects are duplicates regardless
 * of their display names.
 */
export const extractMechanicalEffect = (condition: string): string | null => {
    const match = /\(([^)]+)\)/.exec(condition);
    if (!match) return null;
    return match[1].toLowerCase().trim();
};

/**
 * v1.12: Enhanced condition dedup that also checks mechanical effects.
 * If two conditions have different names but identical parenthetical effects,
 * the newer one is a duplicate.
 */
export const checkConditionDuplicateEnhanced = (
    newCondition: string,
    existingConditions: string[]
): { isDuplicate: boolean; existingIndex: number } => {
    // First: standard semantic check
    const baseResult = checkConditionDuplicate(newCondition, existingConditions);
    if (baseResult.isDuplicate) return baseResult;

    // Second: mechanical effect check
    const newEffect = extractMechanicalEffect(newCondition);
    if (!newEffect) return { isDuplicate: false, existingIndex: -1 };

    for (let i = 0; i < existingConditions.length; i++) {
        const existingEffect = extractMechanicalEffect(existingConditions[i]);
        if (existingEffect && existingEffect === newEffect) {
            return { isDuplicate: true, existingIndex: i };
        }
    }

    return { isDuplicate: false, existingIndex: -1 };
};

// ---------------------------------------------------------------------------
// Condition validators
// ---------------------------------------------------------------------------

const MAX_CONDITION_LENGTH = 120;

export const validateConditions = (conditions: string[]): string[] => {
    return conditions.filter(c => {
        if (c.length > MAX_CONDITION_LENGTH) return false;
        if (/\.\s+[A-Z]/.test(c)) return false;
        return true;
    });
};

// ---------------------------------------------------------------------------
// Timed condition expiry
// ---------------------------------------------------------------------------

const DURATION_PATTERN = /\((\d+)\s*mins?\)/i;

/**
 * Named transient condition prefixes — these auto-expire after TRANSIENT_EXPIRY_MINUTES
 * of in-game time even if they lack an explicit (Xmins) duration stamp.
 *
 * v1.5 FIX 3b: Catches conditions like "Adrenaline Surge", "Adrenaline High",
 * "Ambrosia Afterglow", "Magical Overclock" that accumulate and never expire because
 * they weren't given a duration suffix when originally added.
 */
const TRANSIENT_PREFIXES = [
    'Adrenaline',
    'Ambrosia Afterglow',
    'Magical Overclock',
    'Soot-Stained',
    'Numbed',
    'Catharsis',
    'Focused',
    'Tactical Advantage',
    'Tactical Dominance',
    'Tactical Overwatch',
    'Tactical',          // v1.12: catches "Tactical X" variants
    'Rested',
    'Refreshed',         // v1.12 FIX: was missing — "Refreshed" ≠ "Rested"
    'Well-Fed',
    'Heightened',        // v1.12 FIX: catches "Heightened Hearing", "Heightened Senses"
    'Arcane Ready',      // v1.12 FIX: transient magic prep state
    'Sated',             // v1.12 FIX: catches "Sated Glow", "Sated"
    'Cold-Blooded',      // v1.12: combat aftermath adrenaline variant
    'Vermin-Slayer',     // v1.12: post-combat buff
    'Alpha Slayer',      // v1.12: post-combat buff
];

/** In-game minutes after which a named transient auto-expires. */
const TRANSIENT_EXPIRY_MINUTES = 60;

/**
 * Returns conditions that should be removed this turn due to elapsed time.
 *
 * Two removal paths:
 *  1. Explicit duration: condition contains "(Xmins)" pattern → expires when duration elapsed.
 *  2. Named transient prefix: condition starts with a known transient keyword →
 *     expires after TRANSIENT_EXPIRY_MINUTES of in-game time from when it was applied.
 *
 * Both paths use conditionTimestamps (in totalMinutes) for the elapsed-time comparison.
 */
export const findExpiredConditions = (
    conditions: string[],
    timestamps: Record<string, number>,
    currentMinutes: number
): string[] => {
    return conditions.filter(condition => {
        // Path 1: explicit (Xmins) duration stamp
        const match = DURATION_PATTERN.exec(condition);
        if (match) {
            const duration = parseInt(match[1], 10);
            const appliedAt = timestamps[condition];
            if (appliedAt === undefined) return false;
            return (currentMinutes - appliedAt) >= duration;
        }

        // Path 2: named transient prefix — FIX 3b
        const isTransient = TRANSIENT_PREFIXES.some(prefix => condition.startsWith(prefix));
        if (isTransient) {
            const appliedAt = timestamps[condition];
            if (appliedAt === undefined) return false;
            return (currentMinutes - appliedAt) >= TRANSIENT_EXPIRY_MINUTES;
        }

        return false;
    });
};

// ---------------------------------------------------------------------------
// Condition partitioning for prompt context
// ---------------------------------------------------------------------------

export const partitionConditions = (conditions: string[]): { active: string[]; passive: string[] } => {
    const passive = conditions.filter(c =>
        c.startsWith('Bonded:') ||
        c.startsWith('Homeowner:') ||
        c.startsWith('Legally') ||
        c.startsWith('Social Standing:') ||
        c.startsWith('Vision:')
    );
    const active = conditions.filter(c => !passive.includes(c));
    return { active, passive };
};

// ---------------------------------------------------------------------------
// Bio modifier ceilings
// ---------------------------------------------------------------------------

/**
 * Clamps bio modifiers to their per-stat ceiling values.
 * The AI cannot push a modifier above its ceiling regardless of what value it provides.
 */
export const applyCeilings = (
    modifiers: { calories: number; hydration: number; stamina: number; lactation: number }
): typeof modifiers => {
    return {
        calories:  Math.min(modifiers.calories,  BIO_MODIFIER_CEILING.calories),
        hydration: Math.min(modifiers.hydration, BIO_MODIFIER_CEILING.hydration),
        stamina:   Math.min(modifiers.stamina,   BIO_MODIFIER_CEILING.stamina),
        lactation: Math.min(modifiers.lactation, BIO_MODIFIER_CEILING.lactation),
    };
};

// ---------------------------------------------------------------------------
// Bio modifier decay
// ---------------------------------------------------------------------------

export const decayBioModifiers = (
    modifiers: { calories: number; hydration: number; stamina: number; lactation: number },
    accelerated = false
): typeof modifiers => {
    const rate = accelerated ? BIO_MODIFIER_DECAY_RATE * 2 : BIO_MODIFIER_DECAY_RATE;
    const decay = (val: number, baseline = 1.0) =>
        val > baseline ? Math.max(baseline, val - rate) :
        val < baseline ? Math.min(baseline, val + rate) : val;
    return {
        calories:  decay(modifiers.calories),
        hydration: decay(modifiers.hydration),
        stamina:   decay(modifiers.stamina),
        lactation: decay(modifiers.lactation),
    };
};

// ---------------------------------------------------------------------------
// Legacy top-level validateResponse has been removed.
// Use sanitiseAllFields directly.
// ---------------------------------------------------------------------------
