import type { Skill, ProficiencyLevel, SkillCategory, Character } from '../types';
import { PROFICIENCY_MODIFIERS } from '../types';
import { SKILL_ADVANCEMENT_THRESHOLD } from '../config/engineConfig';

/** Ordered proficiency ladder. Index = rank; higher index = more advanced. */
export const PROFICIENCY_LADDER: ProficiencyLevel[] = ['untrained', 'familiar', 'trained', 'expert', 'master'];

/** Valid skill categories — used to validate/normalize AI-supplied categories. */
const VALID_CATEGORIES: SkillCategory[] = ['combat', 'physical', 'social', 'knowledge', 'craft'];

export function isProficiencyLevel(value: unknown): value is ProficiencyLevel {
  return typeof value === 'string' && (PROFICIENCY_LADDER as string[]).includes(value);
}

export function normalizeCategory(value: unknown): SkillCategory {
  return typeof value === 'string' && (VALID_CATEGORIES as string[]).includes(value)
    ? (value as SkillCategory)
    : 'knowledge';
}

/** The next level up the ladder, or null if already at master (or unknown). */
export function nextProficiencyLevel(level: ProficiencyLevel): ProficiencyLevel | null {
  const idx = PROFICIENCY_LADDER.indexOf(level);
  if (idx < 0 || idx >= PROFICIENCY_LADDER.length - 1) return null;
  return PROFICIENCY_LADDER[idx + 1];
}

function makeSkillId(name: string): string {
  return `skill_${name.toLowerCase().replace(/\s+/g, '_')}`;
}

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

/** Describes a single skill change produced by a write-path call, for logging/UI. */
export interface SkillAdvancementEvent {
  skillName: string;
  fromLevel: ProficiencyLevel | null; // null = newly created
  toLevel: ProficiencyLevel;
  kind: 'created' | 'usage_advance' | 'ai_advance';
  reason: string;
}

/**
 * Path B (usage-driven). Records one use of `skillName` on the character:
 *  - If the skill is unknown, auto-creates it at `untrained` with usageCount=1.
 *  - If known, increments usageCount and, when the count crosses the threshold
 *    for the current level, advances exactly ONE tier (no multi-tier jumps).
 *
 * Returns the (possibly) updated character plus any advancement/creation event.
 */
export function applyUsageAdvancement(
  character: Character,
  skillName: string,
  currentTurn: number,
  category?: SkillCategory | string
): { character: Character; event?: SkillAdvancementEvent } {
  const trimmed = (skillName ?? '').trim();
  if (!trimmed) return { character };

  const skills = [...(character.skills ?? [])];
  const idx = skills.findIndex(s => s.name.toLowerCase() === trimmed.toLowerCase());

  // Unknown skill → auto-create at untrained, this reference counts as usage #1.
  if (idx < 0) {
    const created: Skill = {
      id: makeSkillId(trimmed),
      name: trimmed,
      category: normalizeCategory(category),
      level: 'untrained',
      source: 'Acquired through practice',
      usageCount: 1,
      lastUsedTurn: currentTurn,
    };
    skills.push(created);
    return {
      character: { ...character, skills },
      event: { skillName: trimmed, fromLevel: null, toLevel: 'untrained', kind: 'created', reason: 'first use' },
    };
  }

  const existing = skills[idx];
  const newUsage = existing.usageCount + 1;
  let updated: Skill = { ...existing, usageCount: newUsage, lastUsedTurn: currentTurn };
  let event: SkillAdvancementEvent | undefined;

  const threshold = SKILL_ADVANCEMENT_THRESHOLD[existing.level] ?? Infinity;
  if (newUsage >= threshold) {
    const promoted = nextProficiencyLevel(existing.level);
    if (promoted) {
      updated = { ...updated, level: promoted };
      event = {
        skillName: existing.name,
        fromLevel: existing.level,
        toLevel: promoted,
        kind: 'usage_advance',
        reason: `${newUsage} uses`,
      };
    }
  }

  skills[idx] = updated;
  return { character: { ...character, skills }, event };
}

/**
 * Path A (AI-driven). Applies explicit skill level declarations from the model.
 * Enforces no-downgrades and validates the declared level; invalid levels are
 * skipped (and surfaced via the returned events for logging).
 */
export function applySkillUpdates(
  character: Character,
  updates: Array<{ skill_name: string; new_level: string; reason: string; category?: string }>,
  currentTurn: number
): { character: Character; events: SkillAdvancementEvent[] } {
  if (!updates || updates.length === 0) return { character, events: [] };

  const skills = [...(character.skills ?? [])];
  const events: SkillAdvancementEvent[] = [];

  for (const update of updates) {
    const name = (update.skill_name ?? '').trim();
    if (!name) continue;

    // Validate the declared level. Invalid → skip (silent no-op was the old bug).
    if (!isProficiencyLevel(update.new_level)) continue;
    const targetLevel = update.new_level;

    const existingIdx = skills.findIndex(s => s.name.toLowerCase() === name.toLowerCase());

    if (existingIdx >= 0) {
      const existing = skills[existingIdx];
      const currentRank = PROFICIENCY_LADDER.indexOf(existing.level);
      const newRank = PROFICIENCY_LADDER.indexOf(targetLevel);
      if (newRank > currentRank) {
        skills[existingIdx] = { ...existing, level: targetLevel, source: update.reason };
        events.push({
          skillName: existing.name,
          fromLevel: existing.level,
          toLevel: targetLevel,
          kind: 'ai_advance',
          reason: update.reason,
        });
      }
    } else {
      // New skill declared by the AI.
      skills.push({
        id: makeSkillId(name),
        name,
        category: normalizeCategory(update.category),
        level: targetLevel,
        source: update.reason,
        usageCount: 0,
        lastUsedTurn: currentTurn,
      });
      events.push({
        skillName: name,
        fromLevel: null,
        toLevel: targetLevel,
        kind: 'created',
        reason: update.reason,
      });
    }
  }

  return { character: { ...character, skills }, events };
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
