
// ============================================================================
// HOOKS/CORE.TS - Core React Hooks
// ============================================================================

import { useState, useCallback } from 'react';
import { 
  RollRequest, 
  RollStatistics
} from '../types';
import {
  executeDiceRoll,
  getRollOutcome,
  formatModifier
} from '../utils';

// ============================================================================
// ROLL SYSTEM HOOK (STATELESS)
// ============================================================================

export const useRollSystem = () => {
  const executeRoll = useCallback((request: RollRequest, currentStats: RollStatistics) => {
    const { final, advText } = executeDiceRoll(
      request.advantage,
      request.disadvantage
    );

    const modifier = request.bonus || 0;
    const total = final + modifier;
    const outcome = getRollOutcome(total);

    // Calculate new statistics based on current stats + this roll
    const newTotal = currentStats.totalRolls + 1;
    const newAverage = ((currentStats.averageRoll * currentStats.totalRolls) + final) / newTotal;

    const newStats: RollStatistics = {
      totalRolls: newTotal,
      criticalSuccesses: currentStats.criticalSuccesses + (outcome === 'CRITICAL SUCCESS' ? 1 : 0),
      criticalFailures: currentStats.criticalFailures + (outcome === 'CRITICAL FAILURE' ? 1 : 0),
      averageRoll: newAverage,
      outcomes: {
        ...currentStats.outcomes,
        [outcome]: currentStats.outcomes[outcome] + 1,
      },
    };

    const logEntry = `${request.challenge}: d20(${final})${advText}${formatModifier(modifier)} = ${total} [${outcome}]`;

    return {
      final,
      total,
      outcome,
      logEntry,
      advText,
      newStats
    };
  }, []);

  return {
    executeRoll,
  };
};
