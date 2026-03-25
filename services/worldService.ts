import type {
  WorldSeedLocation,
  WorldSeedFaction,
  WorldSeedLore,
  WorldSeedNPC,
  WorldSeedRule
} from '../types';
import { GeminiService } from '../geminiService';

export class WorldService {
  constructor(private client: GeminiService) {}

  async decomposeWorld(description: string): Promise<{
    locations: WorldSeedLocation[];
    factions: WorldSeedFaction[];
    lore: WorldSeedLore[];
    npcs: WorldSeedNPC[];
    rules: WorldSeedRule[];
    tags: string[];
  }> {
    const prompt = `You are a world-building AI. Decompose this world description into structured data.

WORLD DESCRIPTION:
${description}

Extract the following from the description. Invent plausible details where the description is vague — but stay consistent with the tone and setting described.

Return a JSON object with these fields:
{
  "locations": [{ "name": "...", "description": "...", "tags": ["settlement"|"wilderness"|"interior"|"ruin"|...], "connections": [{ "to": "Location Name", "travelTimeMinutes": 120, "mode": "foot" }], "controllingFaction": "Faction Name or null" }],
  "factions": [{ "name": "...", "description": "...", "territory": ["Location Name"], "influence": 0-100, "resources": ["military"|"economic"|"intelligence"|"magical"|"political"], "dispositions": { "Other Faction Name": "allied"|"neutral"|"rival"|"war" }, "leader": "NPC Name or null", "keyMembers": ["NPC Name"] }],
  "lore": [{ "keyword": "...", "content": "...", "category": "history"|"geography"|"culture"|"magic"|"technology"|"religion"|"economy" }],
  "npcs": [{ "name": "...", "role": "...", "location": "Location Name", "faction": "Faction Name or null", "description": "...", "personality": "...", "goals": ["..."] }],
  "rules": [{ "name": "Magic System"|"Technology Level"|"Social Structure"|..., "description": "Detailed rule description" }],
  "tags": ["dark-fantasy", "low-magic", ...]
}

Requirements:
- 5-15 locations with connections forming a connected graph
- 2-6 factions with dispositions toward each other
- 8-20 lore entries covering history, culture, and world mechanics
- 5-10 key NPCs placed in specific locations
- 2-5 world rules
- 3-8 tags describing the setting

Return ONLY the JSON object, no other text.`;

    try {
      const response = await (this.client as any).ai.chats.create({
        model: this.client.modelName,
        config: {
          systemInstruction: "You are a creative world-building assistant. Output only valid JSON.",
          temperature: 0.8,
          topP: 0.95,
          topK: 40
        }
      }).sendMessage({ message: prompt });

      const text = response?.text?.trim() ?? '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        locations: parsed.locations ?? [],
        factions: parsed.factions ?? [],
        lore: parsed.lore ?? [],
        npcs: parsed.npcs ?? [],
        rules: parsed.rules ?? [],
        tags: parsed.tags ?? [],
      };
    } catch (e) {
      console.error('[WorldService] decomposeWorld failed:', e);
      throw e;
    }
  }

  async expandWorld(existingData: {
    locations: any[];
    factions: any[];
    lore: any[];
    npcs: any[];
    rules: any[]
  }, additionalDescription: string): Promise<{
    locations: WorldSeedLocation[];
    factions: WorldSeedFaction[];
    lore: WorldSeedLore[];
    npcs: WorldSeedNPC[];
    rules: WorldSeedRule[];
    tags: string[];
  }> {
    const existingContext = JSON.stringify(existingData, null, 2);
    const prompt = `You are a world-building AI. Expand this existing world with new content.

EXISTING WORLD DATA:
${existingContext}

ADDITIONAL DESCRIPTION TO INTEGRATE:
${additionalDescription}

Merge the new content into the existing world. Return the COMPLETE updated world as a JSON object (same format as above). Deduplicate entries — if a location/NPC/faction already exists, update it rather than creating a duplicate.

Return ONLY the JSON object, no other text.`;

    try {
      const response = await (this.client as any).ai.chats.create({
        model: this.client.modelName,
        config: {
          systemInstruction: "You are a creative world-building assistant. Output only valid JSON.",
          temperature: 0.8,
          topP: 0.95,
          topK: 40
        }
      }).sendMessage({ message: prompt });

      const text = response?.text?.trim() ?? '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        locations: parsed.locations ?? [],
        factions: parsed.factions ?? [],
        lore: parsed.lore ?? [],
        npcs: parsed.npcs ?? [],
        rules: parsed.rules ?? [],
        tags: parsed.tags ?? [],
      };
    } catch (e) {
      console.error('[WorldService] expandWorld failed:', e);
      throw e;
    }
  }
}
