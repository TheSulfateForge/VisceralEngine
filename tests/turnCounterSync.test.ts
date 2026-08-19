import { describe, it, expect } from 'vitest';
import { sceneModeBargainStep } from '../utils/pipeline/steps/11-sceneModeBargain';
import { commitMontageProposal } from '../utils/montageSystem';
import type { TurnContext } from '../utils/pipeline/types';
import type { GameWorld, Character, MontageProposal, DebugLogEntry } from '../types';

// ---------------------------------------------------------------------------
// v1.30 regression suite — turn counter desync.
//
// The engine carries two turn counters:
//   gameHistory.turnCount — authoritative; ctx.currentTurn is derived from it
//   gameWorld.turnCount   — used to be self-incremented inside the pipeline
//
// Any path that advanced one without the other desynced them permanently.
// Montage was such a path: acceptMontage appended a model message and bumped
// gameHistory.turnCount, while commitMontageProposal never touched the world
// counter. Observed in the Codi Whitmore save (2026-08-19): after one montage,
// every subsequent turn logged "[TURN INCREMENT] Turn 19 → Next turn will be
// 18", and history.turnCount ended at 19 against world.turnCount 18.
//
// Everything keyed on the world counter (hook rate-limit gaps, hookNudge
// cadence, worldPulse cadence, threat cooldowns, the bargain clock) was
// therefore computing off a number one behind the real turn.
// ---------------------------------------------------------------------------

const world = (over: Partial<GameWorld> = {}): GameWorld => ({
    turnCount: 0,
    knownEntities: [],
    emergingThreats: [],
    lastBargainTurn: -1000,
    memory: [],
    time: { totalMinutes: 600, display: 'Year 1, Month 1, Day 1, 10:00' },
    ...over,
} as unknown as GameWorld);

const ctxFor = (currentTurn: number, previousWorldTurn: number): TurnContext => ({
    currentTurn,
    previousWorld: world({ turnCount: previousWorldTurn }),
    worldUpdate: world({ turnCount: previousWorldTurn }),
    sanitisedResponse: {} as TurnContext['sanitisedResponse'],
    effectiveSceneMode: 'SOCIAL',
    tensionLevel: 10,
    debugLogs: [] as DebugLogEntry[],
} as unknown as TurnContext);

const messages = (ctx: TurnContext): string => ctx.debugLogs.map(l => l.message).join('\n');

describe('sceneModeBargainStep — world turn counter', () => {
    it('mirrors the authoritative turn rather than self-incrementing', () => {
        const ctx = sceneModeBargainStep.execute(ctxFor(14, 13));
        expect(ctx.worldUpdate.turnCount).toBe(14);
    });

    it('logs a plain increment and no desync warning on a healthy turn', () => {
        const ctx = sceneModeBargainStep.execute(ctxFor(14, 13));
        expect(messages(ctx)).toContain('[TURN INCREMENT] World turn 13 → 14');
        expect(messages(ctx)).not.toContain('TURN DESYNC HEALED');
    });

    it('heals an existing desync instead of compounding it', () => {
        // The exact numbers from the reviewed save: the world counter sat one
        // behind after a montage. Old behaviour produced 19 here (18 + 1) and
        // stayed one behind forever.
        const ctx = sceneModeBargainStep.execute(ctxFor(20, 18));
        expect(ctx.worldUpdate.turnCount).toBe(20);
        expect(messages(ctx)).toContain('TURN DESYNC HEALED');
        expect(messages(ctx)).toContain('was 18');
        expect(messages(ctx)).toContain('authoritative turn is 20');
    });

    it('converges in a single turn from an arbitrarily large drift', () => {
        const ctx = sceneModeBargainStep.execute(ctxFor(40, 12));
        expect(ctx.worldUpdate.turnCount).toBe(40);
    });

    it('stays aligned across a run of consecutive turns', () => {
        let worldTurn = 0;
        for (let historyTurn = 1; historyTurn <= 10; historyTurn++) {
            const ctx = sceneModeBargainStep.execute(ctxFor(historyTurn, worldTurn));
            worldTurn = ctx.worldUpdate.turnCount;
            expect(worldTurn).toBe(historyTurn);
        }
    });
});

const proposal = (over: Partial<MontageProposal> = {}): MontageProposal => ({
    id: 'mp_1',
    campaignId: 'save_1',
    createdTurn: 13,
    declaredAction: 'rest',
    type: 'REST',
    durationMinutes: 480,
    ageIncrementYears: 0,
    narrative: 'She sleeps.',
    memories: [],
    traumas: [],
    skillUpdates: [],
    npcDeltas: [],
    regenerateCount: 0,
    status: 'pending',
    ...over,
} as unknown as MontageProposal);

const character = (): Character => ({
    name: 'Codi Whitmore',
    conditions: [],
    skills: [],
    goals: [],
    trauma: 0,
    age: 20,
} as unknown as Character);

describe('commitMontageProposal — world turn counter', () => {
    it('advances the world counter to the turn the montage becomes', () => {
        // acceptMontage passes gameHistory.turnCount + 1 and then writes the
        // same value to gameHistory.turnCount, so the two must agree.
        const r = commitMontageProposal(proposal(), character(), world({ turnCount: 13 }), 14);
        expect(r.world.turnCount).toBe(14);
    });

    it('advances even when every item is vetoed (the player still spent the time)', () => {
        const r = commitMontageProposal(
            proposal({ memories: [], traumas: [], skillUpdates: [], npcDeltas: [] }),
            character(),
            world({ turnCount: 13 }),
            14,
        );
        expect(r.world.turnCount).toBe(14);
        expect(r.world.time.totalMinutes).toBeGreaterThan(600);
    });

    it('reproduces the Codi Whitmore sequence without desyncing', () => {
        // Turn 13 committed normally, then a montage, then turn 15.
        // Before the fix the world counter went 13 → 13 → 14 while history
        // went 13 → 14 → 15.
        let w = world({ turnCount: 13 });

        const montage = commitMontageProposal(proposal(), character(), w, 14);
        w = montage.world;
        expect(w.turnCount).toBe(14);   // was 13 before the fix

        const ctx = sceneModeBargainStep.execute(ctxFor(15, w.turnCount));
        expect(ctx.worldUpdate.turnCount).toBe(15);  // was 14 before the fix
        expect(messages(ctx)).not.toContain('TURN DESYNC HEALED');
    });
});
