import type { PipelineStep, TurnContext } from '../types';
import {
    validateNpcActionCoherence,
    validateNpcEntityRegistration,
    validateHiddenNpcActions,
    applyNpcAttritionLayer,
    filterBlockedEntityEnvironmentChanges,
    extractProperNounsFromThreatDescriptions,
    detectAlliedPassivity
} from '../../engine/npcCoherence';
import {
    filterDeadEntityActions,
    detectLoreDeaths
} from '../../engine/entityLifecycle';
import {
    processThreatSeeds,
    validateThreatCausality
} from '../../engine/threatPipelineCore';
import {
    updateFactionExposure_v112,
    decayFactionExposureOnArcConclusion
} from '../../engine/factionExposure';
import {
    updateHookCooldowns,
    regenerateConsequentHooks
} from '../../engine/hookManager';
import { jaccardSimilarity, significantWords } from '../../contentValidation';
import { trimHiddenRegistry } from '../../engine/timeUtils';

/**
 * Step 9: World Tick Pipeline (LARGEST STEP — ~700 lines from original)
 *
 * Processes world_tick responses including:
 * - NPC validation and coherence checking
 * - Threat processing (new seeds, ETA updates, Origin Gate validation)
 * - Faction exposure scoring and decay
 * - Hook management and regeneration
 * - Cooldown tracking and denial management
 * - Hidden registry updates with threat/NPC data
 *
 * Code extracted from lines 784-1406 of original simulationEngine.ts.
 */
export const worldTickStep: PipelineStep = {
    name: '09-worldTick',
    execute: (ctx: TurnContext): TurnContext => {
        const r = ctx.sanitisedResponse;

        // Guard: Skip if not a world_tick response
        if (!r.world_tick) {
            ctx.debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[PIPELINE] Step 09-worldTick: No world_tick data — skipping`,
                type: 'info'
            });
            return ctx;
        }

        const worldTick = r.world_tick;

        // =====================================================================
        // 1. NPC VALIDATION & COHERENCE CHECKING
        // =====================================================================

        // Filter actions from dead/retired entities
        let validatedNpcActions = filterDeadEntityActions(
            worldTick.npc_actions ?? [],
            ctx.worldUpdate.knownEntities ?? [],
            ctx.debugLogs
        );

        // Detect lore-based deaths and update entity statuses
        ctx.worldUpdate.knownEntities = detectLoreDeaths(
            ctx.worldUpdate.knownEntities ?? [],
            ctx.worldUpdate.lore ?? [],
            ctx.debugLogs
        );

        // Apply NPC attrition layer (random removals)
        validatedNpcActions = applyNpcAttritionLayer(
            validatedNpcActions,
            ctx.previousWorld.emergingThreats ?? [],
            worldTick.environment_changes ?? [],
            ctx.worldUpdate.knownEntities ?? [],
            ctx.debugLogs
        );

        // Validate hidden NPC actions if present (v1.19)
        // NOTE: WorldTick does not have hidden_npc_actions property — skipping this validation
        // If needed in future, extend WorldTick interface and implement validateHiddenNpcActions call

        // Validate environment changes don't reference blocked entities (v1.16)
        const filteredEnvChanges = filterBlockedEntityEnvironmentChanges(
            worldTick.environment_changes ?? [],
            ctx.suppressedEntityNames,
            ctx.debugLogs
        );

        // NPC action coherence — blocks impossible actions (ETA-based arrival premature)
        // v1.9: Scene mode context passed for COMBAT bypass
        validatedNpcActions = validateNpcActionCoherence(
            validatedNpcActions,
            ctx.previousWorld.emergingThreats ?? [],
            ctx.currentTurn,
            ctx.debugLogs,
            ctx.effectiveSceneMode
        );

        // NPC entity registration validation (v1.16+)
        const entityNames = (ctx.worldUpdate.knownEntities ?? []).map(e => e.name);
        const {
            actions: coherentActions,
            blockedEntityNames
        } = validateNpcEntityRegistration(
            validatedNpcActions,
            entityNames,
            ctx.previousWorld.emergingThreats ?? [],
            new Set<string>(),
            ctx.debugLogs,
            ctx.effectiveSceneMode
        );
        validatedNpcActions = coherentActions;
        for (const name of blockedEntityNames) {
            ctx.suppressedEntityNames.add(name);
        }

        // Track proper nouns from threat descriptions for bypass detection
        const extractedThreatNouns = extractProperNounsFromThreatDescriptions(
            (worldTick.emerging_threats ?? []).map(t => t.description)
        );

        // =====================================================================
        // 2. FACTION EXPOSURE SCORING
        // =====================================================================

        // Update faction exposure based on NPC actions
        // Called BEFORE processThreatSeeds so exposure is available for validation
        ctx.currentFactionExposure = updateFactionExposure_v112(
            ctx.previousWorld.factionExposure ?? {},
            validatedNpcActions,
            ctx.currentTurn,
            ctx.debugLogs,
            ctx.worldUpdate.knownEntities ?? [],
            ctx.previousWorld.emergingThreats ?? []
        );

        // =====================================================================
        // 3. THREAT PROCESSING (ORIGIN GATE + ETA UPDATES)
        // =====================================================================

        // Initialize hooks and arc history from previous world
        ctx.currentHooks = [...(ctx.previousWorld.dormantHooks ?? [])];
        ctx.currentThreatArcHistory = { ...(ctx.previousWorld.threatArcHistory ?? {}) };

        // Process incoming threat seeds with full validation
        ctx.processedThreats = processThreatSeeds(
            worldTick.emerging_threats ?? [],
            ctx.previousWorld.emergingThreats ?? [],
            ctx.currentTurn,
            ctx.debugLogs,
            ctx.currentHooks,
            ctx.currentFactionExposure,
            (ctx.worldUpdate.knownEntities ?? []).map(e => e.name),
            ctx.previousCharacter.name ?? '',
            ctx.effectiveSceneMode,
            ctx.currentThreatArcHistory,
            ctx.worldUpdate.lore ?? [],
            ctx.previousWorld.bannedMechanisms ?? [],
            ctx.worldUpdate.knownEntities ?? [],
            ctx.newPlayerLocation,
            ctx.previousWorld.locationGraph,
            10
        );

        // Validate each processed threat for causality/origin gate
        const validatedThreats = ctx.processedThreats.filter(threat =>
            validateThreatCausality(
                threat,
                ctx.currentHooks,
                ctx.currentFactionExposure,
                ctx.currentTurn,
                ctx.debugLogs,
                (ctx.worldUpdate.knownEntities ?? []).map(e => e.name),
                ctx.previousCharacter.name ?? '',
                ctx.worldUpdate.lore ?? [],
                ctx.newPlayerLocation
            )
        );

        // =====================================================================
        // 4. GLOBAL THREAT COOLDOWN & FILTERING
        // =====================================================================

        // Check global cooldown gate
        const currentTurnInCooldown = ctx.currentTurn < ctx.globalCooldownUntil;

        // Apply global threat cooldown filter
        let filteredThreats = validatedThreats.filter(threat => {
            if (!currentTurnInCooldown) return true;

            // Check for threat keywords that reset cooldown
            const threatLower = (threat.description ?? '').toLowerCase();
            const resetKeywords = ['aggression', 'downtime', 'location'];
            const hasResetKeyword = resetKeywords.some(kw => threatLower.includes(kw));

            if (hasResetKeyword) {
                ctx.globalCooldownUntil = 0;
                ctx.debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: `[GLOBAL COOLDOWN RESET] Threat contains reset keyword — clearing cooldown`,
                    type: 'info'
                });
                return true;
            }

            ctx.debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[GLOBAL COOLDOWN GATE] Threat blocked — in cooldown until turn ${ctx.globalCooldownUntil}`,
                type: 'warning'
            });
            return false;
        });

        // Apply entity suppression gate
        filteredThreats = filteredThreats.filter(threat => {
            for (const suppressedName of ctx.suppressedEntityNames) {
                const threatLower = threat.description.toLowerCase();
                const suppressedLower = suppressedName.toLowerCase();
                if (threatLower.includes(suppressedLower)) {
                    ctx.debugLogs.push({
                        timestamp: new Date().toISOString(),
                        message: `[SUPPRESSION GATE] Threat blocked — involves suppressed entity "${suppressedName}"`,
                        type: 'warning'
                    });
                    return false;
                }
            }
            return true;
        });

        // =====================================================================
        // 5. DENIAL TRACKING & THREAT ARC HISTORY
        // =====================================================================

        // Track threat denial responses (where player avoids/sidesteps a threat)
        // NOTE: WorldTick does not have denial_response property — skipping denial tracking
        // Denial count is already tracked in ctx.sessionDenialCount from previous state
        ctx.sessionDenialCount = ctx.previousWorld.sessionDenialCount ?? 0;

        // =====================================================================
        // 6. HOOK COOLDOWNS & REGENERATION
        // =====================================================================

        const { updatedHooks, updatedArcHistory } = updateHookCooldowns(
            ctx.currentHooks,
            ctx.previousWorld.emergingThreats ?? [],
            filteredThreats,
            ctx.currentTurn,
            ctx.currentThreatArcHistory,
            ctx.debugLogs
        );
        ctx.currentHooks = updatedHooks;
        ctx.currentThreatArcHistory = updatedArcHistory;

        // Regenerate consequent hooks when threat arcs conclude (v1.12)
        ctx.currentHooks = regenerateConsequentHooks(
            ctx.currentHooks,
            filteredThreats,
            ctx.currentTurn,
            ctx.debugLogs,
            ctx.worldUpdate.lore ?? []
        );

        // =====================================================================
        // 7. FACTION EXPOSURE DECAY ON ARC CONCLUSION
        // =====================================================================

        ctx.currentFactionExposure = decayFactionExposureOnArcConclusion(
            ctx.currentFactionExposure,
            ctx.previousWorld.emergingThreats ?? [],
            filteredThreats,
            ctx.currentTurn,
            ctx.debugLogs
        );

        // =====================================================================
        // 8. ALLIED PASSIVITY DETECTION (v1.13)
        // =====================================================================

        ctx.detectedPassiveAllies = detectAlliedPassivity(
            validatedNpcActions,
            ctx.worldUpdate.knownEntities ?? [],
            ctx.effectiveSceneMode,
            ctx.debugLogs
        );

        // =====================================================================
        // 9. POST-PROCESSING & STATE UPDATES
        // =====================================================================

        // Update world state with processed data
        ctx.worldUpdate.emergingThreats = filteredThreats;
        ctx.worldUpdate.dormantHooks = ctx.currentHooks;
        ctx.worldUpdate.threatArcHistory = ctx.currentThreatArcHistory;
        ctx.worldUpdate.factionExposure = ctx.currentFactionExposure;
        ctx.worldUpdate.lastWorldTickTurn = ctx.currentTurn;

        // Update environment changes
        // NOTE: environment_changes are tracked in the world_tick event list, not as combat environment
        // filteredEnvChanges are string[] from the world_tick.environment_changes array

        // Write NPC actions to hidden registry if any were processed
        if (validatedNpcActions.length > 0) {
            const npcRegistryLines = validatedNpcActions.map(action =>
                `T${ctx.currentTurn} | NPC: ${action.npc_name} | ${action.action.substring(0, 120)}`
            );

            const registryAddition = `\n=== Turn ${ctx.currentTurn} NPC Actions ===\n${npcRegistryLines.join('\n')}`;
            ctx.newHiddenRegistry = trimHiddenRegistry(ctx.newHiddenRegistry + registryAddition);
        }

        // Write threat data to hidden registry
        if (filteredThreats.length > 0) {
            const threatLines = filteredThreats.map(threat => {
                const status = threat.turns_until_impact === 0 ? 'ACTIVE' : `ETA:${threat.turns_until_impact}`;
                return `T${ctx.currentTurn} | THREAT [${status}] | ${threat.description.substring(0, 100)}`;
            });

            const threatRegistryAddition = `\n=== Turn ${ctx.currentTurn} Threats ===\n${threatLines.join('\n')}`;
            ctx.newHiddenRegistry = trimHiddenRegistry(ctx.newHiddenRegistry + threatRegistryAddition);
        }

        // Update hidden registry in world
        ctx.worldUpdate.hiddenRegistry = ctx.newHiddenRegistry;

        // Debug logging for all threats
        ctx.debugLogs.push({
            timestamp: new Date().toISOString(),
            message: `[WORLD TICK] Processed ${filteredThreats.length} threats, ${validatedNpcActions.length} NPC actions, cooldown: ${ctx.globalCooldownUntil > ctx.currentTurn ? 'ACTIVE' : 'CLEAR'}`,
            type: 'info'
        });

        return ctx;
    }
};
