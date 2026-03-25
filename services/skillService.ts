import type { Character, Skill, SkillCategory, ProficiencyLevel } from '../types';
import { GeminiClient } from './geminiClient';

export class SkillService {
  constructor(private client: GeminiClient) {}

  async extractInitialSkills(character: Character): Promise<Skill[]> {
    const prompt = `Analyze this character and extract 4-8 skills with proficiency levels.

Character:
- Name: ${character.name}
- Race: ${character.race}
- Backstory: ${character.backstory}
- Inventory: ${character.inventory.join(', ')}
- Relationships: ${character.relationships.join(', ')}
- Goals: ${character.goals.join(', ')}

For each skill, provide:
- name: A concise skill name (e.g., "Melee Combat", "Persuasion", "Herbalism")
- category: one of: combat, physical, social, knowledge, craft
- level: one of: untrained, familiar, trained, expert, master
- source: Brief justification from the character's background

Rules:
- Most skills should be "familiar" or "trained"
- Only give "expert" if the backstory strongly implies years of dedicated practice
- Never give "master" at character creation
- Skills should reflect the character's actual background, not aspirations
- Include at least one social skill and one physical skill

Return as JSON array: [{ "name": "...", "category": "...", "level": "...", "source": "..." }, ...]`;

    try {
      const response = await this.client.ai.models.generateContent({
        model: this.client.modelName,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          temperature: 1.0
        }
      });

      const text = response?.text?.trim() ?? '';

      // Extract JSON from response
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]) as Array<{
        name: string;
        category: SkillCategory;
        level: ProficiencyLevel;
        source: string;
      }>;

      return parsed.map((s) => ({
        id: `skill_${s.name.toLowerCase().replace(/\s+/g, '_')}`,
        name: s.name,
        category: s.category || 'knowledge',
        level: s.level || 'familiar',
        source: s.source || 'Backstory',
        usageCount: 0,
      }));
    } catch (e) {
      console.error('[SkillService] extractInitialSkills failed:', e);
      return [];
    }
  }
}
