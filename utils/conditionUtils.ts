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