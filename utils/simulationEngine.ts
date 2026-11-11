/**
 * simulationEngine.ts — REFACTORED TO PIPELINE (Stream 3)
 *
 * This file is now a thin wrapper around the modularized pipeline.
 * The original 1650-line monolithic processTurn() has been decomposed into
 * 12 discrete pipeline steps, each responsible for a specific aspect of
 * the turn simulation.
 *
 * The pipeline maintains IDENTICAL output to the original implementation
 * while providing a cleaner, more maintainable architecture.
 *
 * Pipeline Steps:
 *  01. Sanitize: Full-response field sanitisation
 *  02. TimeProgression: Time delta calculation and world time update
 *  03. BioTick: Character biological state simulation
 *  04. Reproduction: Pregnancy and conception handling
 *  05. ThoughtAndCombat: AI thought logging and combat context extraction
 *  06. EntityLifecycle: Entity deduplication, presence, status, location tracking
 *  07. MemoryLore: Memory and lore processing with deduplication
 *  08. HiddenRegistry: Hidden update validation and scene mode computation
 *  09. WorldTick: NPC validation, threat processing, exposure, cooldowns (LARGEST)
 *  10. ConditionPipeline: Character condition processing and bio decay
 *  11. SceneModeBargain: Scene mode transitions, bargain tracking, turn count
 *  12. AssembleState: Final state assembly and return
 */

import type { ModelResponseSchema, GameWorld, Character, DebugLogEntry, LoreItem } from '../types';
import { executePipeline } from './pipeline/runner';
import { buildTurnContext, buildPipeline } from './pipeline/pipelineConfig';
import type { SimulationResult } from './pipeline/types';
import { applySleepInference } from './engine/sleepInference';

/**
 * SimulationEngine — Public API
 *
 * The processTurn function maintains the same signature as the original,
 * ensuring backward compatibility with all callers.
 */
export const SimulationEngine = {
    /**
     * Processes a single turn of the simulation.
     *
     * Input:
     *  - response: The AI's structured response for this turn
     *  - currentWorld: The game world state at turn start
     *  - character: The player character state at turn start
     *  - currentTurn: The turn number (0-indexed)
     *  - playerRemovedConditions: Conditions the player manually removed
     *  - playerInput: The player's narrative input for this turn
     *
     * Output:
     *  - worldUpdate: Updated game world state
     *  - characterUpdate: Updated character state
     *  - debugLogs: Diagnostic logs for this turn
     *  - pendingLore: Lore items awaiting player approval
     *
     * Guarantees:
     *  - Output is identical for identical inputs (pure function)
     *  - All validation and sanitization happens before any state writes
     *  - State changes are deterministic and traceable via debugLogs
     */
    processTurn: (
        response: ModelResponseSchema,
        currentWorld: GameWorld,
        character: Character,
        currentTurn: number,
        playerRemovedConditions: string[] = [],
        playerInput: string = ''
    ): SimulationResult => {
        // v1.54: a declared sleep the model didn't report becomes a REST turn
        // BEFORE the pipeline is chosen (time_mode gates steps). No-op when the
        // caller already applied it or the model sent sleep_hours.
        const sleepLog = applySleepInference(
            response,
            playerInput,
            currentWorld.time?.totalMinutes ?? 0,
            currentWorld.calendar?.minutesPerDay ?? 1440,
        );

        // Build the initial context from inputs
        const ctx = buildTurnContext(
            response,
            currentWorld,
            character,
            currentTurn,
            playerRemovedConditions,
            playerInput
        );

        // v1.21: Select the pipeline for this turn's time_mode. buildTurnContext
        // has already resolved ctx.effectiveTimeMode (AI-declared or derived from
        // scene_mode); MONTAGE/REST/etc. gate out the steps they disable.
        if (sleepLog) ctx.debugLogs.push({ timestamp: new Date().toISOString(), message: sleepLog, type: 'warning' });
        const pipeline = buildPipeline(ctx.effectiveTimeMode);
        return executePipeline(pipeline, ctx);
    }
};

// Re-export the types for external use
export type { SimulationResult };
