// ============================================================================
// utils/engine/narrationPov.ts — v1.48: whose "I" is it?
// ============================================================================
//
// The 2026-10-31 Nissa save. Turns 2-4 were narrated in the third person.
// The player writes in the first person as Nissa, and on turn 12 the model
// mirrored that — "I didn't bother pulling my hands back" — with I = Nissa.
// From turn 14 to the end, every turn was first person as IVO: "I watched the
// furred girl", "my ten inches", with Nissa reduced to "she". 26 consecutive
// turns narrated from inside the NPC's head.
//
// Nothing in the engine said who the narrator is. No prompt line, no check.
// The model mirrored the player's "I" and then, once the NPC was doing most of
// the acting, the "I" slid onto the NPC.
//
// Now: the perspective is a setting (default: match how the player writes),
// stated at the tail every turn, and checked on the output. A turn that is
// narrated from an NPC's head is resampled once.
// ============================================================================

import type { Character } from '../../types';

export type NarrationPerson = 'first' | 'second' | 'third';
export type NarrationSetting = 'match' | NarrationPerson;

// v1.52: capitalised forms count. "My voice is deep soft and even" opens a
// sentence, and the old lower-case-only pattern scored it zero.
const FIRST_PERSON_RE = /\b(?:I|[Mm]e|[Mm]y|[Mm]ine|[Mm]yself)\b/g;

/**
 * Narration with dialogue removed. Dialogue in this engine's output comes in
 * both double quotes and single quotes ('You're the prettiest...'), so single
 * quotes count as dialogue when they open after whitespace/start and close
 * before whitespace/punctuation — which leaves contractions (didn't) alone.
 */
