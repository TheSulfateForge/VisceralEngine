import { ModelResponseSchema, GameWorld, DebugLogEntry, LoreItem, Character, BioMonitor, MemoryItem } from '../types';
import { ReproductionSystem } from './reproductionSystem';
import { generateLoreId, generateMemoryId } from '../idUtils';

interface SimulationResult {
    worldUpdate: GameWorld;
    characterUpdate: Character;
    debugLogs: DebugLogEntry[];
}

const TICK_RATES = {
    // 100 / 1.0 = 100 hours (~4 days) to empty. 
    // Was 1.8 (55 hours). Slower burn prevents starvation loops.
    CALORIES_PER_HOUR: 1.0,      
    
    // 100 / 1.5 = ~66 hours (~2.7 days) to empty. 
    // Was 3.5 (28 hours). Prevents instant dehydration on large time skips.
    WATER_PER_HOUR: 1.5,        
    
    // 100 / 5.0 = 20 hours to exhaustion.
    // Was 6.0. Slightly more generous daily cycle.
    STAMINA_PER_HOUR: 5.0,       
    
    // 100 / 5.0 = 20 hours (Painful if not tended to daily)
    // Kept high as it's a core mechanic.
    LACTATION_PER_HOUR: 5.0,   
    
    LIBIDO_PER_HOUR: 0.5,
    SEMINAL_PER_HOUR: 2.0
};

// --- FIX 1: Time Clamp Caps ---
// Gemini sometimes dumps "retrospective time" (entire off-screen days) into
// a single turn. These caps prevent any single tick from nuking biology.
const TIME_CAPS = {
    AWAKE_MAX: 120,   // 2 hours — longest reasonable non-sleep scene beat
    SLEEP_MAX: 540,   // 9 hours — generous full night's rest
    COMBAT_MAX: 30,   // 30 minutes — combat rounds are short
};

// --- Time System ---
const updateTime = (currentMinutes: number, delta: number) => {
    const totalMinutes = currentMinutes + delta;
    const day = Math.floor(totalMinutes / 1440) + 1;
    const hour = Math.floor((totalMinutes % 1440) / 60);
    const minute = totalMinutes % 60;
    const display = `Day ${day}, ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    return { totalMinutes, day, hour, minute, display };
};

// --- Bio Engine ---
const processBiology = (char: Character, minutes: number, inputs?: any): { updatedBio: BioMonitor, logs: string[], addedConditions: string[], removedConditions: string[], traumaDelta: number } => {
    // Deep copy to prevent mutation of state references
    // Fallback provided to prevent JSON.parse errors if char.bio is undefined
    const bio: BioMonitor = char.bio ? JSON.parse(JSON.stringify(char.bio)) : {
        metabolism: { calories: 80, hydration: 80, stamina: 100, libido: 5 },
        pressures: { bladder: 0, bowels: 0, lactation: 0, seminal: 0 },
        timestamps: { lastSleep: 0, lastMeal: 0, lastOrgasm: 0 },
        modifiers: { calories: 1.0, hydration: 1.0, stamina: 1.0, lactation: 1.0 }
    };
    
    // Ensure nested objects exist (migration safety)
    if (!bio.metabolism) bio.metabolism = { calories: 80, hydration: 80, stamina: 100, libido: 5 };
    if (!bio.pressures) bio.pressures = { bladder: 0, bowels: 0, lactation: 0, seminal: 0 };
    if (!bio.modifiers) bio.modifiers = { calories: 1.0, hydration: 1.0, stamina: 1.0, lactation: 1.0 };
    if (!bio.timestamps) bio.timestamps = { lastSleep: 0, lastMeal: 0, lastOrgasm: 0 };
    
    const logs: string[] = [];
    const addedConditions: string[] = [];
    const removedConditions: string[] = [];
    let traumaDelta = 0;

    // CRITICAL FIX: If no time passed (0 minutes), metabolism is frozen.
    // This prevents "Ghost Drain" during system errors or instant actions.
    if (minutes <= 0 && !inputs) {
        return { updatedBio: bio, logs, addedConditions, removedConditions, traumaDelta };
    }

    const hours = minutes / 60;

    // --- FIX 2: Sleep Decay Reduction ---
    // Body at rest burns resources at 40% rate. Prevents waking up dehydrated
    // after a healthy 8-hour sleep (was draining 12 hydration per night).
    const isSleeping = inputs?.sleep_hours && inputs.sleep_hours > 0;
    const sleepFactor = isSleeping ? 0.4 : 1.0;

    // 1. Inputs (Replenishment)
    if (inputs) {
        if (inputs.ingested_calories) {
            // Slight boost to calorie efficiency
            bio.metabolism.calories = Math.min(100, bio.metabolism.calories + (inputs.ingested_calories / 15));
            logs.push(`Replenished: Calories (${inputs.ingested_calories})`);
            bio.timestamps.lastMeal = Date.now(); 
        }
        if (inputs.ingested_water) {
            // FIX: Removed the divisor. 1 Unit Input = 1 Unit Hydration.
            // This ensures drinking actually combats the decay rate.
            bio.metabolism.hydration = Math.min(100, bio.metabolism.hydration + inputs.ingested_water);
            logs.push(`Replenished: Hydration (+${inputs.ingested_water})`);
        }
        if (inputs.sleep_hours) {
            bio.metabolism.stamina = 100;
            logs.push(`Restored: Stamina (Full)`);
            bio.timestamps.lastSleep = Date.now();
        }
        if (inputs.relieved_pressure) {
            inputs.relieved_pressure.forEach((p: string) => {
                if (p === 'lactation') bio.pressures.lactation = 0;
                if (p === 'bladder') bio.pressures.bladder = 0;
                if (p === 'seminal') bio.pressures.seminal = 0;
                logs.push(`Relieved Pressure: ${p}`);
            });
        }
    }

    // 2. Decay (Entropy) with Dynamic Modifiers + Sleep Factor
    const calRate = TICK_RATES.CALORIES_PER_HOUR * (bio.modifiers.calories ?? 1.0);
    const hydRate = TICK_RATES.WATER_PER_HOUR * (bio.modifiers.hydration ?? 1.0);
    const staRate = TICK_RATES.STAMINA_PER_HOUR * (bio.modifiers.stamina ?? 1.0);
    const lacRate = TICK_RATES.LACTATION_PER_HOUR * (bio.modifiers.lactation ?? 1.0);

    bio.metabolism.calories = Math.max(0, bio.metabolism.calories - (hours * calRate * sleepFactor));
    bio.metabolism.hydration = Math.max(0, bio.metabolism.hydration - (hours * hydRate * sleepFactor));
    
    // Stamina: skip decay entirely during sleep (it's being restored above)
    if (!isSleeping) {
        bio.metabolism.stamina = Math.max(0, bio.metabolism.stamina - (hours * staRate));
    }
    
    // 3. Accumulation (Pressure) — lactation still builds during sleep (biology doesn't stop)
    if (char.gender.toLowerCase().includes('female') || char.conditions.includes('Lactating')) {
        bio.pressures.lactation = Math.min(120, bio.pressures.lactation + (hours * lacRate));
    }
    
    // 4. Consequence Thresholds & Recovery Logic (The Gatekeeper)
    
    // --- Hydration ---
    if (bio.metabolism.hydration < 5) {
        addedConditions.push('Critical Dehydration');
        traumaDelta += (0.5 * hours);
    } else if (bio.metabolism.hydration < 25) {
        addedConditions.push('Severe Dehydration');
    } else if (bio.metabolism.hydration < 50) {
        addedConditions.push('Thirsty');
    }

    // Hydration Recovery (Auto-Remove Conditions)
    if (bio.metabolism.hydration > 10) removedConditions.push('Critical Dehydration');
    if (bio.metabolism.hydration > 30) removedConditions.push('Severe Dehydration');
    if (bio.metabolism.hydration > 60) removedConditions.push('Thirsty');
    
    // --- Calories ---
    if (bio.metabolism.calories < 5) {
        addedConditions.push('Starving');
        traumaDelta += (0.2 * hours);
    } else if (bio.metabolism.calories < 30) {
        addedConditions.push('Hungry');
    }

    // Calorie Recovery
    if (bio.metabolism.calories > 10) removedConditions.push('Starving');
    if (bio.metabolism.calories > 40) removedConditions.push('Hungry');

    // --- Stamina ---
    if (bio.metabolism.stamina < 5) {
        addedConditions.push('Exhausted');
        traumaDelta += (0.1 * hours);
    }

    // Stamina Recovery
    if (bio.metabolism.stamina > 20) removedConditions.push('Exhausted');

    // --- Lactation ---
    if (bio.pressures.lactation > 100) {
        addedConditions.push('Agonizing Engorgement');
        addedConditions.push('Leaking');
        traumaDelta += (0.1 * hours);
    } else if (bio.pressures.lactation > 75) {
        addedConditions.push('Swollen Breasts');
    }

    // Lactation Recovery
    if (bio.pressures.lactation < 90) {
        removedConditions.push('Agonizing Engorgement');
    }
    if (bio.pressures.lactation < 60) {
        removedConditions.push('Swollen Breasts');
    }

    return { updatedBio: bio, logs, addedConditions, removedConditions, traumaDelta };
};


export const SimulationEngine = {
    processTurn: (
        response: ModelResponseSchema, 
        currentWorld: GameWorld, 
        character: Character,
        currentTurn: number
    ): SimulationResult => {
        const debugLogs: DebugLogEntry[] = [];
        let currentPregnancies = currentWorld.pregnancies || [];
        
        // 1. Time Progression — WITH CLAMP (FIX 1)
        const hasSleep = response.biological_inputs?.sleep_hours && response.biological_inputs.sleep_hours > 0;
        const isCombat = response.scene_mode === 'COMBAT';

        let maxAllowed: number;
        if (hasSleep) {
            maxAllowed = TIME_CAPS.SLEEP_MAX;
        } else if (isCombat) {
            maxAllowed = TIME_CAPS.COMBAT_MAX;
        } else {
            maxAllowed = TIME_CAPS.AWAKE_MAX;
        }

        const rawDelta = response.time_passed_minutes !== undefined ? response.time_passed_minutes : 0;
        const timeDelta = Math.min(Math.max(0, rawDelta), maxAllowed);

        if (rawDelta > maxAllowed) {
            debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[TIME-CLAMP] AI requested +${rawDelta}m, clamped to +${timeDelta}m (cap: ${maxAllowed}, sleep: ${!!hasSleep}, combat: ${isCombat})`,
                type: 'warning' as any
            });
        }
        
        const newTime = updateTime(currentWorld.time.totalMinutes, timeDelta);
        
        if (timeDelta > 0) {
            debugLogs.push({ timestamp: new Date().toISOString(), message: `Time Advancement: +${timeDelta}m -> ${newTime.display}`, type: 'info' });
        }

        // 2. Biological Simulation
        const bioResult = processBiology(character, timeDelta, response.biological_inputs);
        const newBio = bioResult.updatedBio;
        bioResult.logs.forEach(l => debugLogs.push({ timestamp: new Date().toISOString(), message: `[BIO] ${l}`, type: 'success' }));
        
        // Merge bio-conditions with character
        let updatedConditions = [...character.conditions];
        
        // FIX: Prioritize removal before addition to prevent sticky conditions
        if (bioResult.removedConditions.length > 0) {
            updatedConditions = updatedConditions.filter(c => !bioResult.removedConditions.includes(c));
            bioResult.removedConditions.forEach(c => debugLogs.push({ timestamp: new Date().toISOString(), message: `[BIO-RECOVERY] Condition Cleared: ${c}`, type: 'success' }));
        }
        
        bioResult.addedConditions.forEach(c => {
            if (!updatedConditions.includes(c)) updatedConditions.push(c);
        });

        // Apply Biological Trauma
        let newTrauma = (character.trauma || 0) + bioResult.traumaDelta;
        
        // 3. Log Hidden Updates
        let newHiddenRegistry = response.hidden_update 
            ? `${currentWorld.hiddenRegistry}\n[${newTime.display}] ${response.hidden_update}`
            : currentWorld.hiddenRegistry;

        // 4. Advance Pregnancies
        const progressResult = ReproductionSystem.advancePregnancies(currentPregnancies, currentTurn);
        currentPregnancies = progressResult.updated;
        progressResult.logs.forEach(log => {
            newHiddenRegistry += `\n[SYSTEM-AUTO] ${log}`;
            debugLogs.push({ timestamp: new Date().toISOString(), message: log, type: 'info' });
        });

        // 5. Conception Logic
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

        // 6. Combat/Environment Context
        let nextThreats = currentWorld.activeThreats;
        let nextEnv = currentWorld.environment;

        if (response.combat_context) {
            nextThreats = response.combat_context.active_threats;
            nextEnv = response.combat_context.environment;
        } else if (response.scene_mode === 'SOCIAL' || response.scene_mode === 'NARRATIVE') {
            nextThreats = [];
        }

        // 7. Known Entity Updates
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

        // 8. New Lore
        const newLore: LoreItem[] = response.new_lore ? [{
            id: generateLoreId(),
            keyword: response.new_lore.keyword,
            content: response.new_lore.content,
            timestamp: new Date().toISOString()
        }] : [];

        // 9. New Memory (Long-term history)
        const newMemory: MemoryItem[] = response.new_memory ? [{
            id: generateMemoryId(),
            fact: response.new_memory.fact,
            timestamp: new Date().toISOString()
        }] : [];
        
        if (response.new_memory) {
            debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `Memory Engram Created: "${response.new_memory.fact}"`,
                type: 'success'
            });
        }

        // 10. AI Thought Log
        if (response.thought_process) {
            debugLogs.unshift({ 
                timestamp: new Date().toISOString(), 
                message: `[AI THOUGHT]: ${response.thought_process}`, 
                type: 'info' 
            });
        }

        return {
            worldUpdate: {
                ...currentWorld,
                time: newTime,
                lore: [...currentWorld.lore, ...newLore],
                memory: [...currentWorld.memory, ...newMemory],
                hiddenRegistry: newHiddenRegistry,
                pregnancies: currentPregnancies,
                activeThreats: nextThreats,
                environment: nextEnv,
                knownEntities: updatedKnownEntities,
                sceneMode: response.scene_mode || 'NARRATIVE',
                tensionLevel: response.tension_level ?? currentWorld.tensionLevel
            },
            characterUpdate: {
                ...character,
                bio: newBio,
                conditions: updatedConditions,
                trauma: Math.min(100, Math.max(0, newTrauma)) // Ensure bounds
            },
            debugLogs
        };
    }
};
