import { describe, it, expect } from 'vitest';
import { sceneContinuityStep } from '../utils/pipeline/steps/17-sceneContinuity';
import { DEFAULT_PIPELINE, buildPipeline } from '../utils/pipeline/pipelineConfig';
import type { TurnContext } from '../utils/pipeline/types';
import type { GameWorld, Character, DebugLogEntry, ModelResponseSchema, TimeMode } from '../types';

const world = (over: Partial<GameWorld> = {}): GameWorld => ({
    location: 'Thornhale hallway',
    sceneMode: 'SOCIAL',
    tensionLevel: 10,
    time: { totalMinutes: 620, display: 'Day 2, 10:19' },
    knownEntities: [{ id: 'e1', name: 'Brenna Torrold', role: 'daughter', status: 'present' }],
    emergingThreats: [],
    ...over,
} as unknown as GameWorld);

const response = (over: Partial<ModelResponseSchema> = {}): ModelResponseSchema => ({
    narrative: 'Brenna nods.',
    thought_process: '',
    scene_mode: 'SOCIAL',
    tension_level: 10,
    world_tick: {
        npc_actions: [{
            npc_name: 'Brenna Torrold',
            action: 'Offering to stitch cured-goat under-shifts and take Codi to the workshop.',
            player_visible: true,
        }],
        environment_changes: [],
        emerging_threats: [],
    },
    ...over,
} as unknown as ModelResponseSchema);

const ctxFor = (
    previousWorld: GameWorld,
    nextWorld: GameWorld,
    resp: ModelResponseSchema,
    turn = 18,
): TurnContext => ({
    currentTurn: turn,
    previousWorld,
    worldUpdate: { ...nextWorld },
    characterUpdate: { name: 'Codi Whitmore', conditions: ['Virgin'] } as unknown as Character,
    previousCharacter: { name: 'Codi Whitmore', conditions: ['Virgin'] } as unknown as Character,
    sanitisedResponse: resp,
    validatedThreats: [],
    debugLogs: [] as DebugLogEntry[],
} as unknown as TurnContext);

const messages = (ctx: TurnContext) => ctx.debugLogs.map(l => l.message).join('\n');

describe('sceneContinuityStep', () => {
    it('is registered LAST in the default pipeline', () => {
        // Ordering is load-bearing: it snapshots final state, and location /
        // sceneMode only settle in step 12, conditions in 13, skills in 15-16.
        expect(DEFAULT_PIPELINE[DEFAULT_PIPELINE.length - 1].name).toBe('17-sceneContinuity');
    });

    it('runs in every time_mode — it is pure bookkeeping', () => {
        const modes: TimeMode[] = ['TICK', 'SCENE', 'ACTIVITY', 'REST', 'MONTAGE'];
        for (const mode of modes) {
            expect(buildPipeline(mode).some(s => s.name === '17-sceneContinuity'), mode).toBe(true);
        }
    });

    it('writes ledger, canon and digest onto worldUpdate', () => {
        const ctx = sceneContinuityStep.execute(ctxFor(
            world(),
            world(),
            response({ player_assertions: ['Armor maintains body temperature when deployed.'] }),
        ));
        expect(ctx.worldUpdate.sceneLedger).toHaveLength(1);
        expect(ctx.worldUpdate.playerCanon).toHaveLength(1);
        expect(ctx.worldUpdate.lastTurnDigest?.turn).toBe(18);
        expect(ctx.worldUpdate.lastTurnDigest?.location).toBe('Thornhale hallway');
    });

    it('does not re-record the same beat on the next turn', () => {
        const first = sceneContinuityStep.execute(ctxFor(world(), world(), response()));
        const second = sceneContinuityStep.execute(ctxFor(
            world({ sceneLedger: first.worldUpdate.sceneLedger }),
            world({ sceneLedger: first.worldUpdate.sceneLedger }),
            response(),   // turn 18 re-emitted the same offer
            19,
        ));
        expect(second.worldUpdate.sceneLedger).toHaveLength(1);
    });

    it('clears the ledger and says so when the scene changes', () => {
        const first = sceneContinuityStep.execute(ctxFor(world(), world(), response()));
        const moved = sceneContinuityStep.execute(ctxFor(
            world({ sceneLedger: first.worldUpdate.sceneLedger }),
            world({ sceneLedger: first.worldUpdate.sceneLedger, location: 'Thornhale workshop' }),
            response({ world_tick: { npc_actions: [], environment_changes: [], emerging_threats: [] } }),
            19,
        ));
        expect(moved.worldUpdate.sceneLedger).toHaveLength(0);
        expect(messages(moved)).toContain('ledger cleared');
    });

    it('logs accepted and rejected player assertions distinctly', () => {
        const ctx = sceneContinuityStep.execute(ctxFor(world(), world(), response({
            player_assertions: [
                'Armor maintains body temperature when deployed.',
                'Brenna secretly plans to sell me.',
            ],
        })));
        expect(messages(ctx)).toContain('[PLAYER CANON] Recorded:');
        expect(messages(ctx)).toContain('REJECTED');
        expect(ctx.worldUpdate.playerCanon).toHaveLength(1);
    });

    it('never touches narrative, threats, time or conditions', () => {
        const before = world();
        const ctx = sceneContinuityStep.execute(ctxFor(before, world(), response()));
        expect(ctx.worldUpdate.time).toEqual(before.time);
        expect(ctx.worldUpdate.emergingThreats).toEqual([]);
        expect(ctx.worldUpdate.tensionLevel).toBe(10);
        expect(ctx.characterUpdate.conditions).toEqual(['Virgin']);
        expect(ctx.sanitisedResponse.narrative).toBe('Brenna nods.');
    });

    it('is safe on a response carrying neither new field', () => {
        const ctx = sceneContinuityStep.execute(ctxFor(world(), world(), response({
            world_tick: { npc_actions: [], environment_changes: [], emerging_threats: [] },
        })));
        expect(ctx.worldUpdate.sceneLedger).toEqual([]);
        expect(ctx.worldUpdate.playerCanon).toEqual([]);
        expect(ctx.worldUpdate.lastTurnDigest).toBeDefined();
    });
});
