import { CONDITION_KEYWORDS } from '../constants';
import { ConditionSeverity } from '../types';

export const getConditionSeverity = (condition: string): ConditionSeverity => {
  const lower = condition.toLowerCase();

  if (CONDITION_KEYWORDS.lethal.some(keyword => lower.includes(keyword))) {
    return 'lethal';
  }

  if (CONDITION_KEYWORDS.traumatic.some(keyword => lower.includes(keyword))) {
    return 'traumatic';
  }

  return 'minor';
};

export const getMostSevereCondition = (conditions: string[]): ConditionSeverity => {
  if (conditions.length === 0) return 'minor';

  const severities = conditions.map(getConditionSeverity);

  if (severities.includes('lethal')) return 'lethal';
  if (severities.includes('traumatic')) return 'traumatic';
  return 'minor';
};

// ============================================================================
// HEAL MARKER PROTOCOL (v1.19)
// ----------------------------------------------------------------------------
// The model appends "[HEAL:T<N>]" to any healing injury in the condition string.
// Example: "Fractured Forearm [HEAL:T42]"  — heals by turn 42.
// Conditions without a marker are permanent (maiming, amputation, etc.).
// ============================================================================

/** Matches "[HEAL:T<digits>]" anywhere in the string (case-insensitive). */
const HEAL_MARKER_RE = /\[\s*HEAL\s*:\s*T\s*(\d+)\s*\]/i;

/** Returns the healing turn encoded in a condition, or null if none/invalid. */
export const parseHealTurn = (condition: string): number | null => {
  const match = HEAL_MARKER_RE.exec(condition);
  if (!match) return null;
  const turn = Number.parseInt(match[1], 10);
  return Number.isFinite(turn) && turn > 0 ? turn : null;
};

/**
 * Removes conditions whose [HEAL:T<N>] marker has been reached or passed.
 * Pure function — returns the partition so the caller can log `removed`.
 */
export const removeHealedConditions = (
  conditions: string[],
  currentTurn: number,
): { kept: string[]; removed: string[] } => {
  const kept: string[] = [];
  const removed: string[] = [];

  for (const c of conditions) {
    const healTurn = parseHealTurn(c);
    if (healTurn !== null && currentTurn >= healTurn) {
      removed.push(c);
    } else {
      kept.push(c);
    }
  }

  return { kept, removed };
};