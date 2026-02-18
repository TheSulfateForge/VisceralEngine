import { ModelResponseSchema, GameWorld, DebugLogEntry, LoreItem, Character, MemoryItem, SceneMode, WorldTime } from '../types';
import { ReproductionSystem } from './reproductionSystem';
import { BioEngine } from './bioEngine';
import { generateLoreId, generateMemoryId } from '../idUtils';
import {
    validateResponse,
    decayBioModifiers,
    findExpiredConditions,
    checkMemoryDuplicate,
} from './contentValidation';

interface SimulationResult {
    worldUpdate: GameWorld;
    characterUpdate: Character;
    debugLogs: DebugLogEntry[];
    pendingLore: LoreItem[];
}

const MAX_REGISTRY_LINES = 60;
const TIME_CAPS = { AWAKE_MAX: 120, SLEEP_MAX: 540, COMBAT_MAX: 30 };

// --- Pure Helper Functions ---

/**
 * Updates the total minutes and calculates day/hour/minute display
 */
const updateTime = (currentMinutes: number, delta: number): WorldTime => {
    const totalMinutes = currentMinutes + delta;
    const day = Math.floor(totalMinutes / 1440) + 1;
    const hour = Math.floor((totalMinutes % 1440) / 60);
    const minute = totalMinutes % 60;
    const display = `Day ${day}, ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    return { totalMinutes, day, hour, minute, display };
};

/**
 * Trims the hidden registry string to prevent infinite growth
 */
const trimHiddenRegistry = (registry: string): string => {
    if (!registry) return "";
    const lines = registry.split('\n').filter(l => l.trim());
    if (lines.length <= MAX_REGISTRY_LINES) return registry;
    return lines.slice(-MAX_REGISTRY_LINES).join('\n');
};

/**
 * Determines the safe amount of time to advance based on context
 */
const calculateTimeDelta = (
    requestedMinutes: number | undefined, 
    hasSleep: boolean, 
    isCombat: boolean
): { delta: number, log?: string } => {
    const rawDelta = requestedMinutes ?? 0;
    
    let maxAllowed: number;
    if (hasSleep) maxAllowed = TIME_CAPS.SLEEP_MAX;
    else if (isCombat) maxAllowed = TIME_CAPS.COMBAT_MAX;
    else maxAllowed = TIME_CAPS.AWAKE_MAX;

    const delta = Math.min(Math.max(0, rawDelta), maxAllowed);
    
    if (rawDelta > maxAllowed) {
        return { 
            delta, 
            log: `[TIME-CLAMP] AI requested +${rawDelta}m, clamped to +${delta}m (cap: ${maxAllowed})` 
        };
    }
    return { delta };
};

// --- Pipeline Orchestrator ---

export const SimulationEngine = {
    processTurn: (
        response: ModelResponseSchema, 
        currentWorld: GameWorld, 
        character: Character,
        currentTurn: number,
        playerRemovedConditions: string[] = []
    ): SimulationResult => {
        const debugLogs: DebugLogEntry[] = [];
        const logs: string[] = []; // Temporary log buffer

        // 1. Time Pipeline
        const hasSleep = (response.biological_inputs?.sleep_hours ?? 0) > 0;
        const isCombat = response.scene_mode === 'COMBAT';
        const { delta: timeDelta, log: timeLog } = calculateTimeDelta(response.time_passed_minutes, hasSleep, isCombat);
        
        if (timeLog) debugLogs.push({ timestamp: new Date().toISOString(), message: timeLog, type: 'warning' });
        
        const newTime = updateTime(currentWorld.time.totalMinutes, timeDelta);
        if (timeDelta > 0) {
            debugLogs.push({ timestamp: new Date().toISOString(), message: `Time Advancement: +${timeDelta}m -> ${newTime.display}`, type: 'info' });
        }

        // 2. Biology Pipeline (Delegated to BioEngine)
        const tensionLevel = response.tension_level ?? currentWorld.tensionLevel;
        // Pass playerRemovedConditions so the bio engine respects player-cleared conditions
        const bioResult = BioEngine.tick(character, timeDelta, tensionLevel, response.biological_inputs, playerRemovedConditions);
        
        // Log Bio results
        bioResult.logs.forEach(l => debugLogs.push({ timestamp: new Date().toISOString(), message: `[BIO] ${l}`, type: 'success' }));

        // 3. Pregnancy Pipeline
        let currentPregnancies = currentWorld.pregnancies || [];
        const progressResult = ReproductionSystem.advancePregnancies(currentPregnancies, currentTurn);
        currentPregnancies = progressResult.updated;
        
        // 4. Registry Pipeline
        let newHiddenRegistry = response.hidden_update 
            ? `${currentWorld.hiddenRegistry}\n[${newTime.display}] ${response.hidden_update}`
            : currentWorld.hiddenRegistry;

        // Merge pregnancy logs into registry and debug
        progressResult.logs.forEach(log => {
            newHiddenRegistry += `\n[SYSTEM-AUTO] ${log}`;
            debugLogs.push({ timestamp: new Date().toISOString(), message: log, type: 'info' });
        });

        // 5. Conception Pipeline
        if (response.biological_event === true) {
            if (ReproductionSystem.rollForConception()) {
                const newPreg = ReproductionSystem.initiatePregnancy(character, currentTurn, newTime.totalMinutes);
                currentPregnancies = [...currentPregnancies, newPreg];
                const logMsg = `Conception Event Confirmed: ${newPreg.motherName} (ID: ${newPreg.id})`;
                newHiddenRegistry += `\n[SYSTEM-AUTO] ${logMsg}`;
                debugLogs.push({ timestamp: new Date().toISOString(), message: logMsg, type: 'success' });
            } else {
                debugLogs.push({ timestamp: new Date().toISOString(), message: "Insemination detected. Conception failed (RNG).", type: 'info' });
            }
        }

        // 6. Context Pipeline (Combat & Threats)
        let nextThreats = currentWorld.activeThreats;
        let nextEnv = currentWorld.environment;

        if (response.combat_context) {
            nextThreats = response.combat_context.active_threats;
            nextEnv = response.combat_context.environment;
        } else if (response.scene_mode === 'SOCIAL' || response.scene_mode === 'NARRATIVE') {
            nextThreats = [];
        }

        // 7. Entity Pipeline
        let updatedKnownEntities = [...(currentWorld.knownEntities || [])];
        if (response.known_entity_updates) {
            for (const update of response.known_entity_updates) {
                const existingIdx = updatedKnownEntities.findIndex(e => e.id === update.id || e.name === update.name);
                if (existingIdx >= 0) {
                    updatedKnownEntities[existingIdx] = update;
                } else {
                    updatedKnownEntities.push(update);
                }
            }
        }

        // 8. Lore & Memory Pipeline

        // --- Lore ---
        // Pass through to LoreApprovalModal for user review; dedup happens there
        const pendingLore: LoreItem[] = response.new_lore ? [{
            id: generateLoreId(),
            keyword: response.new_lore.keyword,
            content: response.new_lore.content,
            timestamp: new Date().toISOString()
        }] : [];
        
        if (response.new_lore) {
             debugLogs.push({ timestamp: new Date().toISOString(), message: `Pending Lore Generated: "${response.new_lore.keyword}"`, type: 'info' });
        }

        // --- Memory (with semantic deduplication) ---
        let finalMemory = [...currentWorld.memory];
        if (response.new_memory) {
            const { isDuplicate, isUpdate, existingIndex } = checkMemoryDuplicate(
                response.new_memory.fact,
                currentWorld.memory
            );

            if (isDuplicate) {
                debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: `[MEMORY] Duplicate fragment suppressed (matches fragment #${existingIndex}): "${response.new_memory.fact.substring(0, 80)}"`,
                    type: 'info'
                });
            } else if (isUpdate) {
                // New fact is more specific — replace the existing one
                const updated = [...currentWorld.memory];
                updated[existingIndex] = {
                    id: updated[existingIndex].id, // preserve original ID
                    fact: response.new_memory.fact,
                    timestamp: new Date().toISOString()
                };
                finalMemory = updated;
                debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: `[MEMORY] Fragment updated (supersedes #${existingIndex}): "${response.new_memory.fact.substring(0, 80)}"`,
                    type: 'success'
                });
            } else {
                finalMemory = [...currentWorld.memory, {
                    id: generateMemoryId(),
                    fact: response.new_memory.fact,
                    timestamp: new Date().toISOString()
                }];
                debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: `[MEMORY] Engram Created: "${response.new_memory.fact.substring(0, 80)}"`,
                    type: 'success'
                });
            }
        }

        // --- Banned Name Validation ---
        const { bannedNameViolations } = validateResponse(response);
        if (bannedNameViolations.length > 0) {
            debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[⚠ BANNED NAME VIOLATION] AI used forbidden name(s): ${bannedNameViolations.join(', ')} — check narrative for [RENAME:X] markers`,
                type: 'warning'
            });
        }

        // 9. Thought Process
        if (response.thought_process) {
            debugLogs.unshift({ timestamp: new Date().toISOString(), message: `[AI THOUGHT]: ${response.thought_process}`, type: 'info' });
        }
        
        // 9.5 World Tick Pipeline (v1.1: Proactive World)
        const worldTick = response.world_tick;
        let lastWorldTickTurn = currentWorld.lastWorldTickTurn ?? 0;

        if (worldTick) {
            // Check for meaningful activity (visible or hidden)
            const hasActivity = (worldTick.npc_actions && worldTick.npc_actions.length > 0) || 
                               (worldTick.environment_changes && worldTick.environment_changes.length > 0) || 
                               (worldTick.emerging_threats && worldTick.emerging_threats.length > 0);
            
            if (hasActivity) {
                lastWorldTickTurn = currentTurn;
            }

            // Hidden NPC actions feed into the registry
            const hiddenActions = worldTick.npc_actions.filter(a => !a.player_visible);
            for (const action of hiddenActions) {
                newHiddenRegistry += `\n[${newTime.display}] [WORLD-TICK] ${action.npc_name}: ${action.action}`;
            }
            
            // Visible NPC actions get debug logs
            const visibleActions = worldTick.npc_actions.filter(a => a.player_visible);
            for (const action of visibleActions) {
                debugLogs.push({ 
                    timestamp: new Date().toISOString(), 
                    message: `[WORLD] ${action.npc_name}: ${action.action}`, 
                    type: 'info' 
                });
            }
            if (hiddenActions.length > 0) {
                debugLogs.push({ 
                    timestamp: new Date().toISOString(), 
                    message: `[WORLD] ${hiddenActions.length} hidden NPC action(s) logged to registry.`, 
                    type: 'info' 
                });
            }
            
            // Environment changes get debug logs
            for (const change of worldTick.environment_changes) {
                debugLogs.push({ 
                    timestamp: new Date().toISOString(), 
                    message: `[ENV] ${change}`, 
                    type: 'info' 
                });
            }
            
            // Emerging threats get logged and fed into registry for AI context
            for (const threat of worldTick.emerging_threats) {
                const eta = threat.turns_until_impact !== undefined 
                    ? ` (ETA: ~${threat.turns_until_impact} turns)` 
                    : '';
                newHiddenRegistry += `\n[${newTime.display}] [EMERGING] ${threat.description}${eta}`;
                debugLogs.push({ 
                    timestamp: new Date().toISOString(), 
                    message: `[THREAT SEED] ${threat.description}${eta}`, 
                    type: 'warning' 
                });
            }
        }

        // 10. Final State Assembly
        
        // --- Condition Pipeline ---
        // Merge: Original + Bio Added - Bio Removed
        let finalConditions = [...character.conditions];
        if (bioResult.removedConditions.length > 0) {
            finalConditions = finalConditions.filter(c => !bioResult.removedConditions.includes(c));
            bioResult.removedConditions.forEach(c => debugLogs.push({ timestamp: new Date().toISOString(), message: `[BIO-RECOVERY] Condition Cleared: ${c}`, type: 'success' }));
        }
        bioResult.addedConditions.forEach(c => {
            if (!finalConditions.includes(c)) finalConditions.push(c);
        });

        // --- Timed Condition Expiry ---
        // Build/update conditionTimestamps: stamp any newly added conditions with the current time
        const updatedTimestamps: Record<string, number> = { ...(character.conditionTimestamps ?? {}) };
        // Stamp new conditions that were just added this turn
        for (const c of bioResult.addedConditions) {
            if (!(c in updatedTimestamps)) {
                updatedTimestamps[c] = newTime.totalMinutes;
            }
        }
        // Also stamp conditions the AI added via character_updates (already merged into finalConditions)
        for (const c of finalConditions) {
            if (!(c in updatedTimestamps)) {
                updatedTimestamps[c] = newTime.totalMinutes;
            }
        }
        // Expire timed conditions whose duration has elapsed
        const expiredConditions = findExpiredConditions(finalConditions, updatedTimestamps, newTime.totalMinutes);
        if (expiredConditions.length > 0) {
            finalConditions = finalConditions.filter(c => !expiredConditions.includes(c));
            expiredConditions.forEach(c => {
                delete updatedTimestamps[c];
                debugLogs.push({ timestamp: new Date().toISOString(), message: `[TIMED-EXPIRY] Condition Elapsed: ${c}`, type: 'success' });
            });
        }
        // Remove timestamps for conditions that are no longer active
        for (const key of Object.keys(updatedTimestamps)) {
            if (!finalConditions.includes(key)) delete updatedTimestamps[key];
        }

        // --- Bio Modifier Passive Decay ---
        // Modifiers set by the AI during exertion/combat gradually return to 1.0
        // unless held in place by an active condition that justified them.
        const decayedModifiers = decayBioModifiers(bioResult.bio.modifiers);
        const modifiersChanged = JSON.stringify(decayedModifiers) !== JSON.stringify(bioResult.bio.modifiers);
        if (modifiersChanged) {
            debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[BIO-DECAY] Modifiers decaying toward baseline: cal×${decayedModifiers.calories.toFixed(2)} hyd×${decayedModifiers.hydration.toFixed(2)} sta×${decayedModifiers.stamina.toFixed(2)}`,
                type: 'info'
            });
        }

        const finalTrauma = Math.min(100, Math.max(0, (character.trauma || 0) + bioResult.traumaDelta));

        return {
            worldUpdate: {
                ...currentWorld,
                time: newTime,
                lore: currentWorld.lore, // Lore updates are pending user approval
                memory: finalMemory,
                hiddenRegistry: trimHiddenRegistry(newHiddenRegistry),
                pregnancies: currentPregnancies,
                activeThreats: nextThreats,
                environment: nextEnv,
                knownEntities: updatedKnownEntities,
                sceneMode: response.scene_mode || 'NARRATIVE',
                tensionLevel: tensionLevel,
                lastWorldTickTurn // Added v1.1
            },
            characterUpdate: {
                ...character,
                bio: {
                    ...bioResult.bio,
                    modifiers: decayedModifiers,
                },
                conditions: finalConditions,
                conditionTimestamps: updatedTimestamps,
                trauma: finalTrauma
            },
            debugLogs,
            pendingLore
        };
    }
};