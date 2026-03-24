// ============================================================================
// MECHANISM_DENIAL.TS — v1.12 FIX UI-1
// Detects player rejection of AI fabrications in their input text.
// When a player writes things like "there is no X" or "cancel the Y",
// the denied concept's significant words are extracted and added to
// bannedMechanisms so the engine blocks the AI from re-using them.
// ============================================================================

import { significantWords } from './contentValidation';

/** Regex patterns that detect when a player is denying/rejecting a mechanism. */
const MECHANISM_DENIAL_PATTERNS: RegExp[] = [
    /(?:there(?:'s| is) no|no such thing as|doesn'?t exist|isn'?t real|i don'?t have|never had|cancel|remove|delete)\s+(?:the\s+)?(?:my\s+)?(.+?)(?:\.|$)/gi,
    /(?:such a thing|no such thing|that)\s+(?:does\s+not|doesn'?t)\s+exist/gi,
];

/** Quick-check regex — avoids running the full patterns on every message. */
const DENIAL_QUICK_CHECK = /cancel|remove|delete|no such|doesn'?t exist|isn'?t real|never had|there(?:'s| is) no/i;

/**
 * v1.20: Words that indicate the player is venting frustration at the engine,
 * not denying a specific in-world mechanism. If any appear in the captured
 * phrase, the match is rejected as a false positive.
 */
const FRUSTRATION_INDICATORS = new Set([
    'fuck', 'shit', 'damn', 'stop', 'constantly', 'always', 'never',
    'violating', 'rules', 'broken', 'forcing', 'arbitrarily', 'unfair',
    'cheating', 'bullshit', 'stupid', 'annoying', 'ridiculous',
    'origin', 'gate', 'pipeline', 'engine', 'system', 'threat', 'eta',
    'block', 'blocked', 'denied', 'cooldown', 'suppressed'
]);

/**
 * v1.20: Minimum ratio of "narrative words" (words not in FRUSTRATION_INDICATORS)
 * to total words. If the captured phrase is mostly meta-game/frustration language,
 * it's not a valid mechanism denial.
 */
const MIN_NARRATIVE_WORD_RATIO = 0.6;

/**
 * Scans player input text for mechanism denial patterns.
 * Returns an array of keyword arrays representing denied concepts.
 * Each inner array is a set of significant words from the denied phrase.
 *
 * v1.20: Added frustration-language filter to prevent raw player complaints
 * from polluting the banned mechanisms list.
 *
 * @param text - The player's raw input text
 * @returns Array of denied keyword sets (may be empty)
 */
export const extractDeniedMechanisms = (text: string): string[][] => {
    const denied: string[][] = [];

    // Quick bail — only scan if text contains denial-adjacent words
    if (!DENIAL_QUICK_CHECK.test(text)) {
        return denied;
    }

    for (const pattern of MECHANISM_DENIAL_PATTERNS) {
        // Reset lastIndex for global regex
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text)) !== null) {
            if (match[1]) {
                const deniedWords = [...significantWords(match[1])];
                if (deniedWords.length >= 2) {
                    // v1.20: Reject if the captured phrase is mostly frustration/meta language
                    const narrativeWords = deniedWords.filter(w => !FRUSTRATION_INDICATORS.has(w));
                    const ratio = narrativeWords.length / deniedWords.length;
                    if (ratio < MIN_NARRATIVE_WORD_RATIO) {
                        continue; // Skip — this is player venting, not mechanism denial
                    }
                    denied.push(deniedWords);
                }
            }
        }
    }

    return denied;
};
