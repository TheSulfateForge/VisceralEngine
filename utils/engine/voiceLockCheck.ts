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
export const checkRestatement = (
    restatement: Restatement,
    entity: KnownEntity,
): VoiceLockFinding | null => {
    const record = (entity.personality ?? '').trim();
    if (!record) return null;

    const recordStems = new Set(contentWords(record).map(stem));
    const ungrounded: string[] = [];
    for (const trait of restatement.traits) {
        const wordsIn = contentWords(trait);
        if (wordsIn.length === 0) continue;
        const grounded = wordsIn.some(w => recordStems.has(stem(w)));
        const isOffender = wordsIn.some(w => ARCHETYPE_OFFENDERS.has(w));
        if (!grounded || (isOffender && !wordsIn.some(w => ARCHETYPE_OFFENDERS.has(w) && recordStems.has(stem(w))))) {
            if (!grounded) ungrounded.push(trait);
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
        const touchedCore = restatement.traits.some(t =>
            contentWords(t).some(w => coreStems.has(stem(w)) && !surfaceStems.has(stem(w))));
        const touchedSurface = restatement.traits.some(t =>
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
        const finding = checkRestatement(r, entity);
        if (finding) findings.push(finding);
    }
    return findings;
};
