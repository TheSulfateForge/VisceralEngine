import type { PipelineStep, TurnContext } from '../types';
import {
    getEffectiveSceneMode,
    validateHiddenUpdateCoherence
} from '../../engine';

/**
 * Step 8: Hidden Registry
 *
 * Validates and processes the hidden_update field that tracks NPC presence,
 * threat information, and other hidden knowledge not revealed to the player.
 *
 * NOTE: This step initializes state that will be used by later steps.
 * The actual hidden registry writing happens in Step 9 (worldTick).
 */
export const hiddenRegistryStep: PipelineStep = {
    name: '08-hiddenRegistry',
    execute: (ctx: TurnContext): TurnContext => {
        const r = ctx.sanitisedResponse;

        // Initialize shared state for later steps
        ctx.newHiddenRegistry = ctx.previousWorld.hiddenRegistry || '';
        ctx.lastWorldTickTurn = ctx.previousWorld.lastWorldTickTurn ?? 0;
        ctx.processedThreats = undefined;
        ctx.currentHooks = undefined;
        ctx.currentFactionExposure = undefined;
        ctx.detectedPassiveAllies = undefined;
        ctx.currentThreatArcHistory = undefined;

        // v1.9 + v1.10: Compute scene mode early
        const statedSceneMode = r.scene_mode ?? ctx.previousWorld.sceneMode ?? 'NARRATIVE';
        ctx.effectiveSceneMode = getEffectiveSceneMode(
            statedSceneMode,
            r.world_tick?.npc_actions ?? [],
            ctx.debugLogs
        ) as any;

        // v1.8: Validate hidden_update against threat ETAs
        if (r.hidden_update) {
            const existingEmergingForHiddenCheck = ctx.previousWorld.emergingThreats ?? [];
            let validatedHiddenUpdate = validateHiddenUpdateCoherence(
                r.hidden_update,
                existingEmergingForHiddenCheck,
                ctx.debugLogs,
                ctx.previousCharacter.name,
                ctx.effectiveSceneMode
            );
            ctx.newHiddenRegistry = validatedHiddenUpdate;
        }

        return ctx;
    }
};
