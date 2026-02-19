/**
 * bioEngine.ts — v1.3
 *
 * v1.3 changes:
 *   - applyCeilings() is called on modifiers before they are stored, preventing
 *     the AI from pushing stamina above 1.5x or calories/hydration above 2.0x.
 *   - BioEngine.tick() now accepts a sceneMode parameter. When sceneMode is
 *     NARRATIVE and a modifier is above 1.1, decay runs at 3× normal rate
 *     (post-combat accelerated recovery).
 */

import { Character, BioMonitor, BioInputs } from '../types';
import { applyCeilings } from './contentValidation';

interface BioRates {
    CALORIES: number;
    WATER: number;
    STAMINA: number;
    LACTATION: number;
}

// Metabolic Decay Rates (per hour)
const RATES: BioRates = {
    CALORIES: 1.0,
    WATER: 1.5,
    STAMINA: 5.0,
    LACTATION: 5.0,
};

export interface BioResult {
    bio: BioMonitor;
    logs: string[];
    addedConditions: string[];
    removedConditions: string[];
    traumaDelta: number;
}

const cloneBio = (input?: BioMonitor): BioMonitor => {
    const base: BioMonitor = input ? JSON.parse(JSON.stringify(input)) : {};
    return {
        metabolism: { calories: 80, hydration: 80, stamina: 100, libido: 5, ...base.metabolism },
        pressures: { bladder: 0, bowels: 0, lactation: 0, seminal: 0, ...base.pressures },
        timestamps: { lastSleep: 0, lastMeal: 0, lastOrgasm: 0, ...base.timestamps },
        modifiers: { calories: 1.0, hydration: 1.0, stamina: 1.0, lactation: 1.0, ...base.modifiers }
    };
};

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

const drainMetabolism = (
    bio: BioMonitor,
    hours: number,
    isSleeping: boolean,
    tensionLevel: number
): void => {
    const sleepFactor = isSleeping ? 0.4 : 1.0;

    const calRate = RATES.CALORIES * (bio.modifiers.calories ?? 1.0);
    const hydRate = RATES.WATER * (bio.modifiers.hydration ?? 1.0);

    const tensionStaminaMod = tensionLevel > 70 ? ((tensionLevel - 70) / 30) * 5 : 0;
    const staRate = (RATES.STAMINA * (bio.modifiers.stamina ?? 1.0)) + tensionStaminaMod;

    bio.metabolism.calories = Math.max(0, bio.metabolism.calories - (hours * calRate * sleepFactor));
    bio.metabolism.hydration = Math.max(0, bio.metabolism.hydration - (hours * hydRate * sleepFactor));

    if (!isSleeping) {
        bio.metabolism.stamina = Math.max(0, bio.metabolism.stamina - (hours * staRate));
    }
};

const accumulatePressures = (bio: BioMonitor, char: Character, hours: number): void => {
    const lacRate = RATES.LACTATION * (bio.modifiers.lactation ?? 1.0);

    if (char.conditions.includes('Lactating')) {
        bio.pressures.lactation = Math.min(120, bio.pressures.lactation + (hours * lacRate));
    }
};

const GRACE_FACTOR = 0.6;

const evaluateThresholds = (
    bio: BioMonitor,
    hours: number,
    playerRemovedConditions: string[] = []
): { added: string[], trauma: number } => {
    const added: string[] = [];
    let trauma = 0;

    const gracedOut = (condition: string) => playerRemovedConditions.includes(condition);

    if (bio.metabolism.hydration < 5) {
        added.push('Critical Dehydration');
        trauma += (0.5 * hours);
    } else if (bio.metabolism.hydration < (gracedOut('Severe Dehydration') ? 25 * GRACE_FACTOR : 25)) {
        added.push('Severe Dehydration');
    } else if (bio.metabolism.hydration < (gracedOut('Thirsty') ? 50 * GRACE_FACTOR : 50)) {
        added.push('Thirsty');
    }

    if (bio.metabolism.calories < 5) {
        added.push('Starving');
        trauma += (0.2 * hours);
    } else if (bio.metabolism.calories < (gracedOut('Hungry') ? 30 * GRACE_FACTOR : 30)) {
        added.push('Hungry');
    }

    if (bio.metabolism.stamina < (gracedOut('Exhausted') ? 5 * GRACE_FACTOR : 5)) {
        added.push('Exhausted');
        trauma += (0.1 * hours);
    }

    if (bio.pressures.lactation > 100) {
        added.push('Agonizing Engorgement', 'Leaking');
        trauma += (0.1 * hours);
    } else if (bio.pressures.lactation > (gracedOut('Swollen Breasts') ? 75 / GRACE_FACTOR : 75)) {
        added.push('Swollen Breasts');
    }

    return { added, trauma };
};

