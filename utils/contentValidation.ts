/**
 * contentValidation.ts — v1.5
 *
 * v1.3 changes:
 *   - Banned name scanning now covers ALL string fields in the AI response,
 *     not just the narrative text. Conditions, memory facts, lore entries,
 *     NPC interaction fields, and world_tick entries are all scanned and
 *     sanitised before being written to state.
 *   - Added sanitiseAllFields() for full-response sanitisation.
 *
 * v1.4 changes:
 *   - containsRenameMarker(): detects unresolved [RENAME:X] placeholders.
 *   - checkLoreDuplicate(): semantic Jaccard similarity check for lore (threshold 0.60),
 *     preventing near-duplicate entries like "Silver-Stabilized" vs "Silver-Stilled".
 *   - sanitiseAllFields() section 5 (new_lore): nulls out lore entries that still
 *     contain [RENAME:X] markers after sanitisation — they never reach the approval modal.
 *   - sanitiseAllFields() section 11 (known_entity_updates): filters out entity updates
 *     whose name still contains a [RENAME:X] marker, preserving the existing registry entry.
 *
 * v1.5 changes:
 *   - FIX 1: sanitiseBannedNames() now guards against double-wrapping. If the input
 *     string already contains a [RENAME:X] marker, it is returned unchanged. This
 *     prevents the nested [RENAME:[RENAME:X]] bug when the AI re-submits a previously
 *     flagged entity name.
 *   - FIX 3b: findExpiredConditions() now handles named transient condition prefixes
 *     (Adrenaline, Ambrosia Afterglow, Magical Overclock, etc.) that lack an explicit
 *     (Xmins) duration stamp. These auto-expire after TRANSIENT_EXPIRY_MINUTES of
 *     in-game time from when they were first applied.
 *   - FIX 8: checkLoreDuplicate() now applies a stricter shared-prefix threshold (0.40)
 *     when two lore entries begin with the same topic prefix (e.g., both "Tharnic ...").
 *     This catches near-duplicates within the same faction/topic cluster that would
 *     otherwise slip through the standard 0.60 threshold.
 */

import { BANNED_NAMES } from '../constants';
import { ModelResponseSchema, LoreItem, MemoryItem } from '../types';

// ---------------------------------------------------------------------------
// Core: banned name detector
// ---------------------------------------------------------------------------

export const findBannedNames = (text: string): string[] => {
    return BANNED_NAMES.filter(name => {
        const pattern = new RegExp(`\\b${name}\\b`);
        return pattern.test(text);
    });
};

/**
 * Replaces banned names in text with [RENAME:X] markers.
 *
 * v1.5 FIX 1: If the input already contains a [RENAME:X] marker, return it unchanged.
 * Re-scanning a previously-flagged string wraps the placeholder's own content,
 * producing nested tokens like [RENAME:[RENAME:Kaelith]]. The guard breaks that loop.
 */
export const sanitiseBannedNames = (text: string): { result: string; violations: string[] } => {
    // FIX 1: Early-return guard — do not re-process strings that already have a marker.
    // This prevents [RENAME:X] from being scanned again and producing [RENAME:[RENAME:X]].
    if (/\[RENAME:[^\]]+\]/i.test(text)) {
        return { result: text, violations: [] };
    }

    const violations: string[] = [];
    let result = text;

    for (const name of BANNED_NAMES) {
        const pattern = new RegExp(`\\b${name}\\b`, 'g');
        if (pattern.test(result)) {
            violations.push(name);
            result = result.replace(new RegExp(`\\b${name}\\b`, 'g'), `[RENAME:${name}]`);
        }
    }

    return { result, violations };
};

// ---------------------------------------------------------------------------
// v1.3: Full-response field sanitisation
// Scans every string field in the parsed AI response, not just narrative.
// Returns the sanitised response and all violations found across all fields.
// ---------------------------------------------------------------------------

export interface FullSanitisationResult {
    sanitisedResponse: ModelResponseSchema;
    allViolations: string[];
}

/**
 * Sanitises ALL string fields in the AI response before anything touches state.
 * This prevents banned names from being written into conditions, memory facts,
 * lore entries, NPC names, or world_tick entries.
 */
