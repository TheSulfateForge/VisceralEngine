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
        // Snapshot for next turn's [SINCE LAST TURN] diff. Stamped with the
        // facts recorded this turn so the diff can surface them by name.
        ctx.worldUpdate.lastTurnDigest = buildTurnDigest(
            ctx.worldUpdate,
            ctx.characterUpdate,
            turn,
            ctx.validatedThreats,
        );

        return ctx;
    }
};
