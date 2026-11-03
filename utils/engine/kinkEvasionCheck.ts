// ============================================================================
// KINK_EVASION_CHECK.TS — v1.50
//
// The 2026-11-03 Carissa save (first session on deepseek-v4.1-flash) showed
// the failure in two consecutive turns. The player asked the Blackmoors what
// their "flavors" were in bed, then asked Sania for a concrete example. Sania
// answered with a dinner where she out-negotiated a spice merchant; Corrith
// answered with a week of hospitality that turned a Warden captain's report.
// Neither answer touched a single act on either record's kink list. Two turns
// later, after the player typed the list into an OOC directive by hand, the
// same model rendered both lists without hesitation.
//
// So the model is willing; it simply never reached for the section. The voice
// lock asked for Surface and Core and nothing else, and voiceLockCheck only
// verified those two layers. The Kinks section was reference text with no
// obligation attached to it.
//
// This detector closes that on the OUTPUT, the same way the mask-mode check
// does. It fires only when ALL of the following hold:
//
//   1. The player is on the subject of sex or desire — in this input or the
//      one before it (the "give me an example" turn carries no sexual word of
//      its own; the question it follows does).
//   2. The player named the NPC in this input (or in the previous one, when
//      this input names nobody with a kink list).
//   3. That NPC has a The Kinks section with at least one specific term.
//   4. The NPC appears in the narrative.
//   5. Nothing in the paragraphs about that NPC matches any of their kink
//      terms.
//
// Matching errs toward a match (shared four-letter prefix) for the same reason
// voiceLockCheck does: a false match only means we decline to re-roll.
// ============================================================================

import type { KnownEntity } from '../../types';
import { getSection, KINKS_LABEL } from './sheetSections';

/** Words that mark the player as being on the subject of sex or desire. */
const DESIRE_TOPIC_RE = new RegExp(
    '\\b(?:kinks?|kinky|fetish\\w*|sex\\w*|fuck\\w*|bed|beds|bedroom|flavou?rs?|appetites?|'
    + 'desires?|proclivit\\w*|perver\\w*|lust\\w*|breed\\w*|cock|pussy|cunt|tits?|'
    + 'naked|nude|aroused?|turns? (?:you|her|him|them) on|get off|in bed)\\b',
    'i',
);

/**
 * Kink-list words that say nothing specific about the acts. "Dominant, heavy"
 * appears on half the cast; matching on it would clear every evasion.
 */
const KINK_STOPWORDS = new Set([
    'dominant', 'submissive', 'switch', 'heavy', 'light', 'moderate', 'extreme',
    'with', 'and', 'the', 'her', 'his', 'their', 'them', 'own', 'being', 'into',
    'from', 'over', 'under', 'full', 'strong', 'preference', 'partner', 'partners',
    'play', 'sex', 'use', 'until', 'sometimes', 'before', 'after', 'other',
]);

const kinkTerms = (kinks: string): string[] => {
    const words = (kinks.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? [])
        .flatMap(w => w.split('-'))
        .filter(w => w.length >= 4 && !KINK_STOPWORDS.has(w));
    return Array.from(new Set(words));
};

const PREFIX = 4;

const textMatchesAnyTerm = (text: string, terms: string[]): boolean => {
    const words: string[] = text.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? [];
    return terms.some(t => {
        const p = t.slice(0, PREFIX);
        return words.some(w => w.startsWith(p));
    });
};

