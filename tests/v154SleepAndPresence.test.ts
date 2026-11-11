import { describe, it, expect } from 'vitest';
import { isSleepDeclaration, inferSleep, applySleepInference } from '../utils/engine/sleepInference';
import { timeProgressionStep } from '../utils/pipeline/steps/02-timeProgression';
import { deriveWorldTime, estimateTimeFloor } from '../utils/engine/timeUtils';
import { directivesAreSame } from '../utils/engine/sceneContinuity';
import { demoteRemoteNearby, applyStatusTransitions } from '../utils/engine/entityLifecycle';
import { inferRoomMove, inferLocationMove } from '../utils/engine/locationGraph';
import { GeminiClient } from '../services/geminiClient';
import type { KnownEntity, LocationGraph } from '../types';

// 2026-11-11 Westcross save, turn 56 (DeepSeek V4.1 Flash via OpenRouter).
const SLEEP_INPUT = 'I go to sleep and then I wake up.';
const SLEEP_NARRATIVE =
    'I put the lamp out and lay down and the room went dark. I went under without meaning to. One minute I was counting the ticks in the wall and the next the room was grey and the garden window was full of light and the birds were at it in the wall. ' +
    'I woke the way I always wake — flat on my back, hands where I left them, no one in the room. The light coming in was the flat early kind, before the sun is properly up.';
const START = 19 * 60 + 43; // 19:43, Day 1

const logs = () => [] as any[];
const log = (l: any[]) => l.map(x => x.message).join('\n');

describe('v1.54 — sleep declared by the player', () => {
    it('recognises first-person sleep', () => {
        for (const s of [SLEEP_INPUT, 'I turn in for the night.', 'Exhausted, I fall asleep in the chair.', 'I lie down for the night and sleep.', 'We bed down by the fire.'])
            expect(isSleepDeclaration(s), s).toBe(true);
    });

    it('ignores other sleepers, negations and OOC', () => {
        for (const s of ['I tell Liora to sleep well.', 'I let her sleep.', 'I watch them doze off.', "I can't sleep, so I get up.", 'Liora is asleep down the hall.', '[OOC: I am going to go to sleep.', 'I check the bed for bugs.'])
            expect(isSleepDeclaration(s), s).toBe(false);
    });

    it('the reported turn: no sleep_hours, +0m → a full night, waking at first light (cap 9h)', () => {
        const inf = inferSleep({ narrative: SLEEP_NARRATIVE, scene_mode: 'NARRATIVE', time_passed_minutes: 0 }, SLEEP_INPUT, START);
        expect(inf).not.toBeNull();
        expect(inf!.minutes).toBe(540);
        expect(inf!.reason).toMatch(/first light/);
    });

    it('wakes at the time the player names', () => {
        const inf = inferSleep({ narrative: 'I slept.', scene_mode: 'NARRATIVE' }, 'I go to bed and sleep in until late morning.', 23 * 60);
        expect(inf!.minutes).toBe(540); // 23:00 → 10:00 is 11h, capped
        const early = inferSleep({ narrative: 'I woke.', scene_mode: 'NARRATIVE' }, 'I go to sleep and wake before dawn.', 22 * 60);
        expect(early!.minutes).toBe(6 * 60 + 45); // 22:00 → 04:45
    });

    it('uses the model phase tag when the prose names no hour', () => {
        const inf = inferSleep({ narrative: 'I slept and woke.', scene_mode: 'NARRATIVE', scene_time_phase: 'dawn' }, SLEEP_INPUT, 22 * 60);
        expect(inf!.minutes).toBe(8 * 60 + 15);
    });

    it('a nap is short', () => {
        const inf = inferSleep({ narrative: 'I dozed and woke.', scene_mode: 'NARRATIVE' }, 'I take a nap.', 14 * 60);
        expect(inf!.minutes).toBe(90);
    });

    it('leaves the model alone when it reported sleep, or the night turned into a fight', () => {
        expect(inferSleep({ narrative: SLEEP_NARRATIVE, scene_mode: 'NARRATIVE', biological_inputs: { sleep_hours: 7 } }, SLEEP_INPUT, START)).toBeNull();
        expect(inferSleep({ narrative: SLEEP_NARRATIVE, scene_mode: 'COMBAT' }, SLEEP_INPUT, START)).toBeNull();
        expect(inferSleep({ narrative: 'I stare at the ceiling.', scene_mode: 'NARRATIVE' }, SLEEP_INPUT, START)).toBeNull();
    });

    it('applySleepInference marks the turn REST and is idempotent', () => {
        const r: any = { narrative: SLEEP_NARRATIVE, scene_mode: 'NARRATIVE', time_passed_minutes: 0 };
        expect(applySleepInference(r, SLEEP_INPUT, START)).toMatch(/SLEEP — v1.54/);
        expect(r.time_mode).toBe('REST');
        expect(r.biological_inputs.sleep_hours).toBe(9);
        expect(applySleepInference(r, SLEEP_INPUT, START)).toBeNull();
    });

    it('time step: sleep_hours with time_passed 0 advances by the hours slept', () => {
        const ctx: any = {
            sanitisedResponse: { narrative: 'I slept.', scene_mode: 'NARRATIVE', time_passed_minutes: 0, biological_inputs: { sleep_hours: 8 } },
            playerInput: 'I sleep.',
            previousWorld: { time: deriveWorldTime(START), location: 'Westcross Townhouse — Bedroom' },
            worldUpdate: {},
            debugLogs: [],
            effectiveTimeMode: 'REST',
        };
        const out = timeProgressionStep.execute(ctx) as any;
        expect(out.newTime.totalMinutes - START).toBe(480);
    });
});

describe('v1.54 — validateResponse keeps time_mode, scene_time_phase, faction_updates', () => {
    class Probe extends GeminiClient { check(d: unknown) { return this.validateResponse(d); } }
    const probe = Object.create(Probe.prototype) as Probe;
    const base = { narrative: 'x', thought_process: '', scene_mode: 'NARRATIVE', tension_level: 5 };

    it('passes them through, validated', () => {
        const r = probe.check({ ...base, time_mode: 'REST', scene_time_phase: 'dawn', faction_updates: [{ faction_name: 'House Calder', influence_delta: 2 }, { faction_name: '' }] });
        expect(r.time_mode).toBe('REST');
        expect(r.scene_time_phase).toBe('dawn');
        expect(r.faction_updates).toEqual([{ faction_name: 'House Calder', influence_delta: 2 }]);
    });

    it('drops junk enums, and MONTAGE without a montage_block', () => {
        const r = probe.check({ ...base, time_mode: 'MONTAGE', scene_time_phase: 'teatime' });
        expect(r.time_mode).toBeUndefined();
        expect(r.scene_time_phase).toBeUndefined();
    });
});

describe('v1.54 — directives about different people are not the same directive', () => {
    const LYS = 'Do not reference or draw on Lyssara of the Long Branch or her records unless she actually appears in the fiction.';
    const LIORA = "Portray Liora Calder from her personality record, not from scene momentum: keep both halves of her Actual Core live — the vigilant, ambitious half as well as the submissive half — and treat the submissive half as something she has never said out loud to anyone, so it surfaces in behavior, hesitation and indirection. She listens more than she talks in unfamiliar company and asks real questions rather than volunteering about herself.";
    const LYS_LONG = 'Portray Lyssara of the Long Branch strictly per her personality record: unfailingly polite, never directly insulting, never combative or demanding toward the player; she answers at her own pace.';

    it('Liora does not replace the Lyssara rule (turn 54)', () => {
        expect(directivesAreSame(LYS, LIORA)).toBe(false);
    });
    it('two rules about the same person still merge', () => {
        expect(directivesAreSame(LYS_LONG, LYS)).toBe(true);
    });
});

