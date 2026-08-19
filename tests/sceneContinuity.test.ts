import { describe, it, expect } from 'vitest';
import {
    sceneChanged,
    updateSceneLedger,
    buildSceneLedgerBlock,
    ingestPlayerAssertions,
    buildPlayerCanonBlock,
    buildTurnDigest,
    buildSinceLastTurnBlock,
    SCENE_LEDGER_MAX,
    PLAYER_CANON_MAX,
} from '../utils/engine/sceneContinuity';
import type { GameWorld, Character, WorldTickAction, TurnDigest } from '../types';

// ---------------------------------------------------------------------------
// v1.31 regression suite.
//
// Fixtures come from the Codi Whitmore save (2026-08-19), where turn 18
// reproduced turn 17's middle and closing paragraph — re-offering the
// cured-goat under-shifts and re-proposing the trip to the workshop, and
// re-saying "it'll keep you from freezing" one turn AFTER the player stated
// the armor keeps her warm.
// ---------------------------------------------------------------------------

const npcAction = (npc_name: string, action: string, player_visible = true): WorldTickAction =>
    ({ npc_name, action, player_visible });

// The actual npc_action from turn 17 of the save.
const BRENNA_T17 = npcAction(
    'Brenna Torrold',
    'Offering to help Codi solve her clothing issues by suggesting custom-stitched leather undergarments and preparing to take her to the workshop.',
);
const MAEVIS_OFFSCREEN = npcAction(
    'Maevis Torrold',
    'Waiting in the main hall with the morning meal, periodically checking the dose-case ledger.',
    false,
);

let seq = 0;
const ids = () => `id_${seq++}`;

describe('sceneChanged', () => {
    it('is false when location and mode both hold', () => {
        expect(sceneChanged('Thornhale hallway', 'Thornhale hallway', 'SOCIAL', 'SOCIAL')).toBe(false);
    });
    it('is true on a location change', () => {
        expect(sceneChanged('Thornhale hallway', 'Thornhale workshop', 'SOCIAL', 'SOCIAL')).toBe(true);
    });
    it('is true on a scene-mode change', () => {
        expect(sceneChanged('Thornhale hallway', 'Thornhale hallway', 'SOCIAL', 'COMBAT')).toBe(true);
    });
    it('treats undefined as empty rather than throwing', () => {
        expect(sceneChanged(undefined, undefined, undefined, undefined)).toBe(false);
        expect(sceneChanged(undefined, 'somewhere', undefined, undefined)).toBe(true);
    });
});

describe('updateSceneLedger', () => {
    it('records player-visible npc actions and ignores offscreen ones', () => {
        const r = updateSceneLedger([], [BRENNA_T17, MAEVIS_OFFSCREEN], undefined, 17, false, ids);
        expect(r.added).toBe(1);
        expect(r.ledger).toHaveLength(1);
        expect(r.ledger[0].beat).toContain('Brenna Torrold');
        expect(r.ledger[0].source).toBe('npc');
    });

    it('records model-declared `established` clauses', () => {
        const r = updateSceneLedger([], [], ['Codi\'s collar confirmed non-removable by hand'], 17, false, ids);
        expect(r.added).toBe(1);
        expect(r.ledger[0].source).toBe('model');
    });

    it('caps model-declared clauses at 2 per turn so it cannot flood the block', () => {
        const r = updateSceneLedger([], [], ['one', 'two', 'three', 'four'], 5, false, ids);
        expect(r.added).toBe(2);
    });

    it('does not re-record a beat it already holds — the whole point', () => {
        const first = updateSceneLedger([], [BRENNA_T17], undefined, 17, false, ids);
        // Turn 18 re-emitted a near-identical npc_action for the same offer.
        const repeat = npcAction(
            'Brenna Torrold',
            'Offering to help Codi solve her clothing issues by suggesting custom-stitched leather undergarments and preparing to take her to the workshop.',
        );
        const second = updateSceneLedger(first.ledger, [repeat], undefined, 18, false, ids);
        expect(second.added).toBe(0);
        expect(second.ledger).toHaveLength(1);
    });

    it('clears the ledger when the scene turns over', () => {
        const first = updateSceneLedger([], [BRENNA_T17], undefined, 17, false, ids);
        const moved = updateSceneLedger(first.ledger, [npcAction('Brenna Torrold', 'Laying out leather at the bench.')], undefined, 19, true, ids);
        expect(moved.reset).toBe(true);
        expect(moved.ledger).toHaveLength(1);
        expect(moved.ledger[0].beat).toContain('bench');
    });

    it('FIFO-caps at SCENE_LEDGER_MAX', () => {
        let ledger = updateSceneLedger([], [], undefined, 0, false, ids).ledger;
        for (let i = 0; i < SCENE_LEDGER_MAX + 6; i++) {
            ledger = updateSceneLedger(ledger, [npcAction('NPC', `does distinct thing number ${i}`)], undefined, i, false, ids).ledger;
        }
        expect(ledger).toHaveLength(SCENE_LEDGER_MAX);
        // Oldest dropped, newest kept.
        expect(ledger[ledger.length - 1].beat).toContain(`number ${SCENE_LEDGER_MAX + 5}`);
    });

    it('is total on missing inputs', () => {
        expect(updateSceneLedger(undefined, undefined, undefined, 1, false, ids).ledger).toEqual([]);
    });
});

describe('buildSceneLedgerBlock', () => {
    it('is empty when there is nothing to say', () => {
        expect(buildSceneLedgerBlock([])).toBe('');
        expect(buildSceneLedgerBlock(undefined)).toBe('');
    });
    it('tells the model the ground is covered and to advance instead', () => {
        const { ledger } = updateSceneLedger([], [BRENNA_T17], undefined, 17, false, ids);
        const block = buildSceneLedgerBlock(ledger);
        expect(block).toContain('SCENE LEDGER');
        expect(block).toContain('COVERED');
        expect(block).toContain('ADVANCE');
        expect(block).toContain('workshop');
    });
});

describe('ingestPlayerAssertions', () => {
    it('records a fact about the player\'s own gear', () => {
        const r = ingestPlayerAssertions([], ['Armor maintains body temperature when deployed.'], 18, false, ids);
        expect(r.accepted).toHaveLength(1);
        expect(r.canon[0].fact).toContain('body temperature');
        expect(r.canon[0].turnAsserted).toBe(18);
        expect(r.canon[0].viaOoc).toBe(false);
    });

    it('flags OOC-sourced assertions', () => {
        const r = ingestPlayerAssertions([], ['Armor is self-repairing.'], 18, true, ids);
        expect(r.canon[0].viaOoc).toBe(true);
    });

    it('rejects claims about NPC interiority', () => {
        const r = ingestPlayerAssertions([], ['Brenna secretly wants to betray the steading.'], 18, false, ids);
        expect(r.accepted).toHaveLength(0);
        expect(r.rejected).toHaveLength(1);
    });

    it('rejects claims about world state', () => {
        const r = ingestPlayerAssertions([], ['The kingdom is at peace and no one is hunting me.'], 18, false, ids);
        expect(r.rejected).toHaveLength(1);
    });

    it('rejects a blanket threat dismissal', () => {
        const r = ingestPlayerAssertions([], ['There are no threats in this region.'], 18, false, ids);
        expect(r.rejected).toHaveLength(1);
    });

    it('rejects mind-reading with a proper-noun subject and no adverb', () => {
        expect(ingestPlayerAssertions([], ['Brenna trusts me completely.'], 18, false, ids).rejected).toHaveLength(1);
        expect(ingestPlayerAssertions([], ['She is actually a spy.'], 18, false, ids).rejected).toHaveLength(1);
    });

    it('still accepts first-person statements about the player themselves', () => {
        // The scope filter must not swallow the channel's whole purpose. "I
        // think / I want / my X" is the player talking about their own
        // character and is always in scope.
        for (const fact of [
            'I can wind-run without difficulty.',
            'My armor is self-repairing within a day.',
            'Armor maintains body temperature over the whole body when deployed.',
            'The collar cannot be removed by hand.',
        ]) {
            const r = ingestPlayerAssertions([], [fact], 18, false, ids);
            expect(r.accepted, fact).toHaveLength(1);
        }
    });

    it('does not duplicate a fact already in canon', () => {
        const first = ingestPlayerAssertions([], ['Armor maintains body temperature when deployed.'], 18, false, ids);
        const second = ingestPlayerAssertions(first.canon, ['Armor maintains body temperature when deployed'], 19, false, ids);
        expect(second.accepted).toHaveLength(0);
        expect(second.canon).toHaveLength(1);
    });

    it('caps at PLAYER_CANON_MAX', () => {
        let canon = ingestPlayerAssertions([], [], 0, false, ids).canon;
        for (let i = 0; i < PLAYER_CANON_MAX + 5; i++) {
            canon = ingestPlayerAssertions(canon, [`Distinct personal fact number ${i}`], i, false, ids).canon;
        }
        expect(canon).toHaveLength(PLAYER_CANON_MAX);
    });

    it('is total on missing inputs', () => {
        expect(ingestPlayerAssertions(undefined, undefined, 1, false, ids).canon).toEqual([]);
    });
});

describe('buildPlayerCanonBlock', () => {
    it('states the facts as binding', () => {
        const { canon } = ingestPlayerAssertions([], ['Armor maintains body temperature when deployed.'], 18, false, ids);
        const block = buildPlayerCanonBlock(canon);
        expect(block).toContain('PLAYER CANON');
        expect(block).toContain('binding');
        expect(block).toContain('body temperature');
    });
    it('is empty when there is no canon', () => {
        expect(buildPlayerCanonBlock([])).toBe('');
    });
});

// ---------------------------------------------------------------------------

const world = (over: Partial<GameWorld> = {}): GameWorld => ({
    location: 'Thornhale hallway',
    sceneMode: 'SOCIAL',
    tensionLevel: 10,
    time: { totalMinutes: 620, display: 'Year 1, Month 1, Day 2, 10:19' },
    knownEntities: [
        { id: 'e1', name: 'Brenna Torrold', role: 'steading daughter', status: 'present' },
        { id: 'e2', name: 'Maevis Torrold', role: 'matron', status: 'nearby' },
    ],
    emergingThreats: [],
    ...over,
} as unknown as GameWorld);

const character = (over: Partial<Character> = {}): Character =>
    ({ name: 'Codi Whitmore', conditions: ['Virgin', 'Rested'], ...over } as unknown as Character);

describe('buildTurnDigest', () => {
    it('snapshots the volatile state', () => {
        const d = buildTurnDigest(world(), character(), 18);
        expect(d.turn).toBe(18);
        expect(d.location).toBe('Thornhale hallway');
        expect(d.presentEntities).toEqual(['Brenna Torrold', 'Maevis Torrold']);
        expect(d.conditionCount).toBe(2);
    });
});

describe('buildSinceLastTurnBlock', () => {
    it('is empty on the very first turn, when there is nothing to diff', () => {
        expect(buildSinceLastTurnBlock(undefined, world(), character())).toBe('');
    });

    it('states plainly that NOTHING changed — the case that drives repetition', () => {
        // This is turn 17 → 18 of the reviewed save: same room, same people,
        // same clock reading at prompt-build time, player input was a
        // clarification. Old behaviour: the model saw an identical snapshot and
        // produced a near-identical turn.
        const digest = buildTurnDigest(world(), character(), 17);
        const block = buildSinceLastTurnBlock(digest, world(), character());
        expect(block).toContain('NOTHING IN THE WORLD STATE CHANGED');
        expect(block).toContain('Do not restate');
        expect(block).toContain('Something must be different');
    });

    it('reports a clock advance', () => {
        const digest = buildTurnDigest(world(), character(), 17);
        const next = world({ time: { totalMinutes: 625, display: 'Day 2, 10:24' } as GameWorld['time'] });
        const block = buildSinceLastTurnBlock(digest, next, character());
        expect(block).toContain('+5min');
        expect(block).not.toContain('NOTHING IN THE WORLD STATE CHANGED');
    });

    it('formats multi-hour advances readably', () => {
        const digest = buildTurnDigest(world(), character(), 17);
        const next = world({ time: { totalMinutes: 620 + 150, display: 'Day 2, 12:49' } as GameWorld['time'] });
        expect(buildSinceLastTurnBlock(digest, next, character())).toContain('+2h30m');
    });

    it('reports location, arrivals and departures', () => {
        const digest = buildTurnDigest(world(), character(), 17);
        const next = world({
            location: 'Thornhale workshop',
            knownEntities: [
                { id: 'e1', name: 'Brenna Torrold', role: 'steading daughter', status: 'present' },
                { id: 'e3', name: 'Old Torrold', role: 'elder', status: 'present' },
            ],
        } as Partial<GameWorld>);
        const block = buildSinceLastTurnBlock(digest, next, character());
        expect(block).toContain('Thornhale hallway → Thornhale workshop');
        expect(block).toContain('Arrived: Old Torrold');
        expect(block).toContain('No longer present: Maevis Torrold');
    });

    it('surfaces facts the player established, by name', () => {
        const digest = buildTurnDigest(world(), character(), 17);
        const block = buildSinceLastTurnBlock(digest, world(), character(), [
            'Armor maintains body temperature when deployed.',
        ]);
        expect(block).toContain('Player established: Armor maintains body temperature');
        expect(block).not.toContain('NOTHING IN THE WORLD STATE CHANGED');
    });

    it('reports tension and threat movement', () => {
        const digest: TurnDigest = buildTurnDigest(world(), character(), 17);
        const next = world({
            tensionLevel: 55,
            emergingThreats: [{ description: 'x', status: 'building' }] as GameWorld['emergingThreats'],
        });
        const block = buildSinceLastTurnBlock(digest, next, character());
        expect(block).toContain('Tension: 10 → 55');
        expect(block).toContain('Live threats: 0 → 1');
    });

    it('ignores unvalidated threat anchors in the count', () => {
        const digest = buildTurnDigest(world(), character(), 17);
        const next = world({
            emergingThreats: [{ description: 'x', status: 'unvalidated' }] as GameWorld['emergingThreats'],
        });
        expect(buildSinceLastTurnBlock(digest, next, character())).toContain('NOTHING IN THE WORLD STATE CHANGED');
    });
});
