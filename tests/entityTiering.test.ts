import { describe, it, expect } from 'vitest';
import { buildEntityContext } from '../utils/promptUtils';
import type { KnownEntity } from '../types';

// ===========================================================================
// v1.36 — [ACTIVE ENTITIES] tiering.
//
// In save A of 2026-08-31 the entity block peaked at 24,716 characters while
// exactly TWO entities were `present`. The other ~9 were the Bellwether cast —
// all marked 'missing', in a different settlement — rendered at 2.0-3.6k each
// because the mention sentinel had seen them named in the last narrative.
//
// The size is the symptom. The real error is that "the narrative mentioned
// her" was being treated as "she is in the room", which is a different claim.
//
// Two prior fixes must survive this, and both are asserted below:
//   v1.23 — an entity the PLAYER named renders with full personality even when
//           its status is stale, or the model improvises ("Aster is an elf").
//   v1.24 — a dual-layer personality must never lose its "Actual Core" half,
//           or every layered character collapses into their own mask.
// ===========================================================================

const ELSPETH_PERSONALITY =
    'Performed Surface: The ornament. Gracious, decorative, impeccably pleasant, and entirely ' +
    'without opinions in company. She agrees, defers, and smiles, and Crownhill has concluded she ' +
    'is sweet and not particularly bright, which is the single most useful thing anyone has ever ' +
    'believed about her. Subtext Bleed-through: She watches hands, and anyone working with skill ' +
    'pulls her attention completely and visibly, and she forgets to keep her face pleasant for a ' +
    'beat too long. Actual Core: She is furious, permanently and quietly, at being an object with ' +
    'a face on it, displayed constantly and seen by nobody. What she wants is to be wanted for ' +
    'what she can do, and the fixation runs along exactly that line.';

const entity = (over: Partial<KnownEntity> = {}): KnownEntity => ({
    id: 'e1',
    name: 'Maribel Jessop',
    role: 'Head Milk Matron',
    location: 'Bellwether Steading',
    status: 'present',
    relationship_level: 'WARM',
    personality: 'Unhurried, unshockable, and physically incapable of being rushed, with the manner '
        + 'of a woman who has already seen the thing you are panicking about. She is warm to guests '
        + 'and genuinely delighted by them, which is not politeness, since Bellwether gets few '
        + 'visitors and she likes new faces. She handles the steading contracts herself and '
        + 'negotiates by naming her terms and then waiting.',
    voice_sample: 'The forge will be cold by dawn, but we have heat left to beat the brass today.',
    impression: 'Settled and unhurried; watching the work rather than the man doing it.',
    leverage: 'Controls the steading water supply and the caravan schedule.',
    ledger: ['Fed the PC stew and asked for a pulse-seal repair.'],
    ...over,
} as KnownEntity);

describe('present entities are unchanged', () => {
    const block = buildEntityContext([entity()], new Set(), new Set());

    it('renders in the full tier', () => {
        expect(block).toContain('[ACTIVE ENTITIES — In Scene / Nearby]');
        expect(block).not.toContain('[MENTIONED');
    });

    it('keeps personality, voice sample, leverage and ledger', () => {
        expect(block).toContain('Personality (CANONICAL');
        expect(block).toContain('Unhurried, unshockable');
        expect(block).toContain('Voice sample (write their dialogue in THIS register)');
        expect(block).toContain('Leverage:');
        expect(block).toContain('Ledger:');
    });
});

describe('v1.23 guarantee — an entity the PLAYER named renders in full', () => {
    // Alias matches never enter mentionedOnlyIds, so a stale-status seed NPC the
    // player just addressed still gets the whole block.
    const seed = entity({ id: 'e2', name: 'Aster Vane', status: 'distant' });
    const block = buildEntityContext([seed], new Set(['e2']), new Set());

    it('is in the full tier despite a distant status', () => {
        expect(block).toContain('[ACTIVE ENTITIES — In Scene / Nearby]');
        expect(block).toContain('Leverage:');
        expect(block).toContain('Unhurried, unshockable');
    });

    it('is not demoted to the mentioned tier', () => {
        expect(block).not.toContain('[MENTIONED');
    });
});

