import { describe, it, expect } from 'vitest';
import { sceneContinuityStep } from '../utils/pipeline/steps/17-sceneContinuity';
import { buildSinceLastTurnBlock } from '../utils/engine/sceneContinuity';
import type { TurnContext } from '../utils/pipeline/types';
import type { GameWorld, Character, DebugLogEntry, ModelResponseSchema } from '../types';

// ===========================================================================
// v1.36 — the wiring test [SINCE LAST TURN] never had.
//
// From v1.31 until v1.36 this block returned "NOTHING IN THE WORLD STATE
// CHANGED" on literally every turn of every game. Step 17 ran LAST and
// snapshotted `ctx.worldUpdate` — the world AFTER the turn's changes — and the
// next prompt diffed that digest against the very world it had been copied
// from. Every field matched. Null by construction.
//
// Measured in the 2026-08-31 saves: 28/32 and 16/18 prompts carried the null
// text. Save B's clock ran 09:05 -> 17:53 across 32 turns and the block
// reported a clock change three times — each one the turn after a [MONTAGE],
// the only change path that lands after the snapshot.
//
// Every unit test in sceneContinuity.test.ts passed throughout, because they
// construct the digest and the world by hand and never exercise the real
// pipeline wiring. sceneContinuityStep.test.ts called `ctxFor(world(), world())`
// — identical on both sides — so it could not tell the difference either.
//
// These tests drive the ACTUAL step with a world that changed, and assert on
// what a later turn would actually see.
// ===========================================================================

const START: GameWorld = {
    location: 'Bellwether cistern house',
    sceneMode: 'SOCIAL',
    tensionLevel: 10,
    time: { totalMinutes: 545, display: 'Day 1, 09:05' },
    knownEntities: [{ id: 'e1', name: 'Maribel Jessop', role: 'Milk Matron', status: 'present' }],
    emergingThreats: [],
} as unknown as GameWorld;

/** What the pipeline produced by the end of the turn: 3h passed, moved, Pell joined. */
const END: GameWorld = {
    ...START,
    location: 'Bellwether bath house',
    time: { totalMinutes: 725, display: 'Day 1, 12:05' },
    knownEntities: [
        { id: 'e1', name: 'Maribel Jessop', role: 'Milk Matron', status: 'present' },
        { id: 'e2', name: 'Pell Jessop', role: 'Dairy overseer', status: 'present' },
    ],
} as unknown as GameWorld;

const CHAR_START = { name: 'Ryan Issishfvla', conditions: ['Rested'] } as unknown as Character;
const CHAR_END = { name: 'Ryan Issishfvla', conditions: ['Rested', 'Ink-Stained'] } as unknown as Character;

const response = (over: Partial<ModelResponseSchema> = {}): ModelResponseSchema => ({
    narrative: 'The seal settles.',
    thought_process: '',
    scene_mode: 'SOCIAL',
    tension_level: 10,
    ...over,
} as unknown as ModelResponseSchema);

const runTurn = (
    previousWorld: GameWorld,
    nextWorld: GameWorld,
    previousCharacter: Character,
    nextCharacter: Character,
    turn: number,
    resp: ModelResponseSchema = response(),
): TurnContext => sceneContinuityStep.execute({
    currentTurn: turn,
    previousWorld,
    previousCharacter,
    worldUpdate: { ...nextWorld },
    characterUpdate: { ...nextCharacter },
    sanitisedResponse: resp,
    validatedThreats: [],
    debugLogs: [] as DebugLogEntry[],
} as unknown as TurnContext);

describe('[SINCE LAST TURN] — pipeline wiring', () => {
    it('baselines the digest on the state at the START of the turn, not the end', () => {
        const ctx = runTurn(START, END, CHAR_START, CHAR_END, 18);
        const digest = ctx.worldUpdate.lastTurnDigest!;

        // This is the whole bug in one assertion. Before v1.36 every one of
        // these held the END value, which made the next turn's diff vacuous.
        expect(digest.location).toBe('Bellwether cistern house');
        expect(digest.totalMinutes).toBe(545);
        expect(digest.presentEntities).toEqual(['Maribel Jessop']);
        expect(digest.conditionCount).toBe(1);
    });

    it('still stamps the CURRENT turn — promptUtils selects canon by it', () => {
        const ctx = runTurn(START, END, CHAR_START, CHAR_END, 18);
        // Not turn - 1. `turn` is the turn the digest is a baseline FOR, and
        // promptUtils filters playerCanon on `turnAsserted === digest.turn` to
        // surface facts the player established during that turn.
        expect(ctx.worldUpdate.lastTurnDigest?.turn).toBe(18);
    });

    it('the next turn actually reports what changed', () => {
        const ctx = runTurn(START, END, CHAR_START, CHAR_END, 18);
        const block = buildSinceLastTurnBlock(ctx.worldUpdate.lastTurnDigest, END, CHAR_END, []);

        expect(block).not.toContain('NOTHING IN THE WORLD STATE CHANGED');
        expect(block).toContain('Clock: +3h');
        expect(block).toContain('Location: Bellwether cistern house → Bellwether bath house');
        expect(block).toContain('Arrived: Pell Jessop');
        expect(block).toContain('Conditions: 1 → 2');
    });

    it('the null block is now meaningful — it fires only when nothing really changed', () => {
        const ctx = runTurn(START, START, CHAR_START, CHAR_START, 18);
        const block = buildSinceLastTurnBlock(ctx.worldUpdate.lastTurnDigest, START, CHAR_START, []);
        expect(block).toContain('NOTHING IN THE WORLD STATE CHANGED');
    });

    it('reports a clock advance on an otherwise static beat', () => {
        // The single most common turn in the reviewed saves: same room, same
        // people, +5 minutes. It reported "same clock" 28 times out of 32.
        const ticked = { ...START, time: { totalMinutes: 550, display: 'Day 1, 09:10' } } as GameWorld;
        const ctx = runTurn(START, ticked, CHAR_START, CHAR_START, 18);
        const block = buildSinceLastTurnBlock(ctx.worldUpdate.lastTurnDigest, ticked, CHAR_START, []);
        expect(block).toContain('Clock: +5min');
        expect(block).not.toContain('NOTHING IN THE WORLD STATE CHANGED');
    });

    it('surfaces a montage jump, which commits outside the pipeline', () => {
        // commitMontageProposal (useMontage.ts) runs after processTurn and does
        // not touch the digest. Turn N+1 therefore diffs (end-of-N + montage)
        // against start-of-N and the jump is included rather than swallowed.
        const ctx = runTurn(START, START, CHAR_START, CHAR_START, 18);
        const afterMontage = {
            ...START,
            time: { totalMinutes: 725, display: 'Day 1, 12:05' },
        } as GameWorld;
        const block = buildSinceLastTurnBlock(ctx.worldUpdate.lastTurnDigest, afterMontage, CHAR_START, []);
        expect(block).toContain('Clock: +3h');
    });

    it('chains correctly across consecutive turns', () => {
        // Turn 18 moves the scene; turn 19 is static. Turn 19's prompt should
        // report turn 18's movement; turn 20's should report nothing.
        const t18 = runTurn(START, END, CHAR_START, CHAR_END, 18);
        const blockFor19 = buildSinceLastTurnBlock(t18.worldUpdate.lastTurnDigest, END, CHAR_END, []);
        expect(blockFor19).toContain('Location:');

        const t19 = runTurn(END, END, CHAR_END, CHAR_END, 19);
        const blockFor20 = buildSinceLastTurnBlock(t19.worldUpdate.lastTurnDigest, END, CHAR_END, []);
        expect(blockFor20).toContain('NOTHING IN THE WORLD STATE CHANGED');
    });

    it('carries player canon asserted during the turn the digest baselines', () => {
        const ctx = runTurn(
            START, END, CHAR_START, CHAR_END, 18,
            response({ player_assertions: ['Started the day with four vials of ink; half a vial remains.'] }),
        );
        const digest = ctx.worldUpdate.lastTurnDigest!;
        const canonThisTurn = (ctx.worldUpdate.playerCanon ?? [])
            .filter(e => e.turnAsserted === digest.turn)
            .map(e => e.fact);

        expect(canonThisTurn).toHaveLength(1);
        const block = buildSinceLastTurnBlock(digest, END, CHAR_END, canonThisTurn);
        expect(block).toContain('Player established: Started the day with four vials of ink');
    });
});
