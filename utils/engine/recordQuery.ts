// ============================================================================
// RECORD_QUERY.TS — v1.41
//
// The strongest available answer to "the model hallucinated what was on the
// sheet" is not a better prompt. It is not asking the model.
//
// "What are Aldreth's kinks?" is a database query. It has one correct answer,
// that answer is sitting in `knownEntities[].personality`, and every layer of
// machinery between the question and the record is a place for the answer to
// change. v1.38 gave the OOC channel the records; v1.40 made the sections
// addressable. This closes the loop: when the question is unambiguously a
// record lookup, the engine answers it from state, verbatim, with no model call
// at all. Hallucination stops being discouraged and becomes impossible.
//
// The gate is deliberately narrow. An OOC turn is far more often a correction,
// a complaint, or an instruction than a lookup, and those must still reach the
// model — a deterministic "here is the record" in reply to "why do you keep
// softening them" would be useless and rude. Three conditions must all hold:
//
//   1. the body reads as a QUESTION or a LIST IMPERATIVE, not a complaint;
//   2. it names a record or a section of one;
//   3. at least one entity resolved from it.
//
// Anything short of that falls through to the model, which since v1.38 has the
// records in hand anyway. A false negative costs nothing; a false positive
// answers the wrong question, so the bar is set high.
// ============================================================================

import type { KnownEntity } from '../../types';
import { parseSheetSections, getSection, describeSheetSections } from './sheetSections';

/** Section synonyms as a player would type them, mapped to canonical labels. */
const SECTION_QUERIES: { re: RegExp; label: string }[] = [
    { re: /\bkink(?:s|\s*list)?\b|\bfetish(?:es)?\b|\bproclivit(?:y|ies)\b|\bappetite(?:s)?\b|\bspecialit(?:y|ies)\b|\bspecialt(?:y|ies)\b/i, label: 'The Kinks' },
    { re: /\bactual\s+core\b|\btrue\s+self\b|\bcore\b/i, label: 'Actual Core' },
    { re: /\bperformed\s+surface\b|\bsurface\b|\bpublic\s+face\b|\bmask\b/i, label: 'Performed Surface' },
    { re: /\bsubtext\b|\bbleed[- ]?through\b/i, label: 'Subtext Bleed-through' },
    { re: /\bapproach\b|\bmethod(?:s)?\b/i, label: 'The Approach' },
    { re: /\bbody\s+over\s+mind\b/i, label: 'Body Over Mind' },
    { re: /\bselective\s+predation\b|\bpredation\b/i, label: 'Selective Predation' },
    { re: /\blimits?\b|\bhard\s+limits?\b/i, label: 'Limits' },
];

/** The whole record, rather than one section of it. */
const WHOLE_RECORD_RE =
    /\b(?:profile|character\s+sheet|char\s+sheet|sheet|record|personality|bio|dossier|entry)\b/i;

/** Interrogative or list-imperative shapes. */
const QUERY_SHAPE_RE =
    /\b(?:what(?:'?s| is| are)?|which|who|list|tell me|show me|give me|read|display|print|recite|state|name)\b/i;

/**
 * Shapes that are NOT lookups even when they mention a record.
 *
 * Every one of these appears in the reviewed save's OOC turns. "You left out
 * multiple things why are you not providing full lists" names a record and asks
 * a question and is a complaint; answering it with a data dump would be an
 * insult. "Her profile has additional other Kinks" is a correction. Both must
 * reach the model.
 */
const NOT_A_QUERY_RE =
    /\b(?:why (?:are|do|did|aren'?t|don'?t|can'?t)|you (?:are|were|keep|left|failed|need|must|should|will)|stop\b|do not\b|don'?t\b|that is not\b|that'?s not\b|incorrect\b|wrong\b|fucking\b|again!|has additional|is missing|you left out)/i;

export interface RecordQuery {
    /** True when this OOC turn is a record lookup the engine can answer itself. */
    isLookup: boolean;
    /** Canonical section label, or null when the whole record was asked for. */
    section: string | null;
    /** Why it was or was not classified as a lookup — for the debug log. */
    reason: string;
}

/** Classify an OOC body. Pure text analysis; entity resolution is the caller's. */
export const classifyRecordQuery = (oocBody: string): RecordQuery => {
    const body = (oocBody ?? '').trim();
    if (!body) return { isLookup: false, section: null, reason: 'empty' };

    if (NOT_A_QUERY_RE.test(body)) {
        return { isLookup: false, section: null, reason: 'reads as a correction or complaint, not a lookup' };
    }
    if (!QUERY_SHAPE_RE.test(body)) {
        return { isLookup: false, section: null, reason: 'no interrogative or list imperative' };
    }

    const hit = SECTION_QUERIES.find(q => q.re.test(body));
    if (hit) return { isLookup: true, section: hit.label, reason: `section query: ${hit.label}` };
    if (WHOLE_RECORD_RE.test(body)) {
        return { isLookup: true, section: null, reason: 'whole-record query' };
    }
    return { isLookup: false, section: null, reason: 'names no record or section' };
};

/**
 * Answer the query from state. Verbatim, with absence stated as plainly as
 * presence — Liora Calder having no kink list is the answer to the question
 * about her kink list, and it is not a failure to say so.
 */
export const answerRecordQuery = (
    entities: KnownEntity[],
    section: string | null,
): string => {
    if (entities.length === 0) return '';

    const parts = entities.map(e => {
        const record = (e.personality ?? '').trim();
        if (!record) {
            return `${e.name}: no personality record has ever been written for this character. Nothing is recorded.`;
        }

        if (section === null) {
            return `${e.name} — complete record, verbatim:\n${record}\n${describeSheetSections(record)}`;
        }

        const body = getSection(record, section);
        if (body) return `${e.name} — ${section}, verbatim from the record:\n${body}`;

        const parsed = parseSheetSections(record);
        return parsed.isSectioned
            ? `${e.name}: no "${section}" section exists in this character's record. The sections that do exist are: ${parsed.labels.join(', ')}.`
            : `${e.name}: this record is unsectioned prose with no "${section}" section — nothing is recorded under that heading. The record reads, in full:\n${record}`;
    });

    return `${parts.join('\n\n')}\n\n[Answered directly from the world state — this is the stored record, not a summary of it.]`;
};
