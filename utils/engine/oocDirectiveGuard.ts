// ============================================================================
// OOC_DIRECTIVE_GUARD.TS — v1.50
//
// 2026-11-03 Carissa save, turn 27. The player typed:
//
//     [OOC: These are not an accurate representation of Sania's Kinks]
//
// meaning: what Sania just SAID is not her kink list. The OOC channel attaches
// the NPC's record immediately before the player's line, so "these" bound to
// the record, and the channel persisted the opposite rule as a standing,
// every-turn directive:
//
//     "Do not treat Sania Blackmoor's recorded kink list as accurate or canon;
//      never quote it or use it to determine her desires."
//
// An authored record is the source of truth. A directive may only override it
// when the player explicitly says to change, replace or drop the record. Every
// other complaint about a record is a complaint that the narration did not
// match it, and the directive that complaint implies is "follow the record".
// ============================================================================

/** The directive tells the narrator to stop trusting / using a record. */
const DISMISSES_RECORD_RE = new RegExp(
    [
        // "do not treat X's recorded kink list as accurate / canon"
        String.raw`\b(?:do\s+not|don't|never|stop)\s+(?:treat|treating|consider|considering|regard|regarding)\b[^.]{0,120}\b(?:record|recorded|sheet|list|kinks?|profile|entry)\b[^.]{0,60}\b(?:accurate|canon|canonical|authoritative|true|correct|reliable)\b`,
        // "ignore / disregard her kink list"
        String.raw`\b(?:ignore|disregard|discard|set\s+aside|stop\s+using|do\s+not\s+use|don't\s+use|never\s+use)\b[^.]{0,80}\b(?:record|recorded|sheet|kink\s+list|kinks|profile|entry)\b`,
        // "the record is not accurate / inaccurate"
        String.raw`\b(?:record|recorded|sheet|kink\s+list|profile)\b[^.]{0,60}\b(?:is\s+not|isn't|are\s+not|aren't)\s+(?:accurate|canon|correct)\b`,
        String.raw`\b(?:record|recorded|sheet|kink\s+list|profile)\b[^.]{0,60}\binaccurate\b`,
    ].join('|'),
    'i',
);

/** The player explicitly asked for the record itself to be changed or dropped. */
const PLAYER_CHANGES_RECORD_RE = new RegExp(
    [
        String.raw`\b(?:ignore|disregard|discard|remove|delete|drop|replace|rewrite|change|update|edit|overwrite|forget|stop\s+using|don't\s+use|do\s+not\s+use)\b[^.\n]{0,80}\b(?:record|sheet|kink\s*list|kinks|profile|entry|seed)\b`,
        String.raw`\b(?:record|sheet|kink\s*list|kinks|profile|entry|seed)\b[^.\n]{0,60}\b(?:is|are)\s+(?:wrong|outdated|out\s+of\s+date|old|replaced|incorrect)\b`,
        String.raw`\buse\s+this\s+(?:instead|for)\b`,
    ].join('|'),
    'i',
);

export const RECORD_IS_AUTHORITATIVE_DIRECTIVE =
    'Characters\' written records are authoritative. When the player flags narration as not matching a '
    + 'character\'s record, the narration was wrong, not the record: render that character\'s wants, '
    + 'kinks and behaviour from their record, in the record\'s own terms.';

export interface DirectiveGuardResult {
    /** The directive to persist (possibly rewritten), or undefined. */
    directive: string | undefined;
    /** Set when the model's directive was replaced. */
    blocked: string | null;
}

/**
 * Stop a directive from overriding an authored record unless the player
 * explicitly asked for exactly that.
 */
export const guardRecordDismissal = (
    directive: string | undefined | null,
    playerBody: string,
): DirectiveGuardResult => {
    const d = (directive ?? '').trim();
    if (!d) return { directive: undefined, blocked: null };
    if (!DISMISSES_RECORD_RE.test(d)) return { directive: d, blocked: null };
    if (PLAYER_CHANGES_RECORD_RE.test(playerBody ?? '')) return { directive: d, blocked: null };
    return { directive: RECORD_IS_AUTHORITATIVE_DIRECTIVE, blocked: d };
};
