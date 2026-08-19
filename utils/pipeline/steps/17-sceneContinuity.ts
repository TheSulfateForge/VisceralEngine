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
