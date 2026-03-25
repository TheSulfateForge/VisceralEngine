import type { PipelineStep, TurnContext } from '../types';
import { resolveAllBannedNames } from '../../nameResolver';
import { trimHiddenRegistry } from '../../engine';
import { decayBioModifiers, applyCeilings } from '../../contentValidation';

/**
 * Step 12: Final State Assembly
 *
 * Assembles the final worldUpdate and characterUpdate objects
 * that are returned to the caller.
 *
 * Code extracted from lines 1598-1648 of original simulationEngine.ts.
 */
export const assembleStateStep: PipelineStep = {
    name: '12-assembleState',
    execute: (ctx: TurnContext): TurnContext => {
        const r = ctx.sanitisedResponse;

        // Create finalMemory reference (should have been set by memoryLore step)
        const finalMemory = ctx.worldUpdate.memory ?? ctx.previousWorld.memory;

        // Create finalConditions reference (should have been set by conditionPipeline step)
        const finalConditions = ctx.characterUpdate.conditions ?? ctx.previousCharacter.conditions;
        const updatedTimestamps = ctx.characterUpdate.conditionTimestamps ?? ctx.previousCharacter.conditionTimestamps;
        const finalTrauma = ctx.characterUpdate.trauma ?? ctx.previousCharacter.trauma;

        // Bio decay
        const decayedModifiers = ctx.bioResult?.bio?.modifiers || ctx.previousCharacter.bio?.modifiers || [];

        // Scene mode finalization (should have been set by sceneModeBargain step)
        const finalSceneMode = ctx.worldUpdate.sceneMode ?? ctx.effectiveSceneMode;
        const finalTensionLevel = ctx.worldUpdate.tensionLevel ?? ctx.tensionLevel;

        // Emerging threats finalization
        const finalEmergingThreats = ctx.worldUpdate.emergingThreats ?? ctx.previousWorld.emergingThreats ?? [];

        // Turn count increment
        const newTurnCount = (ctx.previousWorld.turnCount ?? 0) + 1;

        ctx.debugLogs.push({
            timestamp: new Date().toISOString(),
            message: `Turn ${newTurnCount} complete.`,
            type: 'info'
        });

        // Staleness warnings
        if (newTurnCount > 15 && newTurnCount % 10 === 0) {
            if (!ctx.previousWorld.factionIntelligence || Object.keys(ctx.previousWorld.factionIntelligence).length === 0) {
                ctx.debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: '[FACTION INTEL] factionIntelligence is empty after turn 15 — AI is not tracking faction awareness.',
                    type: 'warning'
                });
            }
            if (!ctx.previousWorld.legalStatus?.knownClaims?.length && !ctx.previousWorld.legalStatus?.playerDocuments?.length) {
                ctx.debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: '[LEGAL STATUS] legalStatus is empty — AI is not recording claims or documents.',
                    type: 'warning'
                });
            }
        }

        // Entity density violation checks
        const entityDensityRequirements: [number, number][] = [[10, 5], [30, 10], [60, 15]];
        const currentEntityCount = ctx.updatedKnownEntities.length;
        for (const [turnThreshold, entityMin] of entityDensityRequirements) {
            if (newTurnCount >= turnThreshold && currentEntityCount < entityMin) {
                ctx.debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: `[ENTITY-DENSITY-VIOLATION] Turn ${newTurnCount}: ${currentEntityCount}/${entityMin} required entities (threshold at turn ${turnThreshold}). Obligation has been unmet since turn ${turnThreshold}.`,
                    type: 'error'
                });
            }
        }

        // Assemble final worldUpdate
        const worldUpdate = {
            ...ctx.worldUpdate,
            time: ctx.newTime,
            lore: ctx.previousWorld.lore,
            memory: finalMemory,
            hiddenRegistry: resolveAllBannedNames(trimHiddenRegistry(ctx.newHiddenRegistry), ctx.nameMap, ctx.usedNames),
            pregnancies: ctx.worldUpdate.pregnancies ?? ctx.previousWorld.pregnancies ?? [],
            activeThreats: ctx.nextThreats,
            environment: ctx.nextEnv,
            knownEntities: ctx.updatedKnownEntities,
            sceneMode: finalSceneMode,
            tensionLevel: finalTensionLevel,
            lastWorldTickTurn: ctx.lastWorldTickTurn,
            turnCount: newTurnCount,
            lastBargainTurn: ctx.previousWorld.lastBargainTurn ?? 0,
            factionIntelligence: ctx.previousWorld.factionIntelligence ?? {},
            legalStatus: ctx.previousWorld.legalStatus ?? { knownClaims: [], playerDocuments: [] },
            dormantHooks: ctx.currentHooks ?? ctx.previousWorld.dormantHooks ?? [],
            factionExposure: ctx.currentFactionExposure ?? ctx.previousWorld.factionExposure ?? {},
            bannedNameMap: ctx.nameMap,
            emergingThreats: finalEmergingThreats,
            passiveAlliesDetected: typeof ctx.detectedPassiveAllies !== 'undefined' ? ctx.detectedPassiveAllies.length > 0 : (ctx.previousWorld.passiveAlliesDetected ?? false),
            threatArcHistory: ctx.currentThreatArcHistory ?? ctx.previousWorld.threatArcHistory ?? {},
            bannedMechanisms: ctx.previousWorld.bannedMechanisms ?? [],
            location: ctx.newPlayerLocation,
            locationGraph: ctx.worldUpdate.locationGraph ?? ctx.previousWorld.locationGraph,
            usedNameRegistry: ctx.usedNames,
            threatDenialTracker: ctx.denialTracker,
            threatCooldownUntilTurn: ctx.globalCooldownUntil,
            lastThreatArcEndTurn: ctx.lastThreatArcEndTurn,
            sessionDenialCount: ctx.sessionDenialCount,
        };

        // Assemble final characterUpdate
        const characterUpdate = {
            ...ctx.characterUpdate,
            bio: {
                ...(ctx.bioResult?.bio ?? ctx.previousCharacter.bio),
                modifiers: decayedModifiers,
            },
            conditions: finalConditions,
            conditionTimestamps: updatedTimestamps,
            trauma: finalTrauma
        };

        ctx.worldUpdate = worldUpdate as any;
        ctx.characterUpdate = characterUpdate;

        return ctx;
    }
};
