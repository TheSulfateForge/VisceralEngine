import type { PipelineStep, TurnContext } from '../types';
import type { SceneMode } from '../../../types';

/**
 * Step 11: Scene Mode & Devil's Bargain Tracking
 *
 * Processes scene mode transitions, bargain request tracking,
 * turn count incrementation, staleness warnings, and entity density violations.
 *
 * Code extracted from lines 1500-1593 of original simulationEngine.ts.
 */
export const sceneModeBargainStep: PipelineStep = {
    name: '11-sceneModeBargain',
    execute: (ctx: TurnContext): TurnContext => {
        const r = ctx.sanitisedResponse;

        // =====================================================================
        // 1. SCENE MODE AUTO-TRANSITION
        // =====================================================================

        // v1.9 + v1.10: Auto-transition scene mode to NARRATIVE when threats become empty
        // This prevents the engine from staying in COMBAT after the last threat is dead
        let nextSceneMode: SceneMode = ctx.effectiveSceneMode;

        if ((ctx.worldUpdate.emergingThreats?.length ?? 0) === 0) {
            if (nextSceneMode === 'COMBAT' || nextSceneMode === 'TENSION') {
                nextSceneMode = 'NARRATIVE';
                ctx.debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: `[SCENE MODE AUTO-TRANSITION] All threats cleared — transitioning ${ctx.effectiveSceneMode} → NARRATIVE`,
                    type: 'info'
                });
            }
        }

        ctx.worldUpdate.sceneMode = nextSceneMode;

        // =====================================================================
        // 2. DEVIL'S BARGAIN COOLDOWN TRACKING
        // =====================================================================

        let lastBargainTurn = ctx.previousWorld.lastBargainTurn ?? -1000;

        if (r.bargain_request) {
            // New bargain request submitted this turn
            lastBargainTurn = ctx.currentTurn;

            ctx.debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[BARGAIN] Devil's bargain requested: "${r.bargain_request.description.substring(0, 80)}"`,
                type: 'info'
            });
        } else {
            // Check for bargain overdue warning (no bargain in 8+ turns during high tension)
            const turnsSinceLastBargain = ctx.currentTurn - lastBargainTurn;
            const tensionHigh = ctx.tensionLevel >= 20;

            if (tensionHigh && turnsSinceLastBargain > 8) {
                ctx.debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: `[BARGAIN OVERDUE] No bargain for ${turnsSinceLastBargain} turns (high tension ${ctx.tensionLevel}) — consider offering a choice`,
                    type: 'warning'
                });
            }
        }

        ctx.worldUpdate.lastBargainTurn = lastBargainTurn;

        // =====================================================================
        // 3. TURN COUNT INCREMENT
        // =====================================================================

        // v1.30: ASSIGN the authoritative turn number rather than self-increment.
        //
        // `gameWorld.turnCount` used to be incremented from its own previous
        // value, independently of `gameHistory.turnCount` — which is the
        // counter `ctx.currentTurn` is derived from. Any path that advanced one
        // without the other desynced them permanently, and montage was exactly
        // such a path (fixed in commitMontageProposal). The Codi Whitmore save
        // shows the result: history.turnCount 19 vs world.turnCount 18, with
        // every turn logging "Turn 19 → Next turn will be 18".
        //
        // Assigning makes gameHistory.turnCount the single source of truth and
        // gameWorld.turnCount a mirror of it, so ANY future drift — from a path
        // that doesn't exist yet — self-heals on the next turn instead of
        // compounding silently. Everything else in the world state
        // (lastWorldTickTurn, lastBargainTurn, lastNewEntityTurn,
        // threatCooldownUntilTurn) is already stamped from ctx.currentTurn, so
        // this puts the counter back on the same scale as its own consumers.
        const previousWorldTurn = ctx.previousWorld.turnCount ?? 0;
        const nextTurnCount = ctx.currentTurn;
        ctx.worldUpdate.turnCount = nextTurnCount;

        // A healthy turn advances the world counter by exactly one. Anything
        // else means a path advanced history without the world — surface it
        // rather than absorbing it silently.
        const drift = nextTurnCount - previousWorldTurn;
        if (drift !== 1) {
            ctx.debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[TURN DESYNC HEALED] World turn counter was ${previousWorldTurn}, authoritative turn is ${nextTurnCount} (drift ${drift > 0 ? '+' : ''}${drift - 1}). Realigned. A turn advanced gameHistory.turnCount without advancing gameWorld.turnCount.`,
                type: 'warning'
            });
        }

        ctx.debugLogs.push({
            timestamp: new Date().toISOString(),
            message: `[TURN INCREMENT] World turn ${previousWorldTurn} → ${nextTurnCount}`,
            type: 'info'
        });

        // =====================================================================
        // 4. STALENESS WARNINGS
        // =====================================================================

        // v1.14: Warn if entity density is stale (no new entities in 10+ turns)
        const lastNewEntityTurn = (ctx.previousWorld as any)?.lastNewEntityTurn ?? 0;
        const stalenesSinceLast = ctx.currentTurn - lastNewEntityTurn;

        if (stalenesSinceLast >= 10) {
            const knownEntityCount = ctx.worldUpdate.knownEntities?.length ?? 0;
            ctx.debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[STALENESS WARNING] No new entities in ${stalenesSinceLast} turns (current roster: ${knownEntityCount}). Consider introducing new cast members.`,
                type: 'warning'
            });
        }

        // =====================================================================
        // 5. ENTITY DENSITY VIOLATION CHECKS
        // =====================================================================

        // v1.14: Warn if entity roster exceeds healthy size
        const ENTITY_DENSITY_THRESHOLD = 25;
        const knownEntityCount = ctx.worldUpdate.knownEntities?.length ?? 0;

        if (knownEntityCount > ENTITY_DENSITY_THRESHOLD) {
            ctx.debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[ENTITY DENSITY] Current roster has ${knownEntityCount} entities (threshold: ${ENTITY_DENSITY_THRESHOLD}). Consider retiring or killing off characters to manage cognitive load.`,
                type: 'warning'
            });
        }

        // v1.14: Track new entity addition for staleness detection
        const previousEntityCount = ctx.previousWorld.knownEntities?.length ?? 0;
        if (knownEntityCount > previousEntityCount) {
            (ctx.worldUpdate as any).lastNewEntityTurn = ctx.currentTurn;
            ctx.debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[NEW ENTITY] Added ${knownEntityCount - previousEntityCount} entity/entities (total: ${knownEntityCount})`,
                type: 'info'
            });
        }

        // =====================================================================
        // 6. SUMMARY LOG
        // =====================================================================

        ctx.debugLogs.push({
            timestamp: new Date().toISOString(),
            message: `[SCENE MODE BARGAIN] Scene: ${nextSceneMode}, Tension: ${ctx.tensionLevel}, Turns since bargain: ${ctx.currentTurn - lastBargainTurn}`,
            type: 'info'
        });

        return ctx;
    }
};
