// ============================================================================
// PLAYER_FRAMING.TS — v1.29
//
// The engine had no representation of the player pushing back.
//
// In the reviewed save (Ryan Bloodfeather, T16) the player twice corrected an
// NPC who had inflated an offhand remark about courier working conditions into
// a plot to restructure the city — "you've gotten about three steps ahead of
// me", then "Princess, you're doing it again." Neither correction reached
// state. That NPC's ledger after sixteen turns read, in full:
//
//     ["Initiated a private conversation with the PC."]
//
// So every turn re-derived the same stance from the same inputs and landed in
// the same place, and the player's pushback was answered with escalation.
//
// This module turns three things the player does into signals the engine can
// act on:
//   1. CORRECTION   — "that's not what I said", "you're reading too much in"
//   2. RECIPROCATION — the player returning or inviting physical contact
//   3. DEFLECTION   — the player declining or stepping away from a push
//
// All three are deliberately conservative. A false positive on correction
// suppresses one NPC reading; a false positive on reciprocation would license
// escalation the player did not ask for, so that one is the strictest of the
// three and requires the player to be the actor.
// ============================================================================

/** Player is telling the NPC their reading of him is wrong or overblown. */
const CORRECTION_PATTERNS: RegExp[] = [
    /\b(?:that'?s|that is)\s+not\s+what\s+I\s+(?:said|meant|asked)\b/i,
    /\bI\s+(?:never|didn'?t|did\s+not)\s+(?:say|said|mean|claim|suggest|imply)\b/i,
    /\byou'?re\s+(?:doing\s+it\s+again|reading\s+(?:too\s+much|into)|putting\s+words)\b/i,
    /\byou'?ve\s+(?:gotten|got|gone|jumped)\s+(?:\w+\s+){0,3}ahead\s+of\s+me\b/i,
    /\b(?:three|two|several|a\s+few)\s+steps?\s+ahead\s+of\s+me\b/i,
    /\bI\s+said\s+(?:if|maybe|perhaps)\b/i,
    /\bI'?m\s+not\s+(?:a|an|planning|trying|looking)\b.{0,60}\b(?:revolutionar|agitator|threat|hero|chosen|savior|saviour|conspirac|plotting|rebel)\w*/i,
    /\b(?:don'?t|do\s+not)\s+(?:read|make)\s+(?:too\s+much|more)\s+(?:in)?to\s+it\b/i,
    /\bit'?s\s+not\s+that\s+(?:deep|serious|complicated|grand)\b/i,
    /\bI\s+(?:just|merely|only)\s+(?:said|meant|noticed|observed)\b/i,
    /\bno\s+(?:grand|greater|deeper|hidden)\s+(?:plan|meaning|design|scheme)\b/i,
    /\byou'?re\s+(?:over)?think(?:ing)?\s+(?:this|it)\b/i,
    /\bslow\s+down,?\s+(?:princess|my\s+lord|my\s+lady|friend)?\b/i,
];

/**
 * Player is returning or inviting physical contact. Deliberately requires the
 * PLAYER to be the actor — "she takes my hand" is not reciprocation, and
 * treating it as such is exactly the failure this gate exists to prevent.
 */
const RECIPROCATION_PATTERNS: RegExp[] = [
    /\bI\s+(?:take|hold|grasp|clasp|squeeze|catch)\s+(?:her|his|their)\s+(?:hand|arm|wrist|fingers|waist|hip)\b/i,
    /\bI\s+(?:lean|move|shift|slide|step)\s+(?:in|closer|toward|towards|nearer)\b/i,
    /\bI\s+(?:kiss|embrace|hug|hold|pull)\s+(?:her|him|them)\b/i,
    /\bI\s+(?:place|rest|put|lay)\s+my\s+(?:hand|arm|palm|fingers)\s+(?:on|against|over|around)\b/i,
    /\bI\s+(?:let|allow)\s+(?:her|him|them)\b.{0,40}\b(?:closer|touch|contact|stay)\b/i,
    /\bI\s+(?:don'?t|do\s+not)\s+(?:pull|move|draw)\s+(?:away|back)\b/i,
    /\bI\s+return\s+(?:the|her|his|their)\s+(?:touch|kiss|embrace|gesture)\b/i,
];

/** Player is stepping back from a push — social, romantic, or physical. */
const DEFLECTION_PATTERNS: RegExp[] = [
    /\bI\s+(?:pull|draw|move|lean|step|shift)\s+(?:away|back|aside)\b/i,
    /\bI\s+(?:withdraw|disengage|extract)\b/i,
    /\bI\s+(?:change|redirect|steer)\s+the\s+(?:subject|topic|conversation)\b/i,
    /\bI\s+(?:decline|refuse|demur|beg\s+off)\b/i,
    /\b(?:not|no)\s+(?:interested|thank\s+you|right\s+now|tonight)\b/i,
    /\bI\s+(?:let|allow)\s+(?:the|that)\s+(?:comment|remark|moment)\s+(?:pass|go|drop)\b/i,
    /\bI\s+(?:create|put|keep)\s+(?:some\s+)?(?:distance|space)\b/i,
];

const anyMatch = (text: string, patterns: RegExp[]): string[] => {
    if (!text) return [];
    const hits: string[] = [];
    for (const re of patterns) {
        const m = text.match(re);
        if (m) hits.push(m[0].trim());
    }
    return hits;
};

export interface PlayerFramingSignals {
    /** The player explicitly rejected an NPC's reading of them this turn. */
    corrected: boolean;
    correctionMarkers: string[];
    /** The player returned or invited physical contact this turn. */
    reciprocated: boolean;
    reciprocationMarkers: string[];
    /** The player stepped back from a push this turn. */
    deflected: boolean;
    deflectionMarkers: string[];
}

export const detectPlayerFraming = (playerInput: string | undefined | null): PlayerFramingSignals => {
    const text = typeof playerInput === 'string' ? playerInput : '';
    const correctionMarkers = anyMatch(text, CORRECTION_PATTERNS);
    const reciprocationMarkers = anyMatch(text, RECIPROCATION_PATTERNS);
    const deflectionMarkers = anyMatch(text, DEFLECTION_PATTERNS);
    return {
        corrected: correctionMarkers.length > 0,
        correctionMarkers,
        reciprocated: reciprocationMarkers.length > 0,
        reciprocationMarkers,
        deflected: deflectionMarkers.length > 0,
        deflectionMarkers,
    };
};

// ---------------------------------------------------------------------------
// v1.29: proper-noun-safe mature-content detection
// ---------------------------------------------------------------------------
// The old test was:
//
//     /\b(blood|bleed|wound|gore|kill|stab|...)\w*/i
//
// The trailing \w* means `blood` matches "Bloodfeather" — the reviewed save's
// player character. All sixteen model turns addressed him as "Master
// Bloodfeather", so `matureContextActive` was true on every turn of a calm
// park conversation at tension 10, which left the anti-softening resampler
// permanently armed. The same trap catches Bloodworth, Killian, Severin,
// Gutmann, Cocker, Woundwort and any number of ordinary fantasy surnames.
//
// Two changes: names present in the scene are removed before testing, and the
// stems only accept real inflectional suffixes rather than arbitrary word
// continuations.

const MATURE_STEMS = [
    'blood', 'bleed', 'bled', 'wound', 'gore', 'kill', 'stab', 'slash',
    'sever', 'gut', 'disembowel', 'torture', 'rape', 'sex', 'fuck', 'cock',
    'cunt', 'breast', 'nipple', 'thrust', 'cum', 'orgasm', 'naked', 'nude',
    'arousal', 'aroused', 'arouse',
];

/** Only genuine inflections — not "…feather", "…worth", "…ian". */
const MATURE_CONTENT_RE = new RegExp(
    `\\b(?:${MATURE_STEMS.join('|')})(?:s|es|ed|ing|y|ies)?\\b`,
    'i',
);

/**
 * True when the text contains mature content once names in play are excluded.
 * `names` should include the PC and any entity names that could appear.
 */
export const containsMatureContent = (
    text: string | undefined | null,
    names: string[] = [],
): boolean => {
    if (!text) return false;
    let scrubbed = text;
    for (const name of names) {
        if (!name) continue;
        // Strip the whole name and each of its significant parts.
        const parts = [name, ...name.split(/\s+/)].filter(p => p.length >= 3);
        for (const part of parts) {
            scrubbed = scrubbed.replace(
                new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
                ' ',
            );
        }
    }
    return MATURE_CONTENT_RE.test(scrubbed);
};

// ---------------------------------------------------------------------------
// v1.29: physical-escalation ladder
// ---------------------------------------------------------------------------
// NPC-initiated physical contact in the reviewed save advanced monotonically
// and never receded, across sixteen turns, from a NEUTRAL relationship, with
// no reciprocation from the player at any point:
//
//   hand hovering -> resting on his forearm -> leaning close -> knee brushing
//   -> knee pressing firm + sleeve at "light, persistent friction"
//
// The ladder lets the engine tell the model where the scene currently is and
// forbid advancing another rung unless the player moved first.

export const PHYSICAL_CONTACT_LADDER = [
    'none',
    'proximity',   // closing distance, leaning in, shared space
    'incidental',  // brushing, a hand on a forearm, a knee touching
    'sustained',   // deliberate held contact, an arm around, pressing close
    'intimate',    // kissing and beyond
] as const;

export type PhysicalContactLevel = typeof PHYSICAL_CONTACT_LADDER[number];

const LEVEL_PATTERNS: [PhysicalContactLevel, RegExp][] = [
    ['intimate', /\b(kiss(?:es|ed|ing)?|mouth\s+(?:on|against)|straddl\w*|undress\w*|bare\s+skin|naked)\b/i],
    ['sustained', /\b(press(?:es|ed|ing)?\s+(?:firm|close|against)|arm\s+around|pull(?:s|ed|ing)?\s+(?:her|him|them)\s+(?:close|against)|holds?\s+(?:her|his|their)\s+hand|fingers?\s+(?:lace|intertwin)\w*|settles?\s+against)\b/i],
    // Note the bare "(on|against) your <body part>" clause: the reviewed save's
    // first contact beat was "she rests it lightly on your forearm" — pronoun,
    // not "her hand" — which a possessive-anchored pattern misses entirely.
    ['incidental', /\b(brush(?:es|ed|ing)?\s+(?:against|the)|rests?\s+(?:her|his|their)\s+hand|(?:on|against)\s+(?:your|his|her|their)\s+(?:forearm|arm|shoulder|knee|thigh|wrist|hand|back)|knee\s+(?:brush|touch|against)\w*|friction)\b/i],
    ['proximity', /\b(lean(?:s|ed|ing)?\s+(?:in|closer|forward)|closes?\s+the\s+distance|drift(?:s|ed|ing)?\s+across\s+the\s+(?:narrow\s+)?gap|scent\s+of\s+(?:her|his|their)\s+skin|shifts?\s+closer|reach(?:es|ed|ing)?\s+out|hand\s+hover\w*)\b/i],
];

/** Highest rung of physical contact present in a narrative passage. */
export const physicalContactLevel = (narrative: string | undefined | null): PhysicalContactLevel => {
    if (!narrative) return 'none';
    for (const [level, re] of LEVEL_PATTERNS) {
        if (re.test(narrative)) return level;
    }
    return 'none';
};

export const levelIndex = (level: PhysicalContactLevel): number =>
    PHYSICAL_CONTACT_LADDER.indexOf(level);
