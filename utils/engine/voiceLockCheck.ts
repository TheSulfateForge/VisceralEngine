// ============================================================================
// VOICE_LOCK_CHECK.TS — v1.40
//
// CANONICAL_VOICE_LOCK tells the model, in the prompt, today:
//
//     VOCABULARY DISCIPLINE — the restatement is not a paraphrase.
//     Trait words in your restatement must be drawn from the personality
//     record itself... The engine parses this line and checks it against
//     the record.
//
// The engine did not. No such parser existed. It is the same shape as v1.35's
// correction regex, which matched nothing across two entire saves while the
// reminder written for it never fired once: a promise in the prompt with
// nothing behind it, and no way to notice.
//
// The setup was already done, which is what makes this cheap. The voice lock
// FORCES the model to open thought_process with
//
//     "Rendering [Name] per canonical traits: [t1, t2, t3].
//      This turn those traits manifest as: [...]"
//
// so the claimed traits arrive every turn in a parseable form. This module
// reads them back and asks two questions the 2026-09-07 Carissa save answers
// badly:
//
//   1. GROUNDING — is each claimed trait actually in that character's record,
//      or did the model substitute an archetype? The voice lock names the
//      recurring offenders itself: gruff, wary, testing, guarded, suspicious,
//      aristocratic, courteous.
//
//   2. LAYER — for a record with an Actual Core, did the restatement draw on
//      it at all, or name only the Performed Surface? Every Blackmoor turn in
//      the reviewed save restated "Warm, socially fluent, confidently
//      maternal" — the mask, verbatim, and nothing else — while the core sat
//      in the prompt unread. That is the mask-mode failure, and it is visible
//      in the restatement one whole turn before it is visible in the prose.
//
// Findings never fail a turn. They log, and they arm the voice lock with the
// specifics on the next one.
// ============================================================================

import type { KnownEntity } from '../../types';
import { parseSheetSections, CORE_LABEL, SURFACE_LABEL, getSection } from './sheetSections';

/** `Rendering <Name> per canonical traits: <traits>.` — brackets optional. */
const RESTATEMENT_RE =
    /Rendering\s+\[?([^\]\n:]{2,60}?)\]?\s+per\s+canonical\s+traits\s*:\s*\[?([^\].\n]{2,300})\]?/gi;

/** Archetype substitutions the voice lock already forbids by name. */
const ARCHETYPE_OFFENDERS = new Set([
    'gruff', 'wary', 'guarded', 'suspicious', 'testing', 'unimpressed',
    'aristocratic', 'courtly', 'gentlemanly', 'professional', 'well-bred',
    'refined', 'courteous', 'businesslike', 'reserved', 'stern', 'formal',
    'distant', 'dismissive', 'obstructive', 'abrasive', 'unwelcoming',
]);

/** Trait-word noise that carries no characterisation. */
const TRAIT_STOPWORDS = new Set([
    'and', 'the', 'a', 'an', 'very', 'quite', 'rather', 'somewhat', 'but',
    'her', 'his', 'their', 'is', 'as', 'with', 'yet', 'still', 'more',
]);

const contentWords = (s: string): string[] =>
    (s.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []).filter(w => !TRAIT_STOPWORDS.has(w));

/**
 * Light stem so "possessive" matches "possession" and "organises" matches
 * "organizes". Deliberately crude: a false MATCH costs nothing (we simply do
 * not flag), a false MISS produces a wrong finding, so this errs toward
 * matching.
 */
const stem = (w: string): string =>
    w.replace(/(?:ised|ized|ing|edly|ely|es|ed|ly|s)$/i, '')
     .replace(/(?:ise|ize|ive|ful|ous|al)$/i, '')
     .slice(0, 6);

/** Shortest shared prefix that counts two words as the same root. */
const PREFIX_MATCH_LEN = 4;

/**
 * Is this trait word present in the record, allowing for inflection?
 *
 * v1.41.1 — the suffix stripper alone was not enough. It does not strip "-th",
 * so "warm" never matched "warmth", and Lady Mirabel Calder — whose record
 * reads "run with a warmth that never reads as calculation" — was reported nine
 * times in one session for the trait "warm" having no basis in her record. The
 * finding was noise and the log said otherwise.
 *
 * A shared four-character prefix now also counts. That is loose, and loose is
 * the correct direction here: a false MATCH means we decline to flag something,
 * a false MISS means we tell the player their record says something it does not.
 */
const isGroundedWord = (word: string, recordWords: string[], recordStems: Set<string>): boolean => {
    if (recordStems.has(stem(word))) return true;
    if (word.length < PREFIX_MATCH_LEN) return false;
    const prefix = word.slice(0, PREFIX_MATCH_LEN);
    return recordWords.some(r =>
        r.length >= PREFIX_MATCH_LEN && (r.startsWith(prefix) || word.startsWith(r.slice(0, PREFIX_MATCH_LEN))),
    );
};

