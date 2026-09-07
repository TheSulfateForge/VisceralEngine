import { describe, it, expect } from 'vitest';
import { classifyRecordQuery, answerRecordQuery } from '../utils/engine/recordQuery';
import type { KnownEntity } from '../types';

// ============================================================================
// v1.41 — the record answers the record question, with no model in the loop.
//
// Every OOC body below is VERBATIM from the 2026-09-07 Carissa save. Four of
// them are lookups the engine can now answer itself; three are corrections or
// complaints that must still reach the model, and getting that split wrong in
// either direction is the whole risk of this feature.
// ============================================================================

const entity = (e: Partial<KnownEntity>): KnownEntity => ({
    id: 'x', name: '', role: '', location: '', impression: '',
    relationship_level: 'NEUTRAL', leverage: '', ledger: [],
    ...e,
} as KnownEntity);

const ALDRETH = entity({
    name: 'Lord Aldreth Blackmoor',
    status: 'missing',
    personality:
        'Performed Surface: Direct, physically imposing, and easy company. ' +
        'Actual Core: Aldreth uses people with brutal simplicity. ' +
        'The Kinks: Severe genital and breast torture, whipping to blood, heavy impact, needles, ' +
        'breath restriction, forced endurance, and rough breeding use. ' +
        'Body Over Mind: He rejects mind control and psychological conditioning.',
});

/** Unsectioned, and genuinely has no kink list. */
const LIORA = entity({
    name: 'Liora Calder',
    status: 'missing',
    personality:
        'Curious but cautious. Acutely aware of her rarity and the risks it poses. ' +
        'She wants to learn magic and learn to fight.',
});

const NO_RECORD = entity({ name: 'Pell', status: 'present', personality: '' });

describe('v1.41 — lookups are recognised', () => {
    it('classifies the question that produced the fabrication', () => {
        const q = classifyRecordQuery(
            "What are the kink list for the NPC'S Aldreth Blackmoor and Liora Calder? " +
            'List each in entirety without sanitization.',
        );
        expect(q.isLookup).toBe(true);
        expect(q.section).toBe('The Kinks');
    });

    it('classifies the explicit section request', () => {
        const q = classifyRecordQuery(
            "Access the NPC profile for Countess Lyrelle Verancourt and from her Actual Core " +
            "list 'The Kinks:' in full verbatim.",
        );
        expect(q.isLookup).toBe(true);
        // "kinks" wins over "core" — it is the narrower ask.
        expect(q.section).toBe('The Kinks');
    });

    it('classifies a whole-record request', () => {
        const q = classifyRecordQuery('Show me the character sheet for Sania Blackmoor.');
        expect(q.isLookup).toBe(true);
        expect(q.section).toBeNull();
    });

    it('maps the player’s own vocabulary onto canonical labels', () => {
        expect(classifyRecordQuery('What are her proclivities?').section).toBe('The Kinks');
        expect(classifyRecordQuery('What is his actual core?').section).toBe('Actual Core');
        expect(classifyRecordQuery('List her performed surface.').section).toBe('Performed Surface');
    });
});

describe('v1.41 — corrections and complaints still reach the model', () => {
    // Getting these wrong would answer a complaint with a data dump.
    const notLookups = [
        'Her profile has additional other Kinks. List her Kink List Verbatim.',
        'That is not the kink list from Countess Lyrelle Verancourt. It is The Kinks: ' +
        'Extreme heavy piercings, tattoos, branding. You left out multiple things why are ' +
        'you not providing full lists',
        'You are sanitizing the Blackmoor family of their dark character traits. Stop doing ' +
        'this portray the characters as written.',
        'Do not ignore the Actual Cores of their character sheets.',
        'Why are you negotiating, the Blackmoors do not negotiate.',
    ];

    for (const body of notLookups) {
        it(`does not hijack: "${body.slice(0, 48)}…"`, () => {
            expect(classifyRecordQuery(body).isLookup).toBe(false);
        });
    }

    it('does not fire on an instruction with no question in it', () => {
        expect(classifyRecordQuery('Portray NPCs as predatory and possessive.').isLookup).toBe(false);
    });

    it('does not fire on a question that names no record', () => {
        expect(classifyRecordQuery('What time is it in the fiction right now?').isLookup).toBe(false);
    });

    it('is safe on empty input', () => {
        expect(classifyRecordQuery('').isLookup).toBe(false);
    });
});

describe('v1.41 — the answer is the record, verbatim', () => {
    it('returns the kink list exactly, in full', () => {
        const a = answerRecordQuery([ALDRETH], 'The Kinks');
        expect(a).toContain('Severe genital and breast torture, whipping to blood, heavy impact, ' +
            'needles, breath restriction, forced endurance, and rough breeding use.');
        expect(a).toContain('verbatim from the record');
        // The observed fabrication must be impossible, not merely unlikely.
        expect(a).not.toMatch(/sensory deprivation/i);
        expect(a).not.toMatch(/psychological dominance/i);
    });

    it('states an absent section as an answer rather than inventing one', () => {
        const a = answerRecordQuery([LIORA], 'The Kinks');
        expect(a).toMatch(/no "The Kinks" section/);
        expect(a).toMatch(/nothing is recorded under that heading/);
        expect(a).not.toMatch(/exhibitionism|voyeurism|impact play/i);
    });

    it('names the sections that DO exist when one is missing from a sectioned record', () => {
        const a = answerRecordQuery([ALDRETH], 'Selective Predation');
        expect(a).toMatch(/no "Selective Predation" section exists/);
        expect(a).toContain('The Kinks');
        expect(a).toContain('Actual Core');
    });

    it('handles an entity with no record at all', () => {
        expect(answerRecordQuery([NO_RECORD], 'The Kinks'))
            .toMatch(/no personality record has ever been written/);
    });

    it('answers for several characters in one reply', () => {
        const a = answerRecordQuery([ALDRETH, LIORA], 'The Kinks');
        expect(a).toContain('Lord Aldreth Blackmoor');
        expect(a).toContain('Liora Calder');
        expect(a).toContain('rough breeding use');
        expect(a).toMatch(/no "The Kinks" section/);
    });

    it('returns the whole record with its section list when no section was named', () => {
        const a = answerRecordQuery([ALDRETH], null);
        expect(a).toContain('complete record, verbatim');
        expect(a).toContain('Body Over Mind');
        expect(a).toMatch(/Sections present/);
    });

    it('says plainly that it came from state, not from a summary', () => {
        expect(answerRecordQuery([ALDRETH], 'The Kinks'))
            .toMatch(/Answered directly from the world state/);
    });

    it('returns nothing when no entity resolved', () => {
        expect(answerRecordQuery([], 'The Kinks')).toBe('');
    });
});
