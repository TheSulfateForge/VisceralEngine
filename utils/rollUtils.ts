import { ROLL_OUTCOMES } from '../constants';
import { RollOutcome } from '../types';

export const formatModifier = (modifier: number): string => {
  if (modifier === 0) return '';
  return modifier > 0 ? ` +${modifier}` : ` ${modifier}`;
};

export const getRollOutcome = (total: number): RollOutcome => {
  if (total <= (ROLL_OUTCOMES['CRITICAL FAILURE'].max || 0)) {
    return 'CRITICAL FAILURE';
  }
  if (total >= (ROLL_OUTCOMES['CRITICAL SUCCESS'].min || 20)) {
    return 'CRITICAL SUCCESS';
  }
  if (total <= (ROLL_OUTCOMES['FAILURE'].max || 0)) {
    return 'FAILURE';
  }
  if (total <= (ROLL_OUTCOMES['MIXED/COST'].max || 0)) {
    return 'MIXED/COST';
  }
  if (total <= (ROLL_OUTCOMES['SUCCESS'].max || 0)) {
    return 'SUCCESS';
  }
  return 'STRONG SUCCESS';
};

export const executeDiceRoll = (
  advantage: boolean = false,
  disadvantage: boolean = false
): { raw: number; final: number; advText: string } => {
  const roll1 = Math.floor(Math.random() * 20) + 1;
  
  if (!advantage && !disadvantage) {
    return { raw: roll1, final: roll1, advText: '' };
  }
  
  const roll2 = Math.floor(Math.random() * 20) + 1;
  
  if (advantage) {
    const final = Math.max(roll1, roll2);
    return { 
      raw: roll1, 
      final, 
      advText: ` [ADV: ${roll1}, ${roll2} → ${final}]` 
    };
  }
  
  // Disadvantage
  const final = Math.min(roll1, roll2);
  return { 
    raw: roll1, 
    final, 
    advText: ` [DIS: ${roll1}, ${roll2} → ${final}]` 
  };
};