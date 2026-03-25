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
import { buildTurnContext, DEFAULT_PIPELINE } from './pipeline/pipelineConfig';
import type { SimulationResult } from './pipeline/types';

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
        // Build the initial context from inputs
        const ctx = buildTurnContext(
            response,
            currentWorld,
            character,
            currentTurn,
            playerRemovedConditions,
            playerInput
        );

        // Execute all pipeline steps in order
        return executePipeline(DEFAULT_PIPELINE, ctx);
    }
};

// Re-export the types for external use
export type { SimulationResult };