export const sanitiseAllFields = (response: ModelResponseSchema): FullSanitisationResult => {
    const allViolations: string[] = [];
    const track = (violations: string[]) => {
        violations.forEach(v => { if (!allViolations.includes(v)) allViolations.push(v); });
    };

    // Deep clone to avoid mutating the original
    const r: ModelResponseSchema = JSON.parse(JSON.stringify(response));

    // 1. Narrative (existing behaviour)
    const { result: cleanNarrative, violations: narViolations } = sanitiseBannedNames(r.narrative ?? '');
    r.narrative = cleanNarrative;
    track(narViolations);

    // 2. thought_process
    if (r.thought_process) {
        const { result, violations } = sanitiseBannedNames(r.thought_process);
        r.thought_process = result;
        track(violations);
    }

    // 3. character_updates — added_conditions
    if (r.character_updates?.added_conditions) {
        r.character_updates.added_conditions = r.character_updates.added_conditions.map(c => {
            const { result, violations } = sanitiseBannedNames(c);
            track(violations);
            return result;
        });
    }

    // 4. new_memory.fact
    if (r.new_memory?.fact) {
        const { result, violations } = sanitiseBannedNames(r.new_memory.fact);
        r.new_memory.fact = result;
        track(violations);
    }

    // 5. new_lore — keyword and content
    // v1.4: If [RENAME:X] survives sanitisation in either field, null out the lore entirely.
    // The AI used a banned name it couldn't auto-resolve — better to skip the entry than
    // write "[RENAME:Thorne]'s Equipment" into canonical lore where it will persist.
    if (r.new_lore) {
        const { result: kw, violations: kviol } = sanitiseBannedNames(r.new_lore.keyword);
        r.new_lore.keyword = kw;
        track(kviol);

        const { result: ct, violations: cviol } = sanitiseBannedNames(r.new_lore.content);
        r.new_lore.content = ct;
        track(cviol);

        if (containsRenameMarker(r.new_lore.keyword) || containsRenameMarker(r.new_lore.content)) {
            r.new_lore = null;
        }
    }

    // 6. npc_interaction — speaker, dialogue, subtext, biological_tells
    if (r.npc_interaction) {
        const fields: Array<keyof typeof r.npc_interaction> = ['speaker', 'dialogue', 'subtext', 'biological_tells'];
        const interaction = r.npc_interaction as unknown as Record<string, unknown>;
        for (const field of fields) {
            if (typeof r.npc_interaction[field] === 'string') {
                const { result, violations } = sanitiseBannedNames(r.npc_interaction[field] as string);
                interaction[field] = result;
                track(violations);
            }
        }
    }

    // 7. world_tick — npc_actions (npc_name and action)
    if (r.world_tick?.npc_actions) {
        r.world_tick.npc_actions = r.world_tick.npc_actions.map(action => {
            const { result: name, violations: nv } = sanitiseBannedNames(action.npc_name);
            track(nv);
            const { result: act, violations: av } = sanitiseBannedNames(action.action);
            track(av);
            return { ...action, npc_name: name, action: act };
        });
    }

    // 8. world_tick — environment_changes
    if (r.world_tick?.environment_changes) {
        r.world_tick.environment_changes = r.world_tick.environment_changes.map(change => {
            const { result, violations } = sanitiseBannedNames(change);
            track(violations);
            return result;
        });
    }

    // 9. world_tick — emerging_threats descriptions
    if (r.world_tick?.emerging_threats) {
        r.world_tick.emerging_threats = r.world_tick.emerging_threats.map(threat => {
            const { result, violations } = sanitiseBannedNames(threat.description);
            track(violations);
            return { ...threat, description: result };
        });
    }

    // 10. hidden_update
    if (r.hidden_update) {
        const { result, violations } = sanitiseBannedNames(r.hidden_update);
        r.hidden_update = result;
        track(violations);
    }

    // 11. known_entity_updates — name, role, impression, leverage, ledger entries
    // v1.4: Filter out any entity update whose name still contains a [RENAME:X] marker.
    // The AI failed to resolve the banned name — writing "Thor-6" into the registry
    // is worse than preserving the old entry until a clean name arrives next turn.
    if (r.known_entity_updates) {
        r.known_entity_updates = r.known_entity_updates.filter(entity => {
            if (containsRenameMarker(entity.name)) {
                track([`RENAME_MARKER_IN_ENTITY:${entity.name}`]);
                return false;
            }
            return true;
        });

        r.known_entity_updates = r.known_entity_updates.map(entity => {
            const scanField = (val: string): string => {
                const { result, violations } = sanitiseBannedNames(val);
                track(violations);
                return result;
            };
            return {
                ...entity,
                name: scanField(entity.name),
                role: scanField(entity.role),
                impression: scanField(entity.impression),
                leverage: scanField(entity.leverage),
                ledger: (entity.ledger ?? []).map(scanField),
            };
        });
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
const SIMILARITY_THRESHOLD = 0.65;
const LORE_SIMILARITY_THRESHOLD = 0.60;
// v1.5 FIX 8: Tighter threshold applied when two lore entries share a topic prefix.
const LORE_SHARED_PREFIX_THRESHOLD = 0.40;

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

export const checkMemoryDuplicate = (
    newFact: string,
    existingMemory: MemoryItem[]
): { isDuplicate: boolean; isUpdate: boolean; existingIndex: number } => {
    const newWords = significantWords(newFact);

    for (let i = 0; i < existingMemory.length; i++) {
        const existingWords = significantWords(existingMemory[i].fact);
        const similarity = jaccardSimilarity(newWords, existingWords);

        if (similarity >= SIMILARITY_THRESHOLD) {
            const isUpdate = newFact.length > existingMemory[i].fact.length;
            return { isDuplicate: !isUpdate, isUpdate, existingIndex: i };
        }
    }

    return { isDuplicate: false, isUpdate: false, existingIndex: -1 };
};

// ---------------------------------------------------------------------------
// Lore deduplication helpers
// ---------------------------------------------------------------------------

export const findExistingLore = (keyword: string, lore: LoreItem[]): LoreItem | undefined => {
    return lore.find(l => l.keyword.toLowerCase() === keyword.toLowerCase());
};

/**
 * v1.4: Detects unresolved [RENAME:X] placeholders in any string.
 * Used to guard lore entries and entity names from being written to state
 * with broken placeholder names.
 */
export const containsRenameMarker = (text: string): boolean =>
    /\[RENAME:[^\]]+\]/i.test(text);

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
        const threshold = sharedPrefix ? LORE_SHARED_PREFIX_THRESHOLD : LORE_SIMILARITY_THRESHOLD;

        const similarity = jaccardSimilarity(newWords, existingWords);

        if (similarity >= threshold) {
            // isUpdate = true when the new entry is substantially longer (an expansion)
            const isUpdate = newContent.length > existingLore[i].content.length * 1.25;
            return { isDuplicate: !isUpdate, isUpdate, existingIndex: i };
        }
    }

    return { isDuplicate: false, isUpdate: false, existingIndex: -1 };
};