/**
 * v1.41.1 — is this character actually the subject of the turn?
 *
 * The mask-mode resample fired 17 times in one 29-turn session, 13 of them for
 * a single secondary character who was standing quietly in a scene about
 * someone else. Restating a bystander's surface traits is not a failure worth
 * a full re-roll; restating the surface of the character the turn is ABOUT is.
 *
 * Focal means: they spoke this turn, or the narrative names them at least as
 * often as it names anyone else in the scene.
 */
export const isFocalCharacter = (
    name: string,
    narrative: string | undefined | null,
    speaker: string | undefined | null,
    inSceneNames: string[],
): boolean => {
    const n = (name ?? '').trim().toLowerCase();
    if (!n) return false;

    const spoke = (speaker ?? '').trim().toLowerCase();
    if (spoke && (spoke === n || n.includes(spoke) || spoke.includes(n))) return true;

    const text = (narrative ?? '').toLowerCase();
    if (!text) return false;

    const count = (who: string): number => {
        // Count the most distinctive part of the name — models write "Liora",
        // not "Liora Calder", after the first mention.
        const parts = who.split(/\s+/).filter(w => w.length >= 4);
        if (parts.length === 0) return 0;
        return Math.max(...parts.map(part => {
            const safe = part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return (text.match(new RegExp(`\\b${safe}`, 'g')) ?? []).length;
        }));
    };

    const mine = count(n);
    if (mine === 0) return false;
    const best = Math.max(...inSceneNames.map(o => count(o.toLowerCase())), 0);
    return mine >= best;
};

export interface Restatement {
    /** Name as the model wrote it. */
    name: string;
    /** The claimed traits, split and trimmed. */
    traits: string[];
    /** The raw matched clause, for the log. */
    raw: string;
}

/** Pull every canonical-voice restatement out of a thought_process. */
export const parseRestatements = (thoughtProcess: string | undefined | null): Restatement[] => {
    const text = (thoughtProcess ?? '').trim();
    if (!text) return [];

    const out: Restatement[] = [];
    RESTATEMENT_RE.lastIndex = 0;
    for (const m of text.matchAll(RESTATEMENT_RE)) {
        const name = m[1].trim();
        const traits = m[2]
            .split(/[,;]|\band\b/i)
            .map(t => t.replace(/[\[\]().]/g, '').trim())
            .filter(t => t.length >= 3);
        if (name && traits.length > 0) {
            out.push({ name, traits, raw: m[0].slice(0, 200) });
        }
    }
    return out;
};

export type VoiceLockIssue = 'ungrounded-traits' | 'surface-only';

export interface VoiceLockFinding {
    name: string;
    issues: VoiceLockIssue[];
    /** Claimed traits with no basis in the record. */
    ungrounded: string[];
    /** True when a layered record was restated using only its Performed Surface. */
    surfaceOnly: boolean;
    /** One line, ready for the debug log. */
    detail: string;
}

/**
 * Check one restatement against one record.
 *
 * A trait is GROUNDED when any of its content words stem-matches a word in the
 * record. That is a low bar on purpose: the check exists to catch a wholesale
 * archetype swap ("predatory, exploitative, commodifying" rendered as
 * "aristocratic, charming, courteous"), not to police word choice. An
 * archetype word from the voice lock's own forbidden list is ungrounded unless
 * the record genuinely uses it.
 */
/**
 * v1.51: What the PLAYER'S OWN SHEET says about this NPC.
 *
 * The 2026-11-06 saves flagged Iskra Renne's restatement — "steward",
 * "friend", "frequent lover" — as having "no basis in the record" on turn
 * after turn, and armed the voice lock against it. Those words come straight
 * from the player's character sheet ("Iskra Renne - House Steward, friend,
 * and frequent romantic sexual partner"); only the NPC's own personality
 * field was being read. The lock was pushing the model AWAY from player
 * canon. Sheet lines that name the NPC (relationships, backstory sentences,
 * player canon facts) now count as record for grounding traits. They do not
 * count toward the Actual Core layer check — that stays about the NPC record.
 */
export const playerSheetLinesAbout = (entityName: string, sheetLines: string[]): string[] => {
    const tokens = entityName
        .replace(/\([^)]*\)/g, '')
        .toLowerCase()
        .split(/\s+/)
        .filter(t => t.length >= 4);
    if (tokens.length === 0) return [];
    return sheetLines.filter(line => {
        const l = (line ?? '').toLowerCase();
        return tokens.some(t => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(l));
    });
};

