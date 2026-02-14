
// ============================================================================
// UTILS/REPRODUCTIONSYSTEM.TS
// Independent Biological Tracking System
// ============================================================================

import { Pregnancy, Character } from '../types';

const BASE_PREGNANCY_CHANCE = 0.30; // 30% chance per event
const TURNS_PER_WEEK = 5; // How many narrative turns equal 1 gestation week

export const ReproductionSystem = {
    /**
     * Calculates if conception occurs based on chance.
     */
    rollForConception: (chance: number = BASE_PREGNANCY_CHANCE): boolean => {
        return Math.random() < chance;
    },

    /**
     * Creates a new pregnancy record.
     */
    initiatePregnancy: (character: Character, turnCount: number, conceptionTime: number, partnerName: string = "Unknown"): Pregnancy => {
        return {
            id: `preg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            motherName: character.gender.toLowerCase().includes('female') ? character.name : "Partner",
            fatherName: character.gender.toLowerCase().includes('female') ? partnerName : character.name,
            conceptionTurn: turnCount,
            conceptionTime: conceptionTime,
            currentWeek: 0,
            isVisible: false,
            status: 'gestating'
        };
    },

    /**
     * Advances all active pregnancies based on turn count.
     * Returns the updated list and any notable status updates (logs).
     */
    advancePregnancies: (pregnancies: Pregnancy[], currentTurn: number): { updated: Pregnancy[], logs: string[] } => {
        const logs: string[] = [];
        
        const updated = pregnancies.map(p => {
            if (p.status !== 'gestating') return p;

            // Calculate week based on elapsed turns
            const elapsedTurns = currentTurn - p.conceptionTurn;
            const newWeek = Math.floor(elapsedTurns / TURNS_PER_WEEK);

            // Check for state changes
            let changes: Partial<Pregnancy> = {};
            
            // Visibility Check (Week 12)
            if (newWeek >= 12 && !p.isVisible) {
                changes.isVisible = true;
                logs.push(`[BIO-ALERT] ${p.motherName}'s condition is now visibly noticeable (Week 12).`);
            }

            // Birth Check (Week 40)
            if (newWeek >= 40) {
                changes.status = 'birth';
                logs.push(`[BIO-ALERT] ${p.motherName} has reached full term (Week 40). Labor imminent.`);
            }

            return { ...p, currentWeek: newWeek, ...changes };
        });

        return { updated, logs };
    }
};
