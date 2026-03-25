import type { Skill, ProficiencyLevel, Character } from '../types';
import { PROFICIENCY_MODIFIERS } from '../types';
import { SKILL_ADVANCEMENT_THRESHOLD } from '../config/engineConfig';

export function findSkillByName(skills: Skill[], name: string): Skill | undefined {
  const lower = name.toLowerCase();
  return skills.find(s => s.name.toLowerCase() === lower);
}

export function getSkillModifier(skills: Skill[], skillName: string): { modifier: number; level: ProficiencyLevel; skill: Skill | undefined } {
  const skill = findSkillByName(skills, skillName);
  if (!skill) return { modifier: PROFICIENCY_MODIFIERS.untrained, level: 'untrained', skill: undefined };
  return { modifier: PROFICIENCY_MODIFIERS[skill.level], level: skill.level, skill };
}

export function incrementSkillUsage(skills: Skill[], skillName: string, currentTurn: number): Skill[] {
  return skills.map(s => {
    if (s.name.toLowerCase() !== skillName.toLowerCase()) return s;
    return { ...s, usageCount: s.usageCount + 1, lastUsedTurn: currentTurn };
  });
}

export function checkSkillAdvancement(skill: Skill): boolean {
  const threshold = SKILL_ADVANCEMENT_THRESHOLD[skill.level] ?? Infinity;
  return skill.usageCount >= threshold;
}

export function applySkillUpdates(
  character: Character,
  updates: Array<{ skill_name: string; new_level: ProficiencyLevel; reason: string }>,
  currentTurn: number
): Character {
  if (!updates || updates.length === 0) return character;

  const skills = [...(character.skills ?? [])];

  for (const update of updates) {
    const existingIdx = skills.findIndex(s => s.name.toLowerCase() === update.skill_name.toLowerCase());

    if (existingIdx >= 0) {
      const existing = skills[existingIdx];
      // No downgrades
      const levels: ProficiencyLevel[] = ['untrained', 'familiar', 'trained', 'expert', 'master'];
      const currentLevel = levels.indexOf(existing.level);
      const newLevel = levels.indexOf(update.new_level);
      if (newLevel > currentLevel) {
        skills[existingIdx] = { ...existing, level: update.new_level, source: update.reason };
      }
    } else {
      // New skill
      skills.push({
        id: `skill_${update.skill_name.toLowerCase().replace(/\s+/g, '_')}`,
        name: update.skill_name,
        category: 'knowledge', // default, AI can specify
        level: update.new_level,
        source: update.reason,
        usageCount: 0,
        lastUsedTurn: currentTurn,
      });
    }
  }

  return { ...character, skills };
}

export function buildSkillPromptBlock(skills: Skill[]): string {
  if (!skills || skills.length === 0) return '';

  let block = '\n[CHARACTER SKILLS]\n';
  for (const skill of skills) {
    const mod = PROFICIENCY_MODIFIERS[skill.level];
    const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
    block += `${skill.name}: ${skill.level.toUpperCase()} (${modStr}) — Source: ${skill.source}\n`;
  }
  block += '\nWhen requesting a roll, set relevant_skill to the most applicable skill name.\n';
  block += 'The engine will apply the proficiency modifier automatically.\n';
  block += 'Your bonus field should ONLY reflect situational modifiers (weather, injury, equipment).\n';
  return block;
}
