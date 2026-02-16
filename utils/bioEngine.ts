
import { Character, BioMonitor, BioInputs } from '../types';

interface BioRates {
    CALORIES: number;
    WATER: number;
    STAMINA: number;
    LACTATION: number;
}

// Metabolic Decay Rates (per hour)
const RATES: BioRates = {
    CALORIES: 1.0,  // ~100 hours to starvation
    WATER: 1.5,     // ~66 hours to dehydration
    STAMINA: 5.0,   // ~20 hours to exhaustion
    LACTATION: 5.0, // ~20 hours to pain
};

export interface BioResult {
    bio: BioMonitor;
    logs: string[];
    addedConditions: string[];
    removedConditions: string[];
    traumaDelta: number;
}

/**
 * Pure function to clone bio state to avoid mutation side-effects on the input.
 * Ensures all nested objects exist.
 */
const cloneBio = (input?: BioMonitor): BioMonitor => {
    const base: BioMonitor = input ? JSON.parse(JSON.stringify(input)) : {};
    return {
        metabolism: { calories: 80, hydration: 80, stamina: 100, libido: 5, ...base.metabolism },
        pressures: { bladder: 0, bowels: 0, lactation: 0, seminal: 0, ...base.pressures },
        timestamps: { lastSleep: 0, lastMeal: 0, lastOrgasm: 0, ...base.timestamps },
        modifiers: { calories: 1.0, hydration: 1.0, stamina: 1.0, lactation: 1.0, ...base.modifiers }
    };
};

/**
 * Phase 1: Ingest Inputs (Replenishment)
 * Handles food, water, sleep, and pressure relief instructions from the AI.
 */
const processIngestion = (bio: BioMonitor, inputs: BioInputs, logs: string[]): void => {
    if (inputs.ingested_calories) {
        bio.metabolism.calories = Math.min(100, bio.metabolism.calories + (inputs.ingested_calories / 15));
        logs.push(`Replenished: Calories (${inputs.ingested_calories})`);
        bio.timestamps.lastMeal = Date.now();
    }
    
    if (inputs.ingested_water) {
        bio.metabolism.hydration = Math.min(100, bio.metabolism.hydration + inputs.ingested_water);
        logs.push(`Replenished: Hydration (+${inputs.ingested_water})`);
    }
    
    if (inputs.sleep_hours && inputs.sleep_hours > 0) {
        bio.metabolism.stamina = 100;
        logs.push(`Restored: Stamina (Full)`);
        bio.timestamps.lastSleep = Date.now();
    }
    
    if (inputs.relieved_pressure) {
        inputs.relieved_pressure.forEach(p => {
            if (p === 'lactation') bio.pressures.lactation = 0;
            if (p === 'bladder') bio.pressures.bladder = 0;
            if (p === 'seminal') bio.pressures.seminal = 0;
            logs.push(`Relieved Pressure: ${p}`);
        });
    }
};

/**
 * Phase 2: Metabolic Drain (Entropy)
 * Calculates resource loss based on time passed, modifiers, and sleep state.
 */
const drainMetabolism = (
    bio: BioMonitor, 
    hours: number, 
    isSleeping: boolean,
    tensionLevel: number
): void => {
    const sleepFactor = isSleeping ? 0.4 : 1.0;
    
    // Calculate effective rates with modifiers
    const calRate = RATES.CALORIES * (bio.modifiers.calories ?? 1.0);
    const hydRate = RATES.WATER * (bio.modifiers.hydration ?? 1.0);
    
    // Tension scaling: If tension > 70, stamina drains faster (adrenaline fatigue)
    // Scale: 0 at 70 tension, +5.0 at 100 tension
    const tensionStaminaMod = tensionLevel > 70 ? ((tensionLevel - 70) / 30) * 5 : 0;
    const staRate = (RATES.STAMINA * (bio.modifiers.stamina ?? 1.0)) + tensionStaminaMod;

    // Apply drain
    bio.metabolism.calories = Math.max(0, bio.metabolism.calories - (hours * calRate * sleepFactor));
    bio.metabolism.hydration = Math.max(0, bio.metabolism.hydration - (hours * hydRate * sleepFactor));
    
    // Stamina does not decay during sleep (it restores)
    if (!isSleeping) {
        bio.metabolism.stamina = Math.max(0, bio.metabolism.stamina - (hours * staRate));
    }
};

