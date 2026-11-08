// ============================================================================
// v1.53: SINGLE-QUOTED DIALOGUE → DOUBLE QUOTES
//
// The 2026-11-08 Westcross save (deepseek-v4.1-flash) wrote every line of
// dialogue in single quotes ('Duke Westcross. You actually came.'). Everything
// in the engine that separates speech from narration keys on double quotes:
//   • the v1.51 speech time floor counted 0 spoken words on all 16 turns, so
//     the clock moved +1m a turn through a whole garden party;
//   • the narrator-POV check counted "I" inside NPC speech as first-person
//     narration and let third-person turns through;
//   • activity detection, the voice lock and the echo guard's player-text
//     exclusion all read quoted spans.
// Rewriting the model's single-quoted dialogue to double quotes, once, at the
// point the reply is parsed, fixes all of them and the display.
//
// Conservative: only runs when the narrative has NO double-quoted dialogue and
// at least two single-quoted spans. Apostrophes inside words (don't, Westcross's)
// are kept — a quote only opens after a space/bracket/dash or line start and
// only closes before a space, punctuation or line end.
// ============================================================================

const SPAN_RE = /(^|[\s(\[—–-])['‘]((?:[^'’\n]|['’](?=[A-Za-z]))+?)['’](?=[\s.,;:!?—–)\]-]|$)/gm;

/** Count single-quoted dialogue spans (exported for tests and logging). */
export const countSingleQuotedSpans = (text: string): number => {
    SPAN_RE.lastIndex = 0;
    return (text.match(SPAN_RE) ?? []).length;
};

export const MIN_SPANS_TO_NORMALISE = 2;

export const normaliseSingleQuotedDialogue = (text: string): string => {
    if (!text || /["“”]/.test(text)) return text;
    if (countSingleQuotedSpans(text) < MIN_SPANS_TO_NORMALISE) return text;
    SPAN_RE.lastIndex = 0;
    return text.replace(SPAN_RE, (_m, lead: string, body: string) => `${lead}"${body}"`);
};
