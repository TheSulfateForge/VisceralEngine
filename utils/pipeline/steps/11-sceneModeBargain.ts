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

        const nextTurnCount = (ctx.previousWorld.turnCount ?? 0) + 1;
        ctx.worldUpdate.turnCount = nextTurnCount;

        ctx.debugLogs.push({
            timestamp: new Date().toISOString(),
            message: `[TURN INCREMENT] Turn ${ctx.currentTurn} → Next turn will be ${nextTurnCount}`,
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
