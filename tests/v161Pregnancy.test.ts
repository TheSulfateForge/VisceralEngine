// v1.61 — pregnancies: created on a successful roll, PC-only, clock-based gestation.
import { describe, it, expect } from 'vitest';
import {
    ReproductionSystem,
    resolveConceptionParticipants,
    MINUTES_PER_WEEK,
} from '../utils/reproductionSystem';
import type { Character, Pregnancy } from '../types';

const pc = (gender: string) => ({ name: 'Mara Voss', gender } as unknown as Character);

describe('v1.61 resolveConceptionParticipants', () => {
    it('finds the partner when the PC is inseminated', () => {
        expect(resolveConceptionParticipants([{ who: 'Mara Voss', kind: 'insemination', orifice: 'vaginal', by: 'Tomas' }], 'Mara Voss'))
            .toEqual({ involvesPc: true, partnerName: 'Tomas' });
    });
    it('finds the partner when the PC does the inseminating, and matches first names', () => {
        expect(resolveConceptionParticipants([{ who: 'Ilse', kind: 'penetration', orifice: 'vaginal', with: 'penis', by: 'Mara' }], 'Mara Voss'))
            .toEqual({ involvesPc: true, partnerName: 'Ilse' });
    });
    it('rejects an act between two NPCs', () => {
        expect(resolveConceptionParticipants([{ who: 'Ilse', kind: 'insemination', orifice: 'vaginal', by: 'Tomas' }], 'Mara Voss').involvesPc)
            .toBe(false);
    });
    it('trusts the flag with an unknown partner when no body_events were sent', () => {
        expect(resolveConceptionParticipants(undefined, 'Mara Voss')).toEqual({ involvesPc: true, partnerName: 'Unknown' });
    });
    it('ignores anal and oral events', () => {
        expect(resolveConceptionParticipants([{ who: 'Ilse', kind: 'insemination', orifice: 'anal', by: 'Tomas' }], 'Mara Voss').involvesPc)
            .toBe(true); // no conceptive event reported → flag trusted
    });
});

describe('v1.61 initiatePregnancy', () => {
    it('makes a female PC the mother and a male PC the father', () => {
        const f = ReproductionSystem.initiatePregnancy(pc('Female'), 7, 1000, 'Tomas');
        expect([f.motherName, f.fatherName, f.conceptionTurn, f.conceptionTime]).toEqual(['Mara Voss', 'Tomas', 7, 1000]);
        const m = ReproductionSystem.initiatePregnancy(pc('Male'), 7, 1000, 'Ilse');
        expect([m.motherName, m.fatherName]).toEqual(['Ilse', 'Mara Voss']);
    });
    it('alreadyPregnant matches a gestating mother but never Unknown', () => {
        const p = ReproductionSystem.initiatePregnancy(pc('Female'), 1, 0, 'Tomas');
        expect(ReproductionSystem.alreadyPregnant([p], 'mara voss')).toBe(true);
        expect(ReproductionSystem.alreadyPregnant([{ ...p, motherName: 'Unknown' }], 'Unknown')).toBe(false);
    });
});

describe('v1.61 advancePregnancies (in-game clock)', () => {
    const base: Pregnancy = { id: 'p', motherName: 'Mara Voss', fatherName: 'Tomas', conceptionTurn: 1, conceptionTime: 5000, currentWeek: 0, isVisible: false, status: 'gestating' };
    it('counts weeks from conception time, regardless of turns', () => {
        const { updated } = ReproductionSystem.advancePregnancies([base], 5000 + 3 * MINUTES_PER_WEEK + 10);
        expect(updated[0].currentWeek).toBe(3);
        expect(updated[0].isVisible).toBe(false);
    });
    it('becomes visible at week 12 and never delivers on its own (processBirths does)', () => {
        const v = ReproductionSystem.advancePregnancies([base], 5000 + 12 * MINUTES_PER_WEEK).updated[0];
        expect(v.isVisible).toBe(true);
        expect(v.status).toBe('gestating');
        const t = ReproductionSystem.advancePregnancies([base], 5000 + 45 * MINUTES_PER_WEEK);
        expect(t.updated[0].status).toBe('gestating');
    });
});

import { describePregnancy, pcPregnancy, syncPregnancyRegisters, PREGNANCY_STATE_KEY } from '../utils/reproductionSystem';
import { parseRegisterDiffs, scrubRegisterState, createRegister } from '../utils/engine/npcRegister';
import type { KnownEntity } from '../types';

describe('v1.61 pregnancy description and records', () => {
    const preg = (mother: string, father: string): Pregnancy => ({ id: 'x', motherName: mother, fatherName: father, conceptionTurn: 3, conceptionTime: 0, currentWeek: 0, isVisible: false, status: 'gestating' });

    it('describes the stage from the clock', () => {
        expect(describePregnancy(preg('Ilse', 'Mara Voss'), 14 * MINUTES_PER_WEEK))
            .toBe('pregnant by Mara Voss — week 14 of 40 (second trimester), showing, due in about 26 weeks');
        expect(describePregnancy(preg('Ilse', 'Unknown'), 2 * MINUTES_PER_WEEK)).toContain('father unknown');
        expect(describePregnancy({ ...preg('Ilse', 'Tomas'), dueWeek: 39 }, 38 * MINUTES_PER_WEEK)).toContain('labor could start any day');
    });

    it('pcPregnancy only returns a female PC\'s own pregnancy', () => {
        const ps = [preg('Mara Voss', 'Tomas')];
        expect(pcPregnancy(ps, pc('Female'))).toBeDefined();
        expect(pcPregnancy(ps, pc('Male'))).toBeUndefined();
        expect(pcPregnancy([preg('Ilse', 'Mara Voss')], pc('Female'))).toBeUndefined();
    });

    it('writes an NPC mother\'s pregnancy into her register, opening one if needed', () => {
        const ents = [{ id: 'e1', name: 'Ilse Brandt', ledger: [] } as unknown as KnownEntity];
        const out = syncPregnancyRegisters(ents, [preg('Ilse', 'Mara Voss')], 'Mara Voss', 5 * MINUTES_PER_WEEK, 9);
        const st = out[0].register!.state.find(s => s.key === PREGNANCY_STATE_KEY)!;
        expect(st.value).toContain('week 5 of 40');
        // Unchanged → same array back.
        expect(syncPregnancyRegisters(out, [preg('Ilse', 'Mara Voss')], 'Mara Voss', 5 * MINUTES_PER_WEEK, 10)).toBe(out);
        // Advances in place, one entry only.
        const later = syncPregnancyRegisters(out, [preg('Ilse', 'Mara Voss')], 'Mara Voss', 20 * MINUTES_PER_WEEK, 30);
        expect(later[0].register!.state.filter(s => s.key === PREGNANCY_STATE_KEY)).toHaveLength(1);
        expect(later[0].register!.state[0].value).toContain('week 20');
    });

    it('the register pass cannot write the pregnancy key, and the scrub keeps it', () => {
        const d = parseRegisterDiffs({ updates: [{ npc: 'Ilse', state: [{ key: 'pregnancy', value: 'not pregnant' }, { key: 'pregnant', value: 'yes' }] }] });
        expect(d[0]?.state ?? []).toHaveLength(0);
        const reg = { ...createRegister(1), state: [{ key: 'pregnancy', value: 'pregnant by Mara Voss — week 3', turn: 1 }] };
        expect(scrubRegisterState(reg).register.state).toHaveLength(1);
    });
});
