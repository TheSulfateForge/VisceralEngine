import type { PipelineStep, TurnContext } from '../types';
import {
    findExpiredConditions,
    applyCeilings,
    decayBioModifiers,
    checkConditionDuplicate,
    checkConditionDuplicateEnhanced,
    partitionConditions
} from '../../contentValidation';
import { validateConditionEntityCoherence } from '../../engine/entityLifecycle';

/**
 * Step 10: Condition Pipeline (~100 lines from original)
 *
 * Processes character conditions, bio decay, and condition validation.
 * Enforces condition caps, removes expired conditions, applies trauma.
 *
 * Code extracted from lines 1408-1523 of original simulationEngine.ts.
 */
export const conditionPipelineStep: PipelineStep = {
    name: '10-conditionPipeline',
    execute: (ctx: TurnContext): TurnContext => {
        const r = ctx.sanitisedResponse;

        // Get the character state from bioTick result
        let conditionUpdate = ctx.bioResult?.newConditions ?? ctx.previousCharacter.conditions ?? [];
        let modifiers = ctx.bioResult?.modifiers ?? ctx.previousCharacter.bio?.modifiers ?? {
            calories: 1.0,
            hydration: 1.0,
            stamina: 1.0,
            lactation: 0.0
        };

        // =====================================================================
        // 1. CONDITION PIPELINE — BIO REMOVALS & SEMANTIC DEDUP
        // =====================================================================

        // Process new conditions from response (if any)
        if (r.character_updates?.added_conditions && r.character_updates.added_conditions.length > 0) {
            for (const newCondition of r.character_updates.added_conditions) {
                // Check for duplicates
                const { isDuplicate, existingIndex } = checkConditionDuplicate(
                    newCondition,
                    conditionUpdate
                );

                if (isDuplicate) {
                    ctx.debugLogs.push({
                        timestamp: new Date().toISOString(),
                        message: `[CONDITION DEDUP] "${newCondition}" is a duplicate of existing condition — skipped`,
                        type: 'warning'
                    });
                } else {
                    // New condition — check enhanced dedup
                    const { isDuplicate: isEnhancedDupe } = checkConditionDuplicateEnhanced(
                        newCondition,
                        conditionUpdate
                    );

                    if (isEnhancedDupe) {
                        ctx.debugLogs.push({
                            timestamp: new Date().toISOString(),
                            message: `[CONDITION ENHANCED DEDUP] "${newCondition}" is semantically similar to existing — skipped`,
                            type: 'warning'
                        });
                    } else {
                        conditionUpdate.push(newCondition);
                        ctx.debugLogs.push({
                            timestamp: new Date().toISOString(),
                            message: `[CONDITION NEW] Added: "${newCondition}"`,
                            type: 'info'
                        });
                    }
                }
            }
        }

        // =====================================================================
        // 2. TIMED CONDITION EXPIRY
        // =====================================================================

        const currentMinutes = ctx.newTime.totalMinutes ?? 0;
        const conditionTimestamps = ctx.previousCharacter.conditionTimestamps ?? {};

        const expiredConditions = findExpiredConditions(
            conditionUpdate,
            conditionTimestamps,
            currentMinutes
        );

        if (expiredConditions.length > 0) {
            conditionUpdate = conditionUpdate.filter(c => !expiredConditions.includes(c));
            ctx.debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[CONDITION EXPIRY] Removed ${expiredConditions.length} expired conditions`,
                type: 'info'
            });
        }

        // =====================================================================
        // 3. HARD CAP ENFORCEMENT
        // =====================================================================

        // v1.8: Enforce the hard cap of 20 conditions per character
        const CONDITION_HARD_CAP = 20;
        if (conditionUpdate.length > CONDITION_HARD_CAP) {
            const dropped = conditionUpdate.length - CONDITION_HARD_CAP;
            conditionUpdate = conditionUpdate.slice(-CONDITION_HARD_CAP);
            ctx.debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[CONDITION CAP] Character has ${conditionUpdate.length} conditions — exceeded cap of ${CONDITION_HARD_CAP}. Dropped ${dropped} oldest.`,
                type: 'warning'
            });
        }

        // =====================================================================
        // 4. ENTITY/CONDITION COHERENCE VALIDATION (v1.20)
        // =====================================================================

        const coherenceResult = validateConditionEntityCoherence(
            conditionUpdate,
            (ctx.worldUpdate.knownEntities ?? []).map(e => ({
                name: e.name,
                status: e.status ?? 'present'
            })),
            ctx.debugLogs
        );

        if (coherenceResult.removed.length > 0) {
            ctx.debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[CONDITION COHERENCE — v1.20] Removed ${coherenceResult.removed.length} conditions referencing dead/retired entities`,
                type: 'warning'
            });
        }
        conditionUpdate = coherenceResult.conditions;

        // =====================================================================
        // 5. BIO MODIFIER DECAY & CAPPING
        // =====================================================================

        // Apply passive decay (turn-over-turn baseline drift)
        const isAcceleratedDecay =
            ctx.tensionLevel >= 20 ||
            (r.scene_mode === 'COMBAT') ||
            (ctx.bioResult?.isExhausted ?? false);

        modifiers = decayBioModifiers(modifiers, isAcceleratedDecay);

        // Apply ceiling constraints (per-stat maximums)
        modifiers = applyCeilings(modifiers);

        // Log bio modifier state
        ctx.debugLogs.push({
            timestamp: new Date().toISOString(),
            message: `[BIO MODIFIERS] Cal: ${modifiers.calories.toFixed(2)}, Hyd: ${modifiers.hydration.toFixed(2)}, Stm: ${modifiers.stamina.toFixed(2)}, Lact: ${modifiers.lactation.toFixed(2)}`,
            type: 'info'
        });

        // =====================================================================
        // 6. FINAL TRAUMA CALCULATION
        // =====================================================================

        // Trauma is already computed by BioEngine and stored in bioResult
        const finalTrauma = ctx.bioResult?.trauma ?? ctx.previousCharacter.trauma ?? 0;

        // Cap trauma at 100
        const cappedTrauma = Math.min(100, finalTrauma);

        if (cappedTrauma !== finalTrauma) {
            ctx.debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[TRAUMA CAP] Trauma capped: ${finalTrauma.toFixed(1)} → ${cappedTrauma.toFixed(1)}`,
                type: 'info'
            });
        }

        // =====================================================================
        // 7. UPDATE CHARACTER STATE
        // =====================================================================

        ctx.characterUpdate.conditions = conditionUpdate;
        ctx.characterUpdate.bio = {
            ...ctx.characterUpdate.bio,
            modifiers
        };
        ctx.characterUpdate.trauma = cappedTrauma;

        // Update condition timestamps with current time
        const updatedConditionTimestamps = { ...conditionTimestamps };
        for (const condition of conditionUpdate) {
            if (!updatedConditionTimestamps[condition]) {
                updatedConditionTimestamps[condition] = currentMinutes;
            }
        }
        ctx.characterUpdate.conditionTimestamps = updatedConditionTimestamps;

        ctx.debugLogs.push({
            timestamp: new Date().toISOString(),
            message: `[CONDITION PIPELINE] Final state: ${conditionUpdate.length} conditions, trauma: ${cappedTrauma.toFixed(1)}`,
            type: 'info'
        });

        return ctx;
    }
};