export const stripDialogue = (text: string): string =>
    (text ?? '')
        .replace(/["“][^"”]*["”]/g, ' ')
        .replace(/(^|[\s(—-])'[^\n]*?'(?=[\s,.!?;:—)\-]|$)/g, '$1 ');

const count = (re: RegExp, s: string) => (s.match(re) ?? []).length;

/**
 * 'match' → the person the player writes in. First person if the player says
 * "I"; third if they write about their character by name or pronoun; third
 * otherwise (the engine's own opening default).
 */
export const resolveNarrationPerson = (
    setting: NarrationSetting | undefined,
    recentPlayerInputs: string[],
    pcName: string,
): NarrationPerson => {
    if (setting === 'first' || setting === 'second' || setting === 'third') return setting;
    const text = stripDialogue(recentPlayerInputs.join('\n').replace(/\[[^\]]*\]/g, ' '));
    const first = count(FIRST_PERSON_RE, text);
    const firstName = pcName.trim().split(/\s+/)[0] ?? '';
    const byName = firstName.length > 2 ? count(new RegExp(`\\b${firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), text) : 0;
    // v1.52: one "I/my" outside dialogue is enough when the player never
    // names their own character. The 2026-11-07 Westcross openings were mostly
    // quoted speech ("My voice is deep soft and even" + a quote) — one "my",
    // no name — and resolved to third person for five turns before flipping.
    if (first >= 1 && byName === 0) return 'first';
    if (first >= 2 && first >= byName) return 'first';
    if (byName >= 2) return 'third';
    return 'third';
};

const pcPronouns = (gender: string | undefined): RegExp | null => {
    const g = (gender ?? '').toLowerCase();
    if (/\b(?:female|woman|girl|f)\b/.test(g)) return /\b(?:she|her|hers|herself)\b/gi;
    if (/\b(?:male|man|boy|m)\b/.test(g)) return /\b(?:he|him|his|himself)\b/gi;
    return null;
};

export const buildNarrationPovBlock = (
    person: NarrationPerson,
    pcName: string,
    otherNames: string[],
): string => {
    const others = otherNames.length ? otherNames.slice(0, 6).join(', ') : 'every other character';
    const body =
        person === 'first'
            ? `First person, as ${pcName}. In narration, "I", "me" and "my" ALWAYS mean ${pcName} — never anyone else, not for a single sentence. ${others}: always "he", "she", "they" or their name. Never narrate from inside another character's head; their thoughts and wants show only through what ${pcName} can see, hear, smell and feel.`
            : person === 'second'
                ? `Second person: ${pcName} is "you". Narration never uses "I", "me" or "my" outside dialogue — no character, ${pcName} included, narrates. Other characters' thoughts show only through what "you" can perceive.`
                : `Third person, close on ${pcName}. Narration never uses "I", "me" or "my" outside dialogue — no character narrates. Other characters' thoughts show only through what ${pcName} can perceive.`;
    return `[NARRATION PERSPECTIVE — fixed for this game]\n${body}`;
};

export interface PovDrift {
    drifted: boolean;
    reason: string;
}

/**
 * Did this narrative leave the required perspective?
 *
 * second/third: five or more first-person pronouns outside dialogue means a
 * character has started narrating.
 *
 * first: "I" must be the PC. Two independent signals that it is not:
 *   - the narration refers to the PC in the third person — by name, or (when
 *     no other in-scene character is named anywhere in the narration, so the
 *     PC is the only candidate) by the PC's pronoun six or more times;
 *   - "my" + genitals the PC's sheet does not give them.
 * Measured on the Nissa save: every Ivo-POV turn (14-103) trips the first
 * signal with 12-34 she/her and zero names; the genuine Nissa-POV turn 12
 * has none.
 */
export const detectPovDrift = (
    narrative: string,
    person: NarrationPerson,
    pc: Pick<Character, 'name' | 'gender'> & { hasPenis?: boolean; hasVagina?: boolean },
    inSceneNames: string[],
): PovDrift => {
    const n = stripDialogue(narrative);
    const fp = count(FIRST_PERSON_RE, n);
    if (person !== 'first') {
        return fp >= 5
            ? { drifted: true, reason: `${fp} first-person pronouns outside dialogue in ${person}-person narration` }
            : { drifted: false, reason: '' };
    }
    if (fp < 5) return { drifted: false, reason: '' };

    const firstName = pc.name.trim().split(/\s+/)[0] ?? '';
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (firstName.length > 2 && new RegExp(`\\b${esc(firstName)}\\b`).test(n)) {
        return { drifted: true, reason: `first-person narration refers to ${pc.name} by name — "I" is someone else` };
    }
    if (pc.hasPenis === false && /\bmy\s+(?:cock|penis|dick|shaft|balls|erection)\b/i.test(n)) {
        return { drifted: true, reason: `"I" has a penis; ${pc.name} does not` };
    }
    if (pc.hasVagina === false && /\bmy\s+(?:cunt|pussy|vagina|clit|labia)\b/i.test(n)) {
        return { drifted: true, reason: `"I" has a vagina; ${pc.name} does not` };
    }
    const pron = pcPronouns(pc.gender);
    const othersNamed = inSceneNames.some(name =>
        name.split(/\s+/).filter(p => p.length > 2).some(p => new RegExp(`\\b${esc(p)}\\b`).test(n)));
    if (pron && !othersNamed) {
        const third = count(pron, n);
        if (third >= 6) {
            return { drifted: true, reason: `${third} third-person pronouns for the only candidate (${pc.name}) alongside ${fp} "I/my" — narrated from another character's head` };
        }
    }
    return { drifted: false, reason: '' };
};

export const buildPovResampleReminder = (person: NarrationPerson, pcName: string, reason: string): string =>
    `[SYSTEM REMINDER: WRONG NARRATOR — REWRITE THIS TURN — v1.48]
The previous draft broke the narration perspective (${reason}).
Write the same events again ${person === 'first'
        ? `in the first person AS ${pcName}: "I" is ${pcName}. Every other character is "he", "she" or their name, seen from outside.`
        : person === 'second'
            ? `in the second person: ${pcName} is "you". No "I" outside dialogue.`
            : `in the third person, close on ${pcName}. No "I" outside dialogue.`}`;
