/**
 * contentValidation.ts — v1.3
 *
 * Runtime content validation layer.
 *
 * v1.3 changes:
 *   - Banned name scanning now covers ALL string fields in the AI response,
 *     not just the narrative text. Conditions, memory facts, lore entries,
 *     NPC interaction fields, and world_tick entries are all scanned and
 *     sanitised before being written to state.
 *   - Added sanitiseAllFields() for full-response sanitisation.
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

export const sanitiseBannedNames = (text: string): { result: string; violations: string[] } => {
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
    if (r.new_lore) {
        const { result: kw, violations: kviol } = sanitiseBannedNames(r.new_lore.keyword);
        r.new_lore.keyword = kw;
        track(kviol);

        const { result: ct, violations: cviol } = sanitiseBannedNames(r.new_lore.content);
        r.new_lore.content = ct;
        track(cviol);
    }

    // 6. npc_interaction — speaker, dialogue, subtext, biological_tells
    if (r.npc_interaction) {
        const fields: Array<keyof typeof r.npc_interaction> = ['speaker', 'dialogue', 'subtext', 'biological_tells'];
        for (const field of fields) {
            if (typeof r.npc_interaction[field] === 'string') {
                const { result, violations } = sanitiseBannedNames(r.npc_interaction[field] as string);
                (r.npc_interaction as Record<string, string>)[field] = result;
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
    if (r.known_entity_updates) {
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

const significantWords = (text: string): Set<string> => {
    return new Set(
        text.toLowerCase()
            .replace(/[^a-z0-9 ]/g, '')
            .split(' ')
            .filter(w => w.length > 2 && !STOP_WORDS.has(w))
    );
};

const jaccardSimilarity = (a: Set<string>, b: Set<string>): number => {
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
// Bio modifier decay
// ---------------------------------------------------------------------------

const DECAY_RATE = 0.05;

export const decayBioModifiers = (
    modifiers: { calories: number; hydration: number; stamina: number; lactation: number },
    accelerated = false
): typeof modifiers => {
    const rate = accelerated ? DECAY_RATE * 3 : DECAY_RATE;
    const decay = (val: number): number => {
        if (val === 0) return 0; // Zero disables the system — don't decay
        if (val > 1.0) return Math.max(1.0, val - rate);
        if (val < 1.0) return Math.min(1.0, val + rate);
        return val;
    };
    return {
        calories: decay(modifiers.calories),
        hydration: decay(modifiers.hydration),
        stamina: decay(modifiers.stamina),
        lactation: decay(modifiers.lactation),
    };
};

// ---------------------------------------------------------------------------
// Bio modifier ceiling enforcement (v1.3)
// ---------------------------------------------------------------------------

export const BIO_MODIFIER_CEILING: Record<string, number> = {
    calories: 2.0,
    hydration: 2.0,
    stamina: 1.5,
    lactation: 3.0,
};

/**
 * Applies ceiling caps to bio modifiers before they are written to state.
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
// Timed condition expiry
// ---------------------------------------------------------------------------

const DURATION_PATTERN = /\((\d+)\s*mins?\)/i;

export const findExpiredConditions = (
    conditions: string[],
    timestamps: Record<string, number>,
    currentMinutes: number
): string[] => {
    return conditions.filter(condition => {
        const match = DURATION_PATTERN.exec(condition);
        if (!match) return false;
        const duration = parseInt(match[1], 10);
        const appliedAt = timestamps[condition];
        if (appliedAt === undefined) return false;
        return (currentMinutes - appliedAt) >= duration;
    });
};

// ---------------------------------------------------------------------------
// Lore deduplication helpers
// ---------------------------------------------------------------------------

export const findExistingLore = (keyword: string, lore: LoreItem[]): LoreItem | undefined => {
    return lore.find(l => l.keyword.toLowerCase() === keyword.toLowerCase());
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