describe('v1.54 — presence', () => {
    const GRAPH = {
        nodes: {
            sablebrook_manor: { id: 'sablebrook_manor', displayName: 'Sablebrook Manor' },
            twt: { id: 'twt', displayName: 'The Westcross Townhouse' },
            twt_bath: { id: 'twt_bath', displayName: 'Westcross Townhouse — Second Floor Bath' },
            twt_kitchen: { id: 'twt_kitchen', displayName: 'Westcross Townhouse — Kitchen' },
        },
        edges: [], playerLocationId: 'twt_bath',
    } as unknown as LocationGraph;
    const ent = (name: string, status: any, location: string): KnownEntity =>
        ({ id: name, name, role: 'x', location, impression: '', relationship_level: 'WARM', leverage: '', ledger: [], status, lastSeenTurn: 56 } as any);

    it('an NPC at another known place is DISTANT, not nearby (Mirabel at Sablebrook)', () => {
        const l = logs();
        const out = demoteRemoteNearby([
            ent('Lady Mirabel Calder', 'nearby', 'Sablebrook Manor'),
            ent('Liora Calder', 'nearby', 'Westcross Townhouse — Kitchen'),
            ent('Miri', 'nearby', 'Solarium'),
        ], GRAPH, 'Westcross Townhouse — Second Floor Bath', 56, l);
        expect(out.map(e => e.status)).toEqual(['distant', 'nearby', 'nearby']);
        expect(log(l)).toMatch(/Mirabel.*DISTANT/);
    });

    it('someone at a known place does not decay to MISSING', () => {
        const l = logs();
        const out = applyStatusTransitions([
            { ...ent('Lyssara of the Long Branch', 'distant', 'Caerveld (Diplomatic Quarter)'), lastSeenTurn: 1 },
            { ...ent('Nobody', 'distant', ''), lastSeenTurn: 1 },
        ], 100, 'Westcross Townhouse', 'Westcross Townhouse', [], l);
        expect(out.map(e => e.status)).toEqual(['distant', 'missing']);
    });
});

describe('v1.54 — moving between rooms', () => {
    const places = ['The Westcross Townhouse', 'Westcross Townhouse — Second Floor Bath', 'Westcross Townhouse — Kitchen', 'Caerveld'];
    const BATH = 'Westcross Townhouse — Second Floor Bath';

    it('the reported input: bath → bedroom', () => {
        const m = inferRoomMove(places, "I don't say anything as she goes I return to washing myself when done I stand dry off and return to my bedroom closing the door", BATH);
        expect(m?.location_name).toBe('Westcross Townhouse — Bedroom');
        expect(m?.travelled).toBe(false);
    });

    it('reuses a known room', () => {
        expect(inferRoomMove(places, 'I head down to the kitchen.', BATH)?.location_name).toBe('Westcross Townhouse — Kitchen');
    });

    it('not a move: her room, the window, a city, or the room I am in', () => {
        expect(inferRoomMove(places, 'I go to her room.', BATH)).toBeNull();
        expect(inferRoomMove(places, 'I go to the window.', BATH)).toBeNull();
        expect(inferRoomMove(places, 'I go back to my room.', 'Caerveld')).toBeNull();
        expect(inferRoomMove(places, 'I step into the bath.', BATH)).toBeNull();
    });

    it('a room move is not a trip (no 15m travel floor)', () => {
        const { floor } = estimateTimeFloor('I closed the door.', 'I go to my bedroom.', { location_name: 'Westcross Townhouse — Bedroom' }, BATH);
        expect(floor).toBeLessThan(15);
    });

    it('inferLocationMove reaches it', () => {
        const graph = { nodes: Object.fromEntries(places.map((p, i) => [String(i), { id: String(i), displayName: p }])), edges: [], playerLocationId: '1' } as unknown as LocationGraph;
        expect(inferLocationMove(graph, '', 'I go up to my bedroom.', BATH)?.location_name).toBe('Westcross Townhouse — Bedroom');
    });
});

import { checkRestatement } from '../utils/engine/voiceLockCheck';
describe('v1.54 — voice lock and absent NPCs', () => {
    it('"off-scene this turn" is not an invented trait', () => {
        const e: any = { name: 'Liora Calder', role: 'Noble heir', personality: 'Performed Surface: curious, polite.\nActual Core: vigilant; wants to fight.' };
        expect(checkRestatement({ name: 'Liora Calder', traits: ['off-scene this turn', 'so nothing to render'] } as any, e)).toBeNull();
        expect(checkRestatement({ name: 'Liora Calder', traits: ['flirtatious', 'off-scene'] } as any, e)).not.toBeNull();
    });
});