// ---------------------------------------------------------------------------
// Condition semantic deduplication (v1.5)
// ---------------------------------------------------------------------------

const CONDITION_SIMILARITY_THRESHOLD = 0.55; // Lower than memory — conditions are short

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
    'Rested',
    'Well-Fed',
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

export const BIO_MODIFIER_CEILING = {
    stamina:   1.5,
    calories:  2.0,
    hydration: 2.0,
    lactation: 3.0,
};

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

const DECAY_RATE = 0.05;

export const decayBioModifiers = (
    modifiers: { calories: number; hydration: number; stamina: number; lactation: number },
    accelerated = false
): typeof modifiers => {
    const rate = accelerated ? DECAY_RATE * 2 : DECAY_RATE;
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
// Legacy top-level validateResponse (preserved for backward compatibility)
// Now delegates to sanitiseAllFields for narrative only to match old callers.
// New callers should use sanitiseAllFields directly.
// ---------------------------------------------------------------------------

export interface ValidationResult {
    bannedNameViolations: string[];
    sanitisedNarrative: string;
}

export const validateResponse = (response: ModelResponseSchema): ValidationResult => {
    const { result: sanitisedNarrative, violations: bannedNameViolations } =
        sanitiseBannedNames(response.narrative);

    return { bannedNameViolations, sanitisedNarrative };
};