/** v1.51: flatten a character sheet into lines the voice lock can search. */
export const playerSheetLines = (character: {
    relationships?: string[];
    backstory?: string;
    goals?: string[];
} | undefined, canonFacts: string[] = []): string[] => {
    if (!character) return canonFacts;
    const backstorySentences = (character.backstory ?? '').split(/(?<=[.!?])\s+/);
    return [
        ...(character.relationships ?? []),
        ...backstorySentences,
        ...(character.goals ?? []),
        ...canonFacts,
    ].filter(l => typeof l === 'string' && l.trim().length > 0);
};

const ABSENCE_NOTE_RE = /\b(?:off[- ]?(?:scene|screen|stage)|not\s+(?:present|here|on[- ]screen|in\s+(?:the\s+)?(?:scene|room))|absent|asleep|elsewhere|nothing\s+to\s+render|not\s+rendered|does\s+not\s+appear)\b/i;

export const checkRestatement = (
    restatement: Restatement,
    entity: KnownEntity,
    sheetLines: string[] = [],
): VoiceLockFinding | null => {
    const record = (entity.personality ?? '').trim();
    if (!record) return null;

    // Grounding text = the NPC's personality + role + what the player's own
    // sheet says about them (v1.51).
    const groundingText = [
        record,
        entity.role ?? '',
        ...playerSheetLinesAbout(entity.name ?? '', sheetLines),
    ].join('\n');
    const recordWords = contentWords(groundingText);
    const recordStems = new Set(recordWords.map(stem));
    const ungrounded: string[] = [];
    // v1.54: "off-scene this turn", "so nothing to render" are the model
    // correctly NOT rendering an absent NPC — not invented traits. Westcross
    // save turn 56: Liora asleep behind a latched door; the lock armed anyway.
    const traits = restatement.traits.filter(t => !ABSENCE_NOTE_RE.test(t));
    if (traits.length === 0) return null;
    for (const trait of traits) {
        const wordsIn = contentWords(trait);
        if (wordsIn.length === 0) continue;
        if (!wordsIn.some(w => isGroundedWord(w, recordWords, recordStems))) {
            ungrounded.push(trait);
        }
    }

    // Layer check. Only meaningful for a record that HAS both layers.
    const parsed = parseSheetSections(record);
    const hasCore = parsed.labels.includes(CORE_LABEL);
    const hasSurface = parsed.labels.includes(SURFACE_LABEL);
    let surfaceOnly = false;
    if (hasCore && hasSurface) {
        const coreStems = new Set(contentWords(getSection(record, CORE_LABEL)).map(stem));
        const surfaceStems = new Set(contentWords(getSection(record, SURFACE_LABEL)).map(stem));
        const touchedCore = traits.some(t =>
            contentWords(t).some(w => coreStems.has(stem(w)) && !surfaceStems.has(stem(w))));
        const touchedSurface = traits.some(t =>
            contentWords(t).some(w => surfaceStems.has(stem(w))));
        surfaceOnly = touchedSurface && !touchedCore;
    }

    const issues: VoiceLockIssue[] = [];
    if (ungrounded.length > 0) issues.push('ungrounded-traits');
    if (surfaceOnly) issues.push('surface-only');
    if (issues.length === 0) return null;

    const bits: string[] = [];
    if (ungrounded.length > 0) {
        bits.push(`traits with no basis in the record: ${ungrounded.map(t => `"${t}"`).join(', ')}`);
    }
    if (surfaceOnly) {
        bits.push(
            `restated ONLY the Performed Surface — the record has an Actual Core and the ` +
            `restatement drew nothing from it`,
        );
    }

    return {
        name: entity.name,
        issues,
        ungrounded,
        surfaceOnly,
        detail: `${entity.name}: ${bits.join('; ')}.`,
    };
};

/**
 * Check every restatement in a turn against the entities in scene.
 *
 * Unmatched names are ignored rather than reported: the model may restate a
 * character the engine does not have a record for, and that is the entity
 * pipeline's problem, not this one's.
 */
export const checkVoiceLock = (
    thoughtProcess: string | undefined | null,
    entities: KnownEntity[],
    sheetLines: string[] = [],     // v1.51 — see playerSheetLinesAbout
): VoiceLockFinding[] => {
    const restatements = parseRestatements(thoughtProcess);
    if (restatements.length === 0) return [];

    const findings: VoiceLockFinding[] = [];
    for (const r of restatements) {
        const wanted = r.name.toLowerCase();
        const entity =
            entities.find(e => e.name?.toLowerCase() === wanted) ??
            // The model routinely shortens "Duchess Sania Blackmoor" to "Sania".
            entities.find(e => {
                const parts = (e.name ?? '').toLowerCase().split(/\s+/);
                return parts.includes(wanted) || wanted.split(/\s+/).every(w => parts.includes(w));
            });
        if (!entity) continue;
        const finding = checkRestatement(r, entity, sheetLines);
        if (finding) findings.push(finding);
    }
    return findings;
};
