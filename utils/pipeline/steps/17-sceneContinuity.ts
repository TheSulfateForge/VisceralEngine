import type { PipelineStep, TurnContext } from '../types';
import {
    sceneChanged,
    updateSceneLedger,
    ingestPlayerAssertions,
    buildTurnDigest,
} from '../../engine/sceneContinuity';
import { generateUUID } from '../../../idUtils';

/**
 * Step 17: Scene continuity — ledger, player canon, turn digest.
 *
 * v1.31. Runs LAST so it snapshots genuinely final state: location and
 * sceneMode are settled by 12-assembleState, conditions by 13-traumaEffects,
 * skills by 15/16.
 *
 * All three outputs exist to attack the same root cause — the prompt described
 * STATE but never CHANGE, and the player could not write to state at all. See
 * utils/engine/sceneContinuity.ts for the measurements behind that.
 *
 * This step is pure bookkeeping: it never alters narrative, threats, time or
 * conditions, so it is safe to run in every time_mode.
 */
export const sceneContinuityStep: PipelineStep = {
    name: '17-sceneContinuity',
    execute: (ctx: TurnContext): TurnContext => {
        const turn = ctx.currentTurn;

        // --- 1. Scene ledger ------------------------------------------------
        const didSceneChange = sceneChanged(
            ctx.previousWorld.location,
            ctx.worldUpdate.location,
            ctx.previousWorld.sceneMode,
            ctx.worldUpdate.sceneMode,
        );

        const { ledger, reset, added } = updateSceneLedger(
            ctx.previousWorld.sceneLedger,
            ctx.sanitisedResponse.world_tick?.npc_actions,
            ctx.sanitisedResponse.established,
            turn,
            didSceneChange,
            () => generateUUID(),
        );
        ctx.worldUpdate.sceneLedger = ledger;

        if (reset) {
            ctx.debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[SCENE LEDGER] Scene changed (${ctx.previousWorld.location ?? '?'}/${ctx.previousWorld.sceneMode ?? '?'} → ${ctx.worldUpdate.location ?? '?'}/${ctx.worldUpdate.sceneMode ?? '?'}) — ledger cleared, ${added} new beat(s).`,
                type: 'info'
            });
        } else if (added > 0) {
            ctx.debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[SCENE LEDGER] +${added} beat(s), ${ledger.length} tracked.`,
                type: 'info'
            });
        }

        // --- 2. Player canon ------------------------------------------------
        // In-character assertions only here; the OOC path ingests its own via
        // the same helper before it ever reaches the pipeline.
        const { canon, accepted, rejected } = ingestPlayerAssertions(
            ctx.previousWorld.playerCanon,
            ctx.sanitisedResponse.player_assertions,
            turn,
            false,
            () => generateUUID(),
        );
        ctx.worldUpdate.playerCanon = canon;

        for (const fact of accepted) {
            ctx.debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[PLAYER CANON] Recorded: "${fact}"`,
                type: 'success'
            });
        }
        for (const fact of rejected) {
            ctx.debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[PLAYER CANON] REJECTED (outside the player's own character): "${fact}"`,
                type: 'warning'
            });
        }

        // --- 2b. Model-flagged correction (v1.35) ---------------------------
        // The regex list in playerFraming.ts matched NOTHING across both
        // 2026-08-31 saves, so PLAYER_CORRECTION_PROTOCOL never fired once.
        // The model has already read the input and is much better at spotting
        // "he is telling me I misread him" than a keyword list can be.
        //
        // The flag arrives WITH the response, so it cannot arm the reminder on
        // the turn it describes — it arms the NEXT one. That is not a
        // consolation prize: v1.29's documented failure mode is the NPC
        // conceding a correction and then re-asserting the same framing on the
        // following beat, which is exactly the turn this covers.
        if (ctx.sanitisedResponse.player_correction === true) {
            ctx.worldUpdate.correctionFlaggedTurn = turn;
            ctx.debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[CORRECTION — v1.35] Model reported the player correcting a reading of himself on turn ${turn}. `
                    + `PLAYER_CORRECTION_PROTOCOL will be armed next turn.`,
                type: 'warning',
            });
        } else if (ctx.previousWorld.correctionFlaggedTurn !== undefined) {
            // Carry it forward exactly one turn, then let it lapse.
            ctx.worldUpdate.correctionFlaggedTurn =
                ctx.previousWorld.correctionFlaggedTurn === turn - 1
                    ? ctx.previousWorld.correctionFlaggedTurn
                    : undefined;
        }

        // --- 3. Turn digest -------------------------------------------------
        // Baseline for next turn's [SINCE LAST TURN] diff.
        //
        // v1.36 CRITICAL FIX. This used to snapshot `ctx.worldUpdate` — the
        // world AFTER every change this turn made — and step 17 runs LAST
        // precisely so that it would. The next turn's prompt then diffed that
        // digest against `gameWorld`, which IS that same committed world. The
        // digest was compared against the state it had been copied from, so
        // every field matched and the block returned its "NOTHING IN THE WORLD
        // STATE CHANGED" text unconditionally. Null by construction, on every
        // turn, in every save, since v1.31.
        //
        // Measured in the 2026-08-31 saves: 28 of 32 prompts (Bellwether) and
        // 16 of 18 (Elspeth) carried the null block. Save B's clock ran
        // 09:05 -> 17:53 — nine hours, a time advance on all 32 turns — and the
        // block reported a clock change THREE times. All three were the turn
        // after a [MONTAGE], because `commitMontageProposal` lives outside
        // `processTurn` and so mutates the world AFTER this snapshot: the only
        // change path that landed after the digest was the only one it could
        // ever see. The prompt was asserting "Same place, same clock, same
        // people, same stakes" on turns where all three had changed.
        //
        // The baseline must be the state at the START of this turn. Then the
        // next prompt compares end-of-N against start-of-N and reports what
        // turn N actually did.
        //
        // `turn` stays the CURRENT turn: it is the turn the digest is a
        // baseline FOR, and `promptUtils` uses it to select the player canon
        // asserted during that turn. Do not change it to `turn - 1`.
        //
        // Montage is handled for free by this ordering. A montage commits
        // after turn N and does not touch the digest, so turn N+1 diffs
        // (end-of-N + montage) against start-of-N and surfaces the jump.
        ctx.worldUpdate.lastTurnDigest = buildTurnDigest(
            ctx.previousWorld,
            ctx.previousCharacter,
            turn,
            ctx.previousWorld.emergingThreats,
        );

        return ctx;
    }
};
