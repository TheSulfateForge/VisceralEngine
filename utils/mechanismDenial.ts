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
 * Scans player input text for mechanism denial patterns.
 * Returns an array of keyword arrays representing denied concepts.
 * Each inner array is a set of significant words from the denied phrase.
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
                    denied.push(deniedWords);
                }
            }
        }
    }

    return denied;
};