describe('the mentioned tier', () => {
    const absent = entity({ id: 'e3', status: 'missing', personality: ELSPETH_PERSONALITY });
    const block = buildEntityContext([absent], new Set(['e3']), new Set(['e3']));

    it('renders under its own heading and says they are not here', () => {
        expect(block).toContain('[MENTIONED — referenced in the last turn, NOT in the scene]');
        expect(block).toContain('Do not have them speak or act here');
        expect(block).not.toContain('[ACTIVE ENTITIES');
    });

    it('keeps personality — that is what stops the model improvising', () => {
        expect(block).toContain('Personality (CANONICAL');
        expect(block).toContain('Performed Surface');
    });

    it('v1.24 guarantee — the dual-layer core half survives the cap', () => {
        expect(block).toMatch(/Actual Core/i);
        expect(block).toContain('furious');
    });

    it('drops leverage and ledger — they drive how an NPC plays a scene it is not in', () => {
        expect(block).not.toContain('Leverage:');
        expect(block).not.toContain('Ledger:');
    });

    it('is substantially smaller than the full tier for the same entity', () => {
        const full = buildEntityContext([absent], new Set(['e3']), new Set());
        expect(block.length).toBeLessThan(full.length * 0.75);
    });
});

describe('a present entity is never demoted', () => {
    it('stays in the full tier even when the sentinel also flagged it', () => {
        // Maribel is in the room AND named in the last narrative. Being talked
        // about does not remove you from the room.
        const block = buildEntityContext([entity()], new Set(['e1']), new Set(['e1']));
        expect(block).toContain('[ACTIVE ENTITIES — In Scene / Nearby]');
        expect(block).toContain('Leverage:');
        expect(block).not.toContain('[MENTIONED');
    });
});

describe('impression capping', () => {
    // Specified as a short situational read; measured at a 631-char mean and a
    // 955-char max across the reviewed saves.
    const essay = 'She is watching him work. '.repeat(60);

    it('caps an over-long impression in the full tier', () => {
        const block = buildEntityContext([entity({ impression: essay })], new Set(), new Set());
        expect(block).toContain('[…]');
        expect(block.length).toBeLessThan(essay.length);
    });

    it('leaves a properly short impression untouched', () => {
        const block = buildEntityContext([entity()], new Set(), new Set());
        expect(block).toContain('Settled and unhurried; watching the work rather than the man doing it.');
        expect(block).not.toContain('[…]');
    });

    it('never truncates mid-word', () => {
        const block = buildEntityContext([entity({ impression: essay })], new Set(), new Set());
        const cut = block.split('[…]')[0];
        expect(cut.endsWith('wor')).toBe(false);
        expect(cut).toMatch(/[.\s]$/);
    });
});

describe('the three tiers coexist', () => {
    it('splits a mixed cast correctly and keeps the not-present one-liner', () => {
        const cast = [
            entity({ id: 'p1', name: 'Pell Jessop', status: 'present' }),
            entity({ id: 'm1', name: 'Elspeth Ferrand', status: 'missing', personality: ELSPETH_PERSONALITY }),
            entity({ id: 'd1', name: 'Sibb Amory', status: 'distant' }),
        ];
        const block = buildEntityContext(cast, new Set(['m1']), new Set(['m1']));

        expect(block).toContain('[ACTIVE ENTITIES — In Scene / Nearby]');
        expect(block).toContain('Pell Jessop');
        expect(block).toContain('[MENTIONED — referenced in the last turn, NOT in the scene]');
        expect(block).toContain('Elspeth Ferrand');
        expect(block).toContain('[KNOWN — Relevant but not present]');
        expect(block).toContain('Sibb Amory');
    });

    it('is a large saving on the shape that produced the 24,716-char peak', () => {
        // Two present, nine mentioned-only — save A's actual composition.
        const cast: KnownEntity[] = [
            entity({ id: 'p1', name: 'Elspeth Ferrand', status: 'present', personality: ELSPETH_PERSONALITY }),
            entity({ id: 'p2', name: 'Lapis', status: 'present' }),
            ...Array.from({ length: 9 }, (_, i) => entity({
                id: `m${i}`,
                name: `Absent NPC ${i}`,
                status: 'missing',
                // Real personalities in the reviewed saves ran 1,030-2,417 chars.
                personality: `${ELSPETH_PERSONALITY} ${ELSPETH_PERSONALITY}`,
                impression: 'She is watching him work and weighing what it means. '.repeat(12),
            })),
        ];
        const force = new Set(cast.map(e => e.id));
        const mentionedOnly = new Set(cast.filter(e => e.status === 'missing').map(e => e.id));

        const before = buildEntityContext(cast, force, new Set());
        const after = buildEntityContext(cast, force, mentionedOnly);

        expect(after.length).toBeLessThan(before.length * 0.55);
        // The two people actually in the scene are untouched.
        expect(after).toContain('Leverage:');
        expect(after).toContain('Elspeth Ferrand');
        expect(after).toContain('Lapis');
    });
});
