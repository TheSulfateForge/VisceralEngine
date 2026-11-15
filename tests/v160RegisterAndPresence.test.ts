import { describe, it, expect } from 'vitest';
import { inferLocationMove, isRecollection } from '../utils/engine/locationGraph';
import { actsInNarrative, placesOverlap, demoteRemoteNearby, updateEntityPresence } from '../utils/engine/entityLifecycle';
import { parseRegisterDiffs, routeStateKey, scrubRegisterState, createRegister, applyRegisterDiff, openRegisters } from '../utils/engine/npcRegister';
import { _buildRegisterPrompt } from '../services/registerService';
import { getResponseSchema } from '../schemas/responseSchema';
import type { KnownEntity, LocationGraph } from '../types';

// Built from the 2026-11-15 Westcross save.
const GRAPH = {
    nodes: {
        caerveld: { id: 'caerveld', displayName: 'Caerveld', firstMentionedTurn: 0, tags: ['capital', 'city', 'urban'], description: 'The bustling capital of the Verdant Compact.' },
        drevast_palace: { id: 'drevast_palace', displayName: 'Drevast Palace', firstMentionedTurn: 0, tags: ['palace', 'royal', 'caerveld'], description: 'The seat of House Drevast in Caerveld, a sprawling palace complex.' },
        the_westcross_townhouse: { id: 'the_westcross_townhouse', displayName: 'The Westcross Townhouse', firstMentionedTurn: 0, tags: ['townhouse', 'noble', 'caerveld'], description: 'Built entirely of granite and marble.' },
        bedroom: { id: 'bedroom', displayName: 'The Westcross Townhouse — Master Bedroom', firstMentionedTurn: 20, tags: [] },
        drawing: { id: 'drawing', displayName: "Queen's Small Drawing Room, Drevast Palace", firstMentionedTurn: 51, tags: [] },
        sablebrook_manor: { id: 'sablebrook_manor', displayName: 'Sablebrook Manor', firstMentionedTurn: 0, tags: ['estate', 'rural'], description: "A few days' ride from Caerveld." },
    },
    edges: [
        { from: 'drevast_palace', to: 'caerveld', travelTimeMinutes: 0, source: 'ai_declared', createdTurn: 0, modeOverrides: { 'within city': 0 } },
        { from: 'the_westcross_townhouse', to: 'drevast_palace', travelTimeMinutes: 0, source: 'ai_declared', createdTurn: 0, modeOverrides: { 'within city': 0 } },
    ],
    playerLocationId: 'bedroom',
} as unknown as LocationGraph;

const ent = (name: string, extra: Partial<KnownEntity> = {}): KnownEntity => ({
    id: name, name, role: 'x', location: '', impression: '', relationship_level: 'WARM', leverage: '',
    ledger: [], status: 'present', lastSeenTurn: 1, ...extra,
} as KnownEntity);

describe('v1.60 — a remembered trip is not a trip', () => {
    const BED = 'The Westcross Townhouse — Master Bedroom';
    it('turn 32: "Since the horse ride from the palace I decided…" does not move the player', () => {
        expect(inferLocationMove(GRAPH, '', "I've never milked a woman before. Since the horse ride form the palace I decided I was going to milk you.", BED)).toBeNull();
    });
    it('"from" is an origin, never a destination', () => {
        expect(inferLocationMove(GRAPH, '', 'We ride home from Drevast Palace.', BED)).toBeNull();
    });
    it('a real trip still counts', () => {
        expect(inferLocationMove(GRAPH, '', 'We walk down, I help her into the carriage and we ride to Drevast Palace.', BED)?.location_name).toBe('Drevast Palace');
    });
    it('recollection words in the same sentence stop it; another sentence does not', () => {
        expect(isRecollection('This morning we rode to the palace.', 15)).toBe(true);
        expect(isRecollection('I remember that. We ride to the palace.', 26)).toBe(false);
    });
});

describe('v1.60 — presence', () => {
    it('one place inside the other is not "elsewhere"', () => {
        expect(placesOverlap(GRAPH, 'Drevast Palace', 'Caerveld')).toBe(true);
        expect(placesOverlap(GRAPH, "Queen's Small Drawing Room, Drevast Palace", 'Caerveld')).toBe(true);
        expect(placesOverlap(GRAPH, 'The Westcross Townhouse', 'Drevast Palace')).toBe(false); // two buildings in one city
        expect(placesOverlap(GRAPH, 'Sablebrook Manor', 'Caerveld')).toBe(false);
    });
    it('Liora at the palace while the player is "Caerveld" stays present', () => {
        const logs: any[] = [];
        const out = demoteRemoteNearby([ent('Liora Calder (Duchess Westcross)', { location: 'Drevast Palace' })], GRAPH, 'Caerveld', 56, logs);
        expect(out[0].status).toBe('present');
    });
    it('an NPC shown speaking or acting in the prose is present', () => {
        const L = 'Liora Calder (Duchess Westcross)';
        for (const t of ['"Yes," Liora said.', 'Liora leaned into him.', "Liora's tail curled around the chair leg.", 'Liora slowly turned.'])
            expect(actsInNarrative(t, L), t).toBe(true);
        for (const t of ['I thought of Liora.', 'Mirabel said Liora had said nothing.', 'Liora had said it before.', 'Liora would have laughed.', 'The letter from Liora sat on the desk.'])
            expect(actsInNarrative(t, L), t).toBe(false);
    });
    it('updateEntityPresence brings a wrongly-distant NPC back', () => {
        const logs: any[] = [];
        const out = updateEntityPresence([ent('Liora Calder (Duchess Westcross)', { status: 'distant', location: 'Drevast Palace', lastSeenTurn: 40 })],
            'The Queen poured. Liora took the cup and said she had walked out of House Calder.', [], undefined, 53, 'Caerveld', logs, 'Caerveld');
        expect(out[0].status).toBe('present');
        expect(out[0].lastSeenTurn).toBe(53);
        expect(logs.map(l => l.message).join('\n')).toMatch(/PRESENCE — v1.60\] Liora Calder .* present \(was distant\)/);
    });
    it('a mention alone still does not promote (v1.27 rule kept)', () => {
        const out = updateEntityPresence([ent('Lord Halric', { status: 'distant', lastSeenTurn: 1 })], 'She thought of Halric.', [], undefined, 9, 'Caerveld', [], 'Caerveld');
        expect(out[0].status).toBe('distant');
    });
});

describe('v1.60 — register state holds only what lasts', () => {
    it('routes each key the pass wrote in the save', () => {
        expect(routeStateKey('posture_with_ryan', '').kind).toBe('drop');
        expect(routeStateKey('clothing_status_updated'.replace(/_updated$/, ''), '').kind).toBe('drop');
        expect(routeStateKey('gag_response', '').kind).toBe('drop');
        expect(routeStateKey('fellatio_technique', '').kind).toBe('drop');
        expect(routeStateKey('mood_toward_ryan', '')).toEqual({ kind: 'feeling', toward: 'Ryan' });
        expect(routeStateKey('knowledge_of_ryan', '').kind).toBe('knowledge');
        expect(routeStateKey('court_action', '').kind).toBe('knowledge');
        expect(routeStateKey('first_blowjob', '')).toEqual({ kind: 'act', act: 'blowjob' });
        expect(routeStateKey('limits_stated', '')).toEqual({ kind: 'want', want: 'limit' });
        expect(routeStateKey('not_yet', '')).toEqual({ kind: 'want', want: 'not_yet' });
        for (const k of ['title', 'milking_schedule', 'household_expectations', 'household_social_standing', 'status_as_wife', 'sleeping_arrangement'])
            expect(routeStateKey(k, '').kind, k).toBe('keep');
    });
    it('parse routes instead of storing', () => {
        const [d] = parseRegisterDiffs({ updates: [{ npc: 'Liora', state: [
            { key: 'title', value: 'Duchess Westcross' },
            { key: 'posture_with_ryan', value: 'Forehead pressed to his' },
            { key: 'mood_toward_ryan', value: 'Curious and turned toward him' },
            { key: 'first_blowjob', value: 'yes' },
        ] }] });
        expect(d.state).toEqual([{ key: 'title', value: 'Duchess Westcross' }]);
        expect(d.feelings).toEqual([{ toward: 'Ryan', text: 'Curious and turned toward him' }]);
        expect(d.intimacy?.acts).toEqual(['blowjob']);
    });
    it('cleans a register written before the filter, once', () => {
        let r = createRegister(1);
        r = { ...r, state: [
            { key: 'title', value: 'Duchess Westcross', turn: 1 },
            { key: 'posture_with_ryan', value: 'x', turn: 30 },
            { key: 'clothing_status', value: 'y', turn: 42 },
            { key: 'mood_toward_ryan', value: 'Openly candid', turn: 42 },
            { key: 'limits_stated', value: 'No full penetration yet', turn: 36 },
        ] };
        const { register, moved, removed } = scrubRegisterState(r);
        expect(register.state.map(s => s.key)).toEqual(['title']);
        expect(register.feelings[0]).toMatchObject({ toward: 'Ryan', text: 'Openly candid', turn: 42 });
        expect(register.intimacy.wants[0]).toMatchObject({ kind: 'limit', text: 'No full penetration yet' });
        expect([moved, removed]).toEqual([2, 2]);
        expect(scrubRegisterState(register).register).toBe(register); // idempotent
    });
    it('a register applied with a state-free diff keeps working', () => {
        const r = applyRegisterDiff(createRegister(1), { npc: 'L', intimacy: { acts: ['milking', 'orgasm (hers)'] } }, 25).register;
        expect(r.intimacy.firsts.map(f => f.act)).toEqual(['milking', 'orgasm (hers)']);
    });
});

describe('v1.60 — the pass is told where things go', () => {
    const p = _buildRegisterPrompt({ pcName: 'Ryan', turn: 5, playerInput: '', narrative: '', npcs: [ent('Liora', { register: createRegister(1) })] });
    it('state is only what lasts; the moment is never recorded', () => {
        expect(p).toMatch(/STILL be true next week/);
        expect(p).toMatch(/NEVER state: where they are or how they sit\/stand\/lie, what they wear/);
    });
    it('acts are required; wants are only sexual; promises are explicit', () => {
        expect(p).toMatch(/intimacy — REQUIRED whenever anything sexual or intimate happened/);
        expect(p).toMatch(/wants: ONLY about sex and intimacy/);
        expect(p).toMatch(/ONLY an explicit commitment about the future/);
    });
});

describe('v1.60 — story facts and new games', () => {
    it('new_memories is required in every mode', () => {
        for (const mode of ['NARRATIVE', 'SOCIAL', 'TENSION', 'COMBAT'] as const)
            expect((getResponseSchema(mode as any) as any).required).toContain('new_memories');
    });
    it('the one-time older-save catch-up is the caller\'s decision; openRegisters honours it', () => {
        const seed = [ent('King Osric Drevast', { status: 'distant', ledger: ['Authored seed line.'] })];
        expect(openRegisters(seed, '', '', 1, false).opened).toEqual([]);
    });
});
