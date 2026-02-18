/**
 * contentValidation.ts
 *
 * Runtime content validation layer.
 *
 * The system prompt tells the AI not to use banned names — but LLMs slip,
 * especially when a player explicitly types a banned name or when the AI
 * builds on prior context that contains one. Once a banned name enters
 * saved state (conditions, memory, lore, entities, narrative), it becomes
 * entrenched for the rest of the campaign.
 *
 * This module intercepts AI output before it touches persistent state and
 * sanitises it at the write boundary, not just at the prompt level.
 */

import { BANNED_NAMES } from '../constants';
import { ModelResponseSchema, LoreItem, MemoryItem } from '../types';

// ---------------------------------------------------------------------------
// Core: banned name detector
// ---------------------------------------------------------------------------

/**
 * Returns an array of banned names found in the given text (case-sensitive
 * whole-word match, same behaviour the AI is instructed to follow).
 */
export const findBannedNames = (text: string): string[] => {
    return BANNED_NAMES.filter(name => {
        // Whole-word boundary match — "Lyra" should match but "Lyrate" should not
        const pattern = new RegExp(`\\b${name}\\b`);
        return pattern.test(text);
    });
};

/**
 * Replaces all occurrences of banned names in text with a placeholder that
 * makes the violation visible to the player and to the debug log.
 *
 * The placeholder keeps the original name in brackets so the player can
 * decide what to rename the character.
 */
export const sanitiseBannedNames = (text: string): { result: string; violations: string[] } => {
    const violations: string[] = [];
    let result = text;

    for (const name of BANNED_NAMES) {
        const pattern = new RegExp(`\\b${name}\\b`, 'g');
        if (pattern.test(result)) {
            violations.push(name);
            // Reset lastIndex after test()
            result = result.replace(new RegExp(`\\b${name}\\b`, 'g'), `[RENAME:${name}]`);
        }
    }

    return { result, violations };
};

// ---------------------------------------------------------------------------
// Condition validators
// ---------------------------------------------------------------------------

/**
 * CONDITION FORMAT GUARD
 *
 * Conditions should be concise active game-states ("Broken Left Arm",
 * "Dehydrated", "Void Feedback (Aching Teeth)"). The AI sometimes writes
 * multi-sentence personality paragraphs — especially during character
 * creation when it maps backstory traits into the conditions array.
 *
 * A condition longer than MAX_CONDITION_LENGTH characters, or containing
 * a sentence-ending period followed by another sentence, is a trait
 * description, not a condition. It belongs in the character backstory,
 * not in the mechanical conditions list.
 *
 * This function DOES NOT remove those entries — the player may have
 * added them deliberately. It flags them so the UI can visually distinguish
 * them, and so the prompt builder can route them to the right section.
 */
const MAX_CONDITION_LENGTH = 80;
const MULTI_SENTENCE_PATTERN = /\.\s+[A-Z]/;

export const isTraitDescription = (condition: string): boolean => {
    return condition.length > MAX_CONDITION_LENGTH || MULTI_SENTENCE_PATTERN.test(condition);
};

/**
 * Splits a conditions array into active mechanical conditions and trait
 * descriptions that leaked in from character creation.
 */
export const partitionConditions = (
    conditions: string[]
): { active: string[]; traits: string[] } => {
    const active: string[] = [];
    const traits: string[] = [];
    for (const c of conditions) {
        if (isTraitDescription(c)) traits.push(c);
        else active.push(c);
    }
    return { active, traits };
};

// ---------------------------------------------------------------------------
// Timed condition expiry
// ---------------------------------------------------------------------------

/**
 * TIMED CONDITION EXPIRY
 *
 * Conditions that include an explicit duration in their name
 * (e.g. "Adrenaline Surge (Stamina burn reduced for 10 mins)")
 * should expire automatically when that duration has elapsed.
 *
 * This function scans the conditions list against the current game time
 * (in total minutes) and returns those that have definitively expired.
 *
 * Duration is parsed from the condition name. Supported formats:
 *   (X min)   (X mins)   (X minute)   (X minutes)
 *   (X hour)  (X hours)
 *
 * For this to work, conditions need a timestamp of when they were applied.
 * We store that as a suffix in the condition string or via the conditionTimestamps
 * map on the character. Since the Character type doesn't currently have
 * conditionTimestamps, we use a lighter approach: parse the CURRENT total
 * game minutes from a snapshot stored when the condition was added.
 *
 * Simpler runtime approach used here: if a condition carries an explicit
 * duration AND the elapsed game time since the condition was first seen
 * in the list exceeds that duration, it's expired.
 *
 * Because we don't have per-condition timestamps yet, we do the next best
 * thing: expose the parser so callers can evaluate conditions manually,
 * and add a separate conditionTimestamps map to Character (see types.ts patch).
 */

const DURATION_PATTERNS: [RegExp, number][] = [
    // (X hour) or (X hours) → convert to minutes
    [/\(\s*(\d+)\s*hours?\s*\)/i, 60],
    // (X min) or (X mins) or (X minute) or (X minutes)
    [/\(\s*(\d+)\s*min(?:ute)?s?\s*\)/i, 1],
];

/**
 * Returns the duration in game-minutes encoded in a condition string,
 * or null if no duration is found.
 */