const applyRecovery = (bio: BioMonitor, activeConditions: string[]): { removed: string[] } => {
    const has = (c: string) => activeConditions.includes(c);
    const removed: string[] = [];

    if (has('Critical Dehydration') && bio.metabolism.hydration > 10) removed.push('Critical Dehydration');
    if (has('Severe Dehydration') && bio.metabolism.hydration > 30) removed.push('Severe Dehydration');
    if (has('Thirsty') && bio.metabolism.hydration > 60) removed.push('Thirsty');

    if (has('Starving') && bio.metabolism.calories > 10) removed.push('Starving');
    if (has('Hungry') && bio.metabolism.calories > 40) removed.push('Hungry');

    if (has('Exhausted') && bio.metabolism.stamina > 20) removed.push('Exhausted');

    if (has('Agonizing Engorgement') && bio.pressures.lactation < 90) removed.push('Agonizing Engorgement');
    if (has('Swollen Breasts') && bio.pressures.lactation < 60) removed.push('Swollen Breasts');

    return { removed };
};

export const BioEngine = {
    /**
     * @param character               Current character state
     * @param minutes                 Time elapsed this turn (in minutes)
     * @param tensionLevel            Current scene tension (0-100)
     * @param inputs                  Biological inputs from AI (food/water/sleep)
     * @param playerRemovedConditions Conditions the player manually cleared this turn
     * @param sceneMode               Current scene mode — used for accelerated decay in NARRATIVE
     */
    tick(
        character: Character,
        minutes: number,
        tensionLevel: number,
        inputs?: BioInputs,
        playerRemovedConditions: string[] = [],
        sceneMode: string = 'NARRATIVE'
    ): BioResult {
        const bio = cloneBio(character.bio);

        // v1.3: Apply modifier ceilings on entry — the AI cannot exceed these values
        bio.modifiers = applyCeilings(bio.modifiers);

        const logs: string[] = [];

        const hours = minutes / 60;
        if (hours <= 0) return { bio, logs: ['No time passed.'], addedConditions: [], removedConditions: [], traumaDelta: 0 };

        const isSleeping = (inputs?.sleep_hours ?? 0) > 0;

        if (inputs) {
            processIngestion(bio, inputs, logs);
        }

        drainMetabolism(bio, hours, isSleeping, tensionLevel);
        accumulatePressures(bio, character, hours);

        const { added, trauma } = evaluateThresholds(bio, hours, playerRemovedConditions);
        const { removed } = applyRecovery(bio, character.conditions);

        // v1.3: Accelerated modifier decay when transitioning to NARRATIVE after combat.
        // Any modifier above 1.1 decays at 3× speed to prevent combat buffs from
        // persisting indefinitely into downtime scenes.
        if (sceneMode === 'NARRATIVE') {
            const mods = bio.modifiers;
            const accel = (val: number): number => {
                if (val === 0) return 0; // Zero disables the system — preserve it
                if (val > 1.1) return Math.max(1.0, val - 0.05 * 3);
                return val;
            };
            bio.modifiers = {
                calories:  accel(mods.calories),
                hydration: accel(mods.hydration),
                stamina:   accel(mods.stamina),
                lactation: accel(mods.lactation),
            };
        }

        return {
            bio,
            logs,
            addedConditions: added,
            removedConditions: removed,
            traumaDelta: trauma
        };
    }
};
