
import { ModelResponseSchema, GameWorld, DebugLogEntry, LoreItem, Character, MemoryItem, SceneMode, WorldTime } from '../types';
import { ReproductionSystem } from './reproductionSystem';
import { BioEngine } from './bioEngine';
import { generateLoreId, generateMemoryId } from '../idUtils';

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
        currentTurn: number
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
        const bioResult = BioEngine.tick(character, timeDelta, tensionLevel, response.biological_inputs);
        
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
        const pendingLore: LoreItem[] = response.new_lore ? [{
            id: generateLoreId(),
            keyword: response.new_lore.keyword,
            content: response.new_lore.content,
            timestamp: new Date().toISOString()
        }] : [];
        
        if (response.new_lore) {
             debugLogs.push({ timestamp: new Date().toISOString(), message: `Pending Lore Generated: "${response.new_lore.keyword}"`, type: 'info' });
        }

        const newMemory: MemoryItem[] = response.new_memory ? [{
            id: generateMemoryId(),
            fact: response.new_memory.fact,
            timestamp: new Date().toISOString()
        }] : [];
        
        if (response.new_memory) {
            debugLogs.push({ timestamp: new Date().toISOString(), message: `Memory Engram Created: "${response.new_memory.fact}"`, type: 'success' });
        }

        // 9. Thought Process
        if (response.thought_process) {
            debugLogs.unshift({ timestamp: new Date().toISOString(), message: `[AI THOUGHT]: ${response.thought_process}`, type: 'info' });
        }

        // 10. Final State Assembly
        
        // Merge Conditions: Original + Bio Added - Bio Removed
        let finalConditions = [...character.conditions];
        if (bioResult.removedConditions.length > 0) {
            finalConditions = finalConditions.filter(c => !bioResult.removedConditions.includes(c));
            bioResult.removedConditions.forEach(c => debugLogs.push({ timestamp: new Date().toISOString(), message: `[BIO-RECOVERY] Condition Cleared: ${c}`, type: 'success' }));
        }
        bioResult.addedConditions.forEach(c => {
            if (!finalConditions.includes(c)) finalConditions.push(c);
        });

        const finalTrauma = Math.min(100, Math.max(0, (character.trauma || 0) + bioResult.traumaDelta));

        return {
            worldUpdate: {
                ...currentWorld,
                time: newTime,
                lore: currentWorld.lore, // Lore updates are pending user approval
                memory: [...currentWorld.memory, ...newMemory],
                hiddenRegistry: trimHiddenRegistry(newHiddenRegistry),
                pregnancies: currentPregnancies,
                activeThreats: nextThreats,
                environment: nextEnv,
                knownEntities: updatedKnownEntities,
                sceneMode: response.scene_mode || 'NARRATIVE',
                tensionLevel: tensionLevel
            },
            characterUpdate: {
                ...character,
                bio: bioResult.bio,
                conditions: finalConditions,
                trauma: finalTrauma
            },
            debugLogs,
            pendingLore
        };
    }
};