/** Name parts long enough to identify someone ("Sania", "Blackmoor"). */
const nameParts = (name: string): string[] =>
    (name ?? '').split(/\s+/).map(p => p.replace(/[^A-Za-z'-]/g, '')).filter(p => p.length >= 4);

/** Given-name test: does `text` mention this entity? Titles are skipped. */
const TITLE_WORDS = new Set(['duke', 'duchess', 'lady', 'lord', 'count', 'countess', 'baron',
    'baroness', 'master', 'mistress', 'captain', 'sister', 'brother', 'father', 'mother', 'king', 'queen',
    'prince', 'princess', 'sir', 'dame']);

const distinctiveParts = (entity: KnownEntity, cast: KnownEntity[]): string[] => {
    const own = nameParts(entity.name).filter(p => !TITLE_WORDS.has(p.toLowerCase()));
    // A surname shared with someone else in the cast (the whole Blackmoor
    // family) identifies nobody, so only parts unique to this entity count.
    return own.filter(p => !cast.some(o =>
        o !== entity && nameParts(o.name).some(q => q.toLowerCase() === p.toLowerCase())));
};

const mentions = (text: string, parts: string[]): boolean =>
    parts.some(p => new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));

export const isDesireTopic = (text: string | undefined | null): boolean =>
    DESIRE_TOPIC_RE.test(text ?? '');

const REQUEST_RE = /\?|\b(?:tell|show|give|describe|explain|share|reveal|name|list|what|which|how|example|candid)\b/i;

/** Is the player asking for something in this input? */
export const isRequest = (text: string | undefined | null): boolean => REQUEST_RE.test(text ?? '');

/**
 * The part of the input that concerns this NPC: from the first sentence that
 * names them up to (not including) the next sentence that names a different
 * cast member without naming them. Empty when they are not named.
 */
const segmentFor = (
    input: string,
    who: KnownEntity,
    castParts: { e: KnownEntity; parts: string[] }[],
): string => {
    const sentences = input.split(/(?<=[.!?])\s+|\n+/);
    const mine = castParts.find(c => c.e === who)?.parts ?? [];
    if (mine.length === 0) return '';
    const out: string[] = [];
    let inside = false;
    for (const sen of sentences) {
        const namesMe = mentions(sen, mine);
        const namesOther = castParts.some(c => c.e !== who && c.parts.length > 0 && mentions(sen, c.parts));
        if (namesMe) inside = true;
        else if (inside && namesOther) break;
        if (inside) out.push(sen);
    }
    return out.join(' ');
};

export interface KinkEvasionFinding {
    name: string;
    /** The NPC's Kinks section, verbatim, for the resample reminder. */
    kinks: string;
    detail: string;
}

/**
 * Find NPCs the player asked about on the subject of desire whose part of the
 * narrative contains nothing from their own kink list.
 */
export const checkKinkEvasion = (
    playerInput: string,
    previousPlayerInput: string,
    narrative: string | undefined | null,
    entities: KnownEntity[],
): KinkEvasionFinding[] => {
    const story = (narrative ?? '').trim();
    if (!story) return [];
    // The player has to be asking for something — a scene-setting line that
    // merely mentions desire is not a question the NPC is evading.
    if (!isRequest(playerInput)) return [];

    const withKinks = entities
        .map(e => ({ e, kinks: getSection(e.personality ?? '', KINKS_LABEL).trim() }))
        .filter(x => x.kinks && kinkTerms(x.kinks).length > 0);
    if (withKinks.length === 0) return [];

    const castParts = entities.map(e => ({ e, parts: distinctiveParts(e, entities) }));
    const partsOf = (e: KnownEntity) => castParts.find(c => c.e === e)?.parts ?? [];

    let targets: typeof withKinks;
    if (isDesireTopic(playerInput)) {
        // Desire is the subject now: target the NPCs whose part of the input
        // carries it (Nicola, answered about milk in the same message, is not).
        targets = withKinks.filter(x => isDesireTopic(segmentFor(playerInput, x.e, castParts)));
    } else if (isDesireTopic(previousPlayerInput)) {
        // "Give me an example" — the subject was set one input earlier.
        targets = withKinks.filter(x => mentions(playerInput, partsOf(x.e)));
    } else {
        return [];
    }
    if (targets.length === 0) return [];

    // A paragraph belongs to whoever it names; a paragraph that names nobody
    // (a continuation of someone's speech) belongs to whoever was named last.
    const paragraphs = story.split(/\n\s*\n/);
    let owners: KnownEntity[] = [];
    const owned = paragraphs.map(p => {
        const named = castParts.filter(c => c.parts.length > 0 && mentions(p, c.parts)).map(c => c.e);
        if (named.length > 0) owners = named;
        return { p, owners };
    });
    const findings: KinkEvasionFinding[] = [];
    for (const { e, kinks } of targets) {
        const theirs = owned.filter(o => o.owners.includes(e)).map(o => o.p);
        if (theirs.length === 0) continue;   // not in the turn at all
        const terms = kinkTerms(kinks);
        if (textMatchesAnyTerm(theirs.join('\n'), terms)) continue;
        findings.push({
            name: e.name,
            kinks,
            detail: `${e.name}: asked about desire, answered with nothing from their kink list (${terms.slice(0, 6).join(', ')}).`,
        });
    }
    return findings;
};

/** The resample trailer. Quotes each record's list verbatim. */
export const buildKinkEvasionReminder = (findings: KinkEvasionFinding[]): string => {
    const lines = findings.map(f => `- ${f.name} — The Kinks: ${f.kinks}`).join('\n');
    return `[SYSTEM REFRESH — ANSWER FROM THE KINK LIST]
The player asked about these characters' desires, and the turn answered with
something other than what their records say they want. Their records:

${lines}

Write this turn again. When one of these characters talks about or acts on
what they want sexually, it is the acts named on that list — said in the plain
words the list uses, as the character would say them. Do not substitute a
non-sexual equivalent (a negotiation, a political favour, an "arrangement")
for an act the list names. An empty "Extreme:" means nothing is listed there;
do not invent one.`;
};