/**
 * Phase 3: Pressure Accumulation
 * Biological pressures that build up over time regardless of activity.
 */
const accumulatePressures = (bio: BioMonitor, char: Character, hours: number): void => {
    const lacRate = RATES.LACTATION * (bio.modifiers.lactation ?? 1.0);
    
    // Biology continues during sleep. Checks gender and condition tags.
    if (char.gender.toLowerCase().includes('female') || char.conditions.includes('Lactating')) {
        bio.pressures.lactation = Math.min(120, bio.pressures.lactation + (hours * lacRate));
    }
};

/**
 * Phase 4: Threshold Evaluation (Consequences)
 * Checks if current values should trigger negative conditions or trauma.
 */
const evaluateThresholds = (bio: BioMonitor, hours: number): { added: string[], trauma: number } => {
    const added: string[] = [];
    let trauma = 0;

    // Hydration Thresholds
    if (bio.metabolism.hydration < 5) {
        added.push('Critical Dehydration');
        trauma += (0.5 * hours);
    } else if (bio.metabolism.hydration < 25) {
        added.push('Severe Dehydration');
    } else if (bio.metabolism.hydration < 50) {
        added.push('Thirsty');
    }

    // Calorie Thresholds
    if (bio.metabolism.calories < 5) {
        added.push('Starving');
        trauma += (0.2 * hours);
    } else if (bio.metabolism.calories < 30) {
        added.push('Hungry');
    }

    // Stamina Thresholds
    if (bio.metabolism.stamina < 5) {
        added.push('Exhausted');
        trauma += (0.1 * hours);
    }

    // Lactation Thresholds
    if (bio.pressures.lactation > 100) {
        added.push('Agonizing Engorgement', 'Leaking');
        trauma += (0.1 * hours);
    } else if (bio.pressures.lactation > 75) {
        added.push('Swollen Breasts');
    }

    return { added, trauma };
};

/**
 * Phase 5: Recovery (Healing)
 * Checks if current values are healthy enough to remove negative conditions.
 */
const applyRecovery = (bio: BioMonitor): { removed: string[] } => {
    const removed: string[] = [];

    // Hydration Recovery
    if (bio.metabolism.hydration > 10) removed.push('Critical Dehydration');
    if (bio.metabolism.hydration > 30) removed.push('Severe Dehydration');
    if (bio.metabolism.hydration > 60) removed.push('Thirsty');

    // Calorie Recovery
    if (bio.metabolism.calories > 10) removed.push('Starving');
    if (bio.metabolism.calories > 40) removed.push('Hungry');

    // Stamina Recovery
    if (bio.metabolism.stamina > 20) removed.push('Exhausted');

    // Lactation Recovery
    if (bio.pressures.lactation < 90) removed.push('Agonizing Engorgement');
    if (bio.pressures.lactation < 60) removed.push('Swollen Breasts');

    return { removed };
};

/**
 * Main Bio Engine
 */
export const BioEngine = {
    tick(character: Character, minutes: number, tensionLevel: number, inputs?: BioInputs): BioResult {
        const bio = cloneBio(character.bio);
        const logs: string[] = [];
        
        // 0. Freeze metabolism if no time passed and no inputs (prevents ghost drain)
        if (minutes <= 0 && !inputs) {
            return { bio, logs, addedConditions: [], removedConditions: [], traumaDelta: 0 };
        }

        const hours = minutes / 60;
        const isSleeping = (inputs?.sleep_hours ?? 0) > 0;

        // 1. Process Replenishment
        if (inputs) processIngestion(bio, inputs, logs);

        // 2. Process Metabolic Drain
        drainMetabolism(bio, hours, isSleeping, tensionLevel);

        // 3. Process Pressure Accumulation
        accumulatePressures(bio, character, hours);

        // 4. Evaluate Negative Thresholds
        const consequences = evaluateThresholds(bio, hours);

        // 5. Apply Recovery Logic
        const recovery = applyRecovery(bio);

        return {
            bio,
            logs,
            addedConditions: consequences.added,
            removedConditions: recovery.removed,
            traumaDelta: consequences.trauma
        };
    }
};
