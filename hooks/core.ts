
// ============================================================================
// HOOKS/CORE.TS - Core React Hooks
// ============================================================================

import { useState, useCallback } from 'react';
import {
  RollRequest,
  RollStatistics,
  Skill
} from '../types';
import {
  executeDiceRoll,
  getRollOutcome,
  formatModifier
} from '../utils';
import { getSkillModifier, incrementSkillUsage } from '../utils/skillSystem';

// ============================================================================
// ROLL SYSTEM HOOK (STATELESS)
// ============================================================================

export const useRollSystem = () => {
  const executeRoll = useCallback((
    request: RollRequest,
    currentStats: RollStatistics,
    skills?: Skill[]
  ) => {
    const { final, advText } = executeDiceRoll(
      request.advantage,
      request.disadvantage
    );

    // Calculate skill modifier if relevant_skill is set
    let skillModifier = 0;
    let skillInfo = '';
    if (request.relevant_skill && skills && skills.length > 0) {
      const { modifier, level, skill } = getSkillModifier(skills, request.relevant_skill);
      skillModifier = modifier;
      if (skill) {
        skillInfo = ` [${skill.name}: ${level}]`;
        // Increment skill usage (caller will handle persisting updated character)
      }
    }

    const situationalModifier = request.bonus || 0;
    const totalModifier = skillModifier + situationalModifier;
    const total = final + totalModifier;
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

    const modifierStr = totalModifier !== 0 ? formatModifier(totalModifier) : '';
    const logEntry = `${request.challenge}: d20(${final})${advText}${modifierStr} = ${total} [${outcome}]${skillInfo}`;

    return {
      final,
      total,
      outcome,
      logEntry,
      advText,
      newStats,
      skillModifier,
      skillInfo
    };
  }, []);

  return {
    executeRoll,
  };
};