export const parseConditionDuration = (condition: string): number | null => {
    for (const [pattern, multiplier] of DURATION_PATTERNS) {
        const match = condition.match(pattern);
        if (match) return parseInt(match[1], 10) * multiplier;
    }
    return null;
};

/**
 * Given the full conditions list, a map of { conditionText → gameMinuteApplied },
 * and the current game total minutes, returns the conditions that should be removed
 * because their duration has elapsed.
 */
export const findExpiredConditions = (
    conditions: string[],
    conditionTimestamps: Record<string, number>,
    currentTotalMinutes: number
): string[] => {
    return conditions.filter(condition => {
        const duration = parseConditionDuration(condition);
        if (duration === null) return false;
        const appliedAt = conditionTimestamps[condition];
        if (appliedAt === undefined) return false;
        return (currentTotalMinutes - appliedAt) >= duration;
    });
};

// ---------------------------------------------------------------------------
// Bio modifier decay
// ---------------------------------------------------------------------------

/**
 * BIO MODIFIER DECAY
 *
 * Bio modifiers set by the AI (elevated burn rates during exertion, combat,
 * etc.) never reset on their own. Once set to 1.5×, they stay 1.5× forever.
 *
 * This function applies a passive per-turn decay toward the 1.0 baseline.
 * Modifiers above 1.0 decay downward; modifiers below 1.0 recover upward.
 *
 * Decay is intentionally slow so a sustained condition (e.g. carrying a
 * heavy load all day) keeps the modifier elevated — but a brief sprint
 * won't permanently change Nate's physiology.
 *
 * Rate: 0.05 per turn, floored/ceilinged at 1.0.
 *   From 1.5: returns to 1.0 in ~10 turns (~1-2 game hours of normal play)
 *   From 0.5: returns to 1.0 in ~10 turns
 *
 * Modifiers that are set to exactly 0.0 (e.g. Android: no calories) are
 * NEVER decayed — they represent a permanent physiological fact.
 */
const MODIFIER_DECAY_RATE = 0.05;
const MODIFIER_BASELINE = 1.0;

export interface BioModifiers {
    calories: number;
    hydration: number;
    stamina: number;
    lactation: number;
}

export const decayBioModifiers = (modifiers: BioModifiers): BioModifiers => {
    const decay = (value: number): number => {
        // Never touch permanently disabled modifiers (set to 0 for androids, etc.)
        if (value === 0) return 0;
        if (value > MODIFIER_BASELINE) {
            return Math.max(MODIFIER_BASELINE, value - MODIFIER_DECAY_RATE);
        }
        if (value < MODIFIER_BASELINE) {
            return Math.min(MODIFIER_BASELINE, value + MODIFIER_DECAY_RATE);
        }
        return value; // Already at baseline
    };

    return {
        calories:   decay(modifiers.calories),
        hydration:  decay(modifiers.hydration),
        stamina:    decay(modifiers.stamina),
        lactation:  decay(modifiers.lactation),
    };
};

// ---------------------------------------------------------------------------
// Lore deduplication
// ---------------------------------------------------------------------------

/**
 * LORE KEYWORD DEDUPLICATION
 *
 * Checks if a new lore entry's keyword already exists in the canonical lore
 * store. Returns the matching existing entry if found, null otherwise.
 *
 * The check is case-insensitive and ignores minor punctuation differences.
 */
export const findExistingLore = (
    keyword: string,
    existingLore: LoreItem[]
): LoreItem | null => {
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    const normalizedNew = normalize(keyword);
    return existingLore.find(l => normalize(l.keyword) === normalizedNew) ?? null;
};

// ---------------------------------------------------------------------------
// Memory deduplication
// ---------------------------------------------------------------------------

/**
 * MEMORY SEMANTIC DEDUPLICATION
 *
 * Prevents near-duplicate memory fragments from accumulating. Uses a simple
 * word-overlap heuristic: if a new fact shares more than SIMILARITY_THRESHOLD
 * of its significant words with an existing fragment, it's considered a
 * duplicate or update.
 *
 * "Significant words" excludes common stop words (articles, prepositions, etc.)
 * that would inflate similarity scores.
 *
 * Returns:
 *   { isDuplicate: true, existingIndex }  → new fact superseded by existing
 *   { isUpdate: true, existingIndex }     → new fact is more specific; replace existing
 *   { isDuplicate: false, isUpdate: false } → genuinely new
 */
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
            // If new fact is longer, it's more specific — treat as an update
            const isUpdate = newFact.length > existingMemory[i].fact.length;
            return { isDuplicate: !isUpdate, isUpdate, existingIndex: i };
        }
    }

    return { isDuplicate: false, isUpdate: false, existingIndex: -1 };
};

// ---------------------------------------------------------------------------
// Full response sanitisation (called before writing AI output to state)
// ---------------------------------------------------------------------------

export interface ValidationResult {
    bannedNameViolations: string[];
    sanitisedNarrative: string;
}

/**
 * Top-level validation pass over the AI's narrative output.
 * Returns a sanitised narrative and a list of violations for the debug log.
 * Does NOT modify the response object directly — callers apply the result.
 */
export const validateResponse = (response: ModelResponseSchema): ValidationResult => {
    const { result: sanitisedNarrative, violations: bannedNameViolations } =
        sanitiseBannedNames(response.narrative);

    return { bannedNameViolations, sanitisedNarrative };
};