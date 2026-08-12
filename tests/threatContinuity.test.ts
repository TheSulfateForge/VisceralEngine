import { describe, it, expect } from 'vitest';
import { processThreatSeeds, validateThreatCausality } from '../utils/engine/threatPipelineCore';
import {
    updateFactionExposure_v112,
    resolveExposureEntry,
    exposureWeightFor,
} from '../utils/engine/factionExposure';
import { EXPOSURE_THRESHOLD_FOR_THREAT } from '../config/engineConfig';
import type { DebugLogEntry, DormantHook, WorldTickEvent } from '../types';

/**
 * v1.28 regression suite.
 *
 * Every case here is drawn from a real 47-turn save in which the Origin Gate
 * rejected ~100% of threats, world.emergingThreats stayed empty for the entire
 * campaign, and the player's twin sister ended up as the single highest-exposure
 * (i.e. most threat-eligible) entity in the world while the actual antagonist
 * sat at 6.
 */

const logs = (): DebugLogEntry[] => [];

const PLAYER = 'Callan Drevast';
const ENTITIES = ['Lord Veyric Blackmoor', 'Lord Nicor Blackmoor', 'Callan Drevast'];
const KNOWN_ENTITIES = [
    { name: 'Lord Veyric Blackmoor', location: 'Merchant District', relationship_level: 'HOSTILE' },
    { name: 'Lord Nicor Blackmoor', location: 'Merchant District', relationship_level: 'HOSTILE' },
];

const seed = (over: Partial<WorldTickEvent> = {}): WorldTickEvent => ({
    description: 'House Blackmoor will mobilise legal and political assets against Callan.',
    turns_until_impact: 3,
    ...over,
});

describe('v1.28 — gate-rejected threats are retained as continuity anchors', () => {
    it('keeps a rejected threat instead of deleting it', () => {
        const out = processThreatSeeds([seed()], [], 10, logs());

        expect(out).toHaveLength(1);
        expect(out[0].status).toBe('unvalidated');
        expect(out[0].gateBlockedReason).toBeTruthy();
        expect(out[0].unvalidatedSinceTurn).toBe(10);
    });

    it('locks the description of a re-submitted anchor so the model cannot re-aim it', () => {
        const debug = logs();
        const first = processThreatSeeds([seed()], [], 10, debug, [], {}, ENTITIES, PLAYER);

        // Next turn the model re-submits the same idea, completely re-worded —
        // the exact "instant pivot" behaviour reported in the save.
        const pivoted = seed({
            description: 'House Blackmoor will leak Callan\'s commoner life to discredit him.',
            turns_until_impact: 3,
        });
        const second = processThreatSeeds([pivoted], first, 11, debug, [], {}, ENTITIES, PLAYER);

        expect(second).toHaveLength(1);
        expect(second[0].description).toBe(first[0].description);
    });

    it('forces the ETA to count down monotonically across turns', () => {
        const debug = logs();
        let state = processThreatSeeds([seed({ turns_until_impact: 5 })], [], 10, debug, [], {}, ENTITIES, PLAYER);
        const etas: number[] = [state[0].turns_until_impact!];

        for (let turn = 11; turn <= 14; turn++) {
            // The model keeps proposing whatever number it likes, including
            // increases. None of it should survive.
            state = processThreatSeeds([seed({ turns_until_impact: 15 })], state, turn, debug, [], {}, ENTITIES, PLAYER);
            if (state.length === 0) break;
            etas.push(state[0].turns_until_impact!);
        }

        for (let i = 1; i < etas.length; i++) {
            expect(etas[i]).toBeLessThan(etas[i - 1]);
        }
    });

    it('never lets an unvalidated anchor reach the player', () => {
        const debug = logs();
        let state = processThreatSeeds([seed({ turns_until_impact: 2 })], [], 10, debug, [], {}, ENTITIES, PLAYER);

        for (let turn = 11; turn <= 16; turn++) {
            state = processThreatSeeds([seed({ turns_until_impact: 1 })], state, turn, debug, [], {}, ENTITIES, PLAYER);
            for (const t of state) {
                expect(t.status).toBe('unvalidated');
                expect(t.status).not.toBe('triggered');
            }
        }
    });

    it('self-expires an anchor that never passes the gate', () => {
        const debug = logs();
        let state = processThreatSeeds([seed({ turns_until_impact: 20 })], [], 1, debug, [], {}, ENTITIES, PLAYER);
        const originalId = state[0].id;

        for (let turn = 2; turn <= 12; turn++) {
            state = processThreatSeeds([seed({ turns_until_impact: 20 })], state, turn, debug, [], {}, ENTITIES, PLAYER);
        }

        // The original anchor must not still be alive 11 turns later. (The model
        // is free to re-raise the idea afterwards — that starts a fresh anchor
        // with a fresh id, which is correct: it is a new attempt, not the old
        // one quietly surviving.)
        expect(state.some(t => t.id === originalId)).toBe(false);
        expect(
            debug.some(l => l.message.includes('[THREAT ANCHOR EXPIRED — v1.28]')),
        ).toBe(true);
    });

    it('does not let a rejected threat auto-pass the gate on its second turn', () => {
        // The gate grandfathers threats created on earlier turns. Without an
        // explicit exclusion, retaining rejects would make the gate trivially
        // bypassable: get rejected once, go live next turn.
        const anchor = seed({
            turnCreated: 9,
            status: 'unvalidated',
            unvalidatedSinceTurn: 9,
            id: 'threat_x',
        });
        expect(validateThreatCausality(anchor, [], {}, 10, logs())).toBe(false);
    });

    it('promotes an anchor once the model supplies a real cause', () => {
        const debug = logs();
        const first = processThreatSeeds([seed()], [], 10, debug, [], {}, ENTITIES, PLAYER);
        expect(first[0].status).toBe('unvalidated');

        const withCause = seed({
            playerActionCause: 'Lord Veyric Blackmoor observed Callan Drevast force a public record of the Blackmoor harassment at Merchant District on turn 9.',
        });
        const second = processThreatSeeds(
            [withCause], first, 11, debug, [], {}, ENTITIES, PLAYER,
            'NARRATIVE', {}, [], [], KNOWN_ENTITIES,
        );

        expect(second[0].status).not.toBe('unvalidated');
        expect(second[0].promotedTurn).toBe(11);
        // Promotion must not resurrect the model's re-wording.
        expect(second[0].description).toBe(first[0].description);
    });
});

describe('v1.28 — Origin Gate accepts real causality it used to reject', () => {
    it('accepts a player-caused threat that names the same actor (Test B shared-actor path)', () => {
        // Real case from the save: rejected at jaccard < 0.10 despite cause and
        // description both being explicitly about the Blackmoors.
        const threat = seed({
            description: 'House Blackmoor will mobilise legal and political assets to mitigate the damage.',
            playerActionCause: 'Lord Veyric Blackmoor observed Callan Drevast force a public record of the Blackmoor harassment at Merchant District on turn 30.',
        });
        const ok = validateThreatCausality(
            threat, [], {}, 31, logs(), ENTITIES, PLAYER,
        );
        expect(ok).toBe(true);
    });

    it('accepts a hook-sourced threat that names one of the hook\'s entities (Test A entity path)', () => {
        const hook: DormantHook = {
            id: 'hook_anwen_secret_exposure',
            summary: "Callan's public persona is a deliberate distraction to shield Anwen's true nature, creating a vulnerability if his own reputation is tarnished.",
            category: 'secret',
            sourceField: 'backstory',
            involvedEntities: ['anwen drevast'],
            activationConditions: 'If Callan is caught in a scandal.',
            status: 'dormant',
        };
        const threat = seed({
            description: 'A palace informant begins asking questions about Anwen.',
            dormantHookId: 'hook_anwen_secret_exposure',
        });
        expect(validateThreatCausality(threat, [hook], {}, 12, logs())).toBe(true);
    });

    it('still rejects a threat with a cause that shares nothing with it', () => {
        const threat = seed({
            description: 'A kraken rises from the eastern sea.',
            playerActionCause: 'Marigold Underhill observed Callan Drevast buy bread at the Merry Hearth on turn 3.',
        });
        expect(
            validateThreatCausality(threat, [], {}, 4, logs(), ['Marigold Underhill'], PLAYER),
        ).toBe(false);
    });
});

describe('v1.28 — faction exposure resolution (Test C key mismatch)', () => {
    it('resolves "House Blackmoor" against exposure keyed by member name', () => {
        const exposure = {
            'Lord Veyric Blackmoor': {
                exposureScore: 40,
                lastObservedAction: null,
                lastObservedTurn: 5,
                observedCapabilities: [],
            },
        };
        const resolved = resolveExposureEntry(exposure, 'House Blackmoor');
        expect(resolved?.key).toBe('Lord Veyric Blackmoor');
        expect(resolved?.entry.exposureScore).toBe(40);

        const threat = seed({ factionSource: 'House Blackmoor' });
        expect(validateThreatCausality(threat, [], exposure, 10, logs())).toBe(true);
    });

    it('does not match unrelated factions', () => {
        const exposure = {
            'Guildmaster Halric Vance': {
                exposureScore: 90,
                lastObservedAction: null,
                lastObservedTurn: 5,
                observedCapabilities: [],
            },
        };
        expect(resolveExposureEntry(exposure, 'House Blackmoor')).toBeNull();
    });

    it('ignores honorifics and "House"/"family" noise when matching', () => {
        expect(
            resolveExposureEntry(
                { 'Duke Corrith Blackmoor': { exposureScore: 25, lastObservedAction: null, lastObservedTurn: 1, observedCapabilities: [] } },
                'the Blackmoor family',
            )?.entry.exposureScore,
        ).toBe(25);
    });
});

describe('v1.28 — exposure is adversarial intelligence, not attention', () => {
    const watching = (name: string) => ({
        npc_name: name,
        action: 'Watches Callan closely across the room.',
        player_visible: true,
    });

    const entities = [
        { name: 'Anwen Drevast', role: 'twin sister', relationship_level: 'DEVOTED' },
        { name: 'Queen Ondine Drevast', role: 'mother', relationship_level: 'WARM' },
        { name: 'Lord Veyric Blackmoor', role: 'rival heir', relationship_level: 'HOSTILE' },
        { name: 'Petra Nester', role: 'watch officer', relationship_level: 'NEUTRAL' },
    ];

    it('grants an ally no exposure for watching the player', () => {
        const out = updateFactionExposure_v112(
            {}, [watching('Anwen Drevast'), watching('Queen Ondine Drevast')], 5, logs(), entities, [],
        );
        expect(out['Anwen Drevast']).toBeUndefined();
        expect(out['Queen Ondine Drevast']).toBeUndefined();
    });

    it('grants a hostile observer full exposure', () => {
        const out = updateFactionExposure_v112(
            {}, [watching('Lord Veyric Blackmoor')], 5, logs(), entities, [],
        );
        expect(out['Lord Veyric Blackmoor'].exposureScore).toBe(15);
    });

    it('keeps antagonists ahead of allies over a long campaign', () => {
        // The reported inversion: the sister shares far more screen time than
        // the antagonist, so under the old unweighted rule she out-scored him
        // 31 to 6 and became the only threat-eligible source in the world.
        let exposure = {};
        for (let turn = 1; turn <= 20; turn++) {
            exposure = updateFactionExposure_v112(
                exposure,
                turn % 4 === 0
                    ? [watching('Anwen Drevast'), watching('Lord Veyric Blackmoor')]
                    : [watching('Anwen Drevast')],
                turn, logs(), entities, [],
            );
        }
        const sister = (exposure as any)['Anwen Drevast']?.exposureScore ?? 0;
        const rival = (exposure as any)['Lord Veyric Blackmoor']?.exposureScore ?? 0;

        expect(sister).toBe(0);
        expect(rival).toBeGreaterThan(sister);
        expect(sister).toBeLessThan(EXPOSURE_THRESHOLD_FOR_THREAT);
    });

    it('weights neutral observers below hostile ones', () => {
        expect(exposureWeightFor('HOSTILE')).toBeGreaterThan(exposureWeightFor('NEUTRAL'));
        expect(exposureWeightFor('NEUTRAL')).toBeGreaterThan(exposureWeightFor('DEVOTED'));
        expect(exposureWeightFor('DEVOTED')).toBe(0);
    });
});
