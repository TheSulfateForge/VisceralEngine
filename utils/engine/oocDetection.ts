// ============================================================================
// OOC_DETECTION.TS — v1.31
//
// Out-of-character input channel.
//
// Until now every player input was a turn: the clock advanced, the world
// ticked, the threat pipeline rolled, and the scene fully re-rendered. That is
// wrong for two very common inputs:
//
//   1. Meta-instruction  — "stop repeating yourself", "dial back the NPCs".
//      In the reviewed save (Codi Whitmore, 2026-08-19) the player typed an OOC
//      complaint ABOUT the repetition directly into the game. It consumed a
//      full turn, advanced the clock five minutes, ran a world tick, and was
//      RAG-indexed as [ooc, repeated, near, verbatim, ...].
//
//   2. World clarification — "my armor keeps me warm". A statement of fact
//      about the fiction that should become canon, not a prose beat.
//
// Both produce a prompt near-identical to the previous turn's, which is the
// dominant driver of near-verbatim self-repetition (see driftDetector.ts).
//
// MARKERS. Three accepted forms, all leading-position only:
//
//   OOC: text        the explicit form
//   // text          the fast form
//   ((text))         the oldest text-RP convention
//
// Leading position only, deliberately. Inline OOC inside an in-character
// action ("I draw my sword ((is he hostile?))") would require splitting one
// input into two channels with two different sets of turn mechanics. The
// ambiguity is not worth it — put the OOC on its own line.
// ============================================================================

/**
 * `OOC:` / `ooc -` / `[OOC]` style prefixes. Allows an optional colon, dash or
 * bracket so the habit forms all land. Requires a word boundary so a character
 * named "Oocar" can't trip it.
 */
const OOC_PREFIX_RE = /^\s*\[?\s*ooc\s*\]?\s*[:\-–—]?\s+/i;

/** Bare `//` comment form. */
const OOC_SLASH_RE = /^\s*\/\/\s*/;

/**
 * Double-paren form. Requires the input to open AND close with the pair so a
 * parenthetical aside mid-sentence isn't swallowed.
 */
const OOC_PARENS_RE = /^\s*\(\((.*)\)\)\s*$/s;

export type OocMarker = 'prefix' | 'slash' | 'parens' | null;

export interface OocParseResult {
    /** True when the input is out-of-character and must not advance the world. */
    isOoc: boolean;
    /** The input with its marker stripped. Equals the input when not OOC. */
    body: string;
    /** Which marker matched, for logging and for round-tripping in the UI. */
    marker: OocMarker;
}

/**
 * Classify a raw player input as in-character or out-of-character.
 *
 * Pure and total: never throws, always returns a usable `body`. An input that
 * is ONLY a marker ("//", "((  ))") is treated as not-OOC, because an empty
 * OOC turn has nothing to answer and the player almost certainly mistyped.
 */
export const parseOocInput = (raw: string | undefined | null): OocParseResult => {
    const text = typeof raw === 'string' ? raw : '';
    if (!text.trim()) return { isOoc: false, body: text, marker: null };

    const parens = text.match(OOC_PARENS_RE);
    if (parens) {
        const body = (parens[1] ?? '').trim();
        return body
            ? { isOoc: true, body, marker: 'parens' }
            : { isOoc: false, body: text, marker: null };
    }

    if (OOC_PREFIX_RE.test(text)) {
        const body = text.replace(OOC_PREFIX_RE, '').trim();
        return body
            ? { isOoc: true, body, marker: 'prefix' }
            : { isOoc: false, body: text, marker: null };
    }

    if (OOC_SLASH_RE.test(text)) {
        const body = text.replace(OOC_SLASH_RE, '').trim();
        return body
            ? { isOoc: true, body, marker: 'slash' }
            : { isOoc: false, body: text, marker: null };
    }

    return { isOoc: false, body: text, marker: null };
};

/** Re-attach a marker for display, so the transcript shows what the player typed. */
export const formatOocForDisplay = (body: string): string => `OOC: ${body}`;

/**
 * True when a message is part of the FICTION rather than the OOC side-channel.
 *
 * Every consumer that means "the last thing that happened in the story" must
 * filter on this. An OOC exchange is not narrative, and letting one leak into
 * these paths causes concrete bugs: the situation recap would anchor on an
 * engine answer, the repetition detector would compare prose against a
 * meta-reply, the softening-tell baseline would be skewed by a two-sentence
 * message, and the summarizer would write meta-chatter into campaign history.
 */
export const isNarrativeMessage = (m: { ooc?: boolean }): boolean => m.ooc !== true;
