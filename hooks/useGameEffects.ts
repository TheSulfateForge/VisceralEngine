
import { useEffect, useRef } from 'react';
import { useGameStore } from '../store';
import { getConditionSeverity } from '../utils';

export const useGameEffects = () => {
    const { character, setPulseSeverity, setIsPulsing } = useGameStore();
    const prevConditionsRef = useRef<string[]>([]);

    // Pulse Effect for Conditions
    useEffect(() => {
        const conditions = character.conditions || [];
        if (JSON.stringify(prevConditionsRef.current) !== JSON.stringify(conditions)) {
            if (conditions.length > 0) {
                let maxSev: 'none' | 'lethal' | 'traumatic' | 'minor' = 'minor';
                
                for (const c of conditions) {
                    const s = getConditionSeverity(c);
                    if (s === 'lethal') { maxSev = 'lethal'; break; }
                    if (s === 'traumatic') maxSev = 'traumatic';
                }
                setPulseSeverity(maxSev);
                setIsPulsing(true);
                setTimeout(() => setIsPulsing(false), 5000);
            }
            prevConditionsRef.current = conditions;
        }
    }, [character.conditions, setPulseSeverity, setIsPulsing]);
};
