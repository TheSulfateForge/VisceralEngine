import { describe, it, expect } from 'vitest';
import { buildOocEntityRecords } from '../utils/promptUtils';
import { findAliasMatchedEntities } from '../utils/ragEngine';
import type { KnownEntity } from '../types';

// ============================================================================
// v1.38 — the OOC channel could not read a record.
//
// From the 2026-09-07 save (Carissa Vorn, second export). The player asked, out
// of character, for two NPCs' kink lists. The channel sends no world state at
// all — a situation line, the last four messages, and the question — so the
// model reconstructed from the narrative tail:
//
//   PLAYER: [OOC: What are the kink list for the NPC'S Aldreth Blackmoor and
//            Liora Calder? List each in entirety without sanitization.]
//   ENGINE: Aldreth Blackmoor's kinks include extreme bondage, sensory
//            deprivation, and power exchange dynamics involving psychological
//            dominance. Liora Calder's kinks include public exhibitionism,
//            voyeurism, and intense impact play...
//
// Aldreth's record says none of that, and contradicts it outright. Liora has no
// kink list at all — nor an Actual Core. Both were 'missing', so even the
// narrative path would have tiered them away.
//
// The records below are verbatim from that save's knownEntities.
// ============================================================================

const entity = (e: Partial<KnownEntity>): KnownEntity => ({
    id: 'x', name: '', role: '', location: '', impression: '',
    relationship_level: 'NEUTRAL', leverage: '', ledger: [],
    ...e,
} as KnownEntity);

/** Verbatim. Note the kink list and the Body Over Mind clause. */
const ALDRETH = entity({
    id: 'npc_lord_aldreth_blackmoor',
    name: 'Lord Aldreth Blackmoor',
    role: 'Middle son of House Blackmoor',
    status: 'missing',
    personality:
        'Performed Surface: Direct, physically imposing, and easy company. ' +
        'Actual Core: Aldreth uses people with brutal simplicity. ' +
        'The Kinks: Severe genital and breast torture, whipping to blood, heavy impact, needles, ' +
        'breath restriction, forced endurance, and rough breeding use. ' +
        'Body Over Mind: He rejects mind control and psychological conditioning as fussy, ' +
        'unreliable work.',
});

/** Verbatim — 289 characters, unlayered, no Actual Core and no kink list. */
const LIORA = entity({
    id: 'npc_liora_calder',
    name: 'Liora Calder',
    role: 'Noble Heir; Rare Second-Generation Hucow',
    status: 'missing',
    personality:
        'Curious but cautious. Acutely aware of her rarity and the risks it poses.\n' +
        'She wants to learn magic and learn to fight. She doesn’t like her mother’s method ' +
        'of hiding. Since she has started lactating she is looking for a sexual partner she can ' +
        'be open with and explore her desires and lust.',
});

const NO_RECORD = entity({
    id: 'npc_pell',
    name: 'Pell',
    role: 'Steading hand',
    status: 'present',
    personality: '',
});

/** The player's actual question, verbatim. */
const THE_QUESTION =
    "What are the kink list for the NPC'S Aldreth Blackmoor and Liora Calder? " +
    'List each in entirety without sanitization.';

describe('v1.38 — the named NPCs are resolved from the OOC question', () => {
    it('matches both characters the player asked about', () => {
        const matched = findAliasMatchedEntities(THE_QUESTION, [], [ALDRETH, LIORA, NO_RECORD]);
        const names = matched.map(e => e.name);
        expect(names).toContain('Lord Aldreth Blackmoor');
        expect(names).toContain('Liora Calder');
    });

    it('does not drag in an NPC the question never named', () => {
        const matched = findAliasMatchedEntities(THE_QUESTION, [], [ALDRETH, LIORA, NO_RECORD]);
        expect(matched.map(e => e.name)).not.toContain('Pell');
    });
});

describe('v1.38 — records render complete, whatever the entity status', () => {
    it('includes a missing entity — a lookup is not a scene', () => {
        const block = buildOocEntityRecords([ALDRETH]);
        expect(block).toContain('Lord Aldreth Blackmoor');
        expect(block).toContain('status: missing');
    });

    it('carries the kink list verbatim and uncapped', () => {
        const block = buildOocEntityRecords([ALDRETH]);
        // The whole list, including the tail a head-truncation would have eaten.
        expect(block).toContain('Severe genital and breast torture');
        expect(block).toContain('rough breeding use');
        // And the clause that makes the observed fabrication self-contradictory.
        expect(block).toContain('rejects mind control and psychological conditioning');
        expect(block).not.toContain('[…]');
    });

    it('marks an empty personality as empty rather than omitting the entity', () => {
        const block = buildOocEntityRecords([NO_RECORD]);
        expect(block).toContain('Pell');
        expect(block).toMatch(/EMPTY — no personality has ever been recorded/);
    });

    it('renders Liora fully, so the absent kink list is visibly absent', () => {
        const block = buildOocEntityRecords([LIORA]);
        expect(block).toContain('Curious but cautious');
        expect(block).toContain('explore her desires and lust');
        // Her record genuinely has no sections at all. v1.40 states that
        // outright rather than leaving the model to notice an absence.
        expect(block).toMatch(/Sections present: NONE/);
        expect(block).toMatch(/no Actual Core, no kink list/);
        expect(block).toMatch(/answered "not recorded"/);
        // And it must never look like she HAS such a section.
        expect(block).not.toMatch(/The Kinks: \w/);
    });

    it('renders nothing when the question named nobody', () => {
        expect(buildOocEntityRecords([])).toBe('');
    });
});

describe('v1.38 — the framing forbids the observed failure', () => {
    const block = buildOocEntityRecords([ALDRETH, LIORA]);

    it('declares itself the only source, over the recent exchange', () => {
        expect(block).toMatch(/ONLY SOURCE/);
        expect(block).toMatch(/Do not answer from the recent exchange/);
        // The Lyrelle fabrications echoed the preceding narrative; the Liora
        // ones were what "a character like this usually wants".
        expect(block).toMatch(/what a character like this usually wants/);
    });

    it('makes "not in the record" an explicit, allowed answer', () => {
        expect(block).toMatch(/not in the record/);
        expect(block).toMatch(/an absent\s+field is a real and useful answer/);
    });

    it('bans the fake quotation specifically', () => {
        expect(block).toMatch(/[Nn]ever present invented text as a quotation/);
        expect(block).toContain('listed as follows');
        expect(block).toContain('verbatim');
    });

    it('keeps both characters in one block', () => {
        expect(block).toContain('Lord Aldreth Blackmoor');
        expect(block).toContain('Liora Calder');
    });
});
