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
    const prompt = `You are a world-building extraction engine. Your job is to faithfully decompose a world description into structured data for a retrieval-augmented generation (RAG) database.

WORLD DESCRIPTION:
${description}

EXTRACTION RULES:
- Extract ALL explicitly stated information. Do not omit, merge, or compress details that are distinct in the source.
- Each lore entry must cover exactly ONE distinct concept. Never combine multiple topics (e.g., six magic types) into a single entry.
- Each lore keyword must be unique and specific enough to distinguish it from every other entry (e.g., "Fire Magic" not "Magic Types").
- Lore content should be 1-3 sentences of concrete, retrievable detail — not vague summaries.
- Extract ALL factions/powers/nations described. Do not cap at an arbitrary number.
- Extract ALL mechanical rules described (magic systems, restrictions, laws, policies).
- Only invent details to fill structural gaps (e.g., travel times between locations, NPC personality traits) — never invent lore, factions, or rules that contradict or dilute what is explicitly described.

Return a JSON object with these fields:
{
  "locations": [{ "name": "...", "description": "1-2 sentence description", "tags": ["settlement"|"wilderness"|"interior"|"ruin"|"dungeon"|"coastal"|"underground"|"fortress"|"forest"|"tundra"], "connections": [{ "to": "Location Name", "travelTimeMinutes": number, "mode": "foot"|"horse"|"ship"|"magical-conveyance" }], "controllingFaction": "Faction Name or null" }],
  "factions": [{ "name": "...", "description": "2-3 sentences covering governance, culture, and key policies", "territory": ["Location Name"], "influence": 0-100, "resources": ["military"|"economic"|"intelligence"|"magical"|"political"], "dispositions": { "Other Faction Name": "allied"|"neutral"|"rival"|"war" }, "leader": "NPC Name or null", "keyMembers": ["NPC Name"] }],
  "lore": [{ "keyword": "Unique topic name (2-5 words)", "content": "1-3 concrete sentences about this single topic", "category": "history"|"geography"|"culture"|"magic"|"technology"|"religion"|"economy" }],
  "npcs": [{ "name": "...", "role": "...", "location": "Location Name", "faction": "Faction Name or null", "description": "Physical or notable trait in 1 sentence", "personality": "2-3 adjectives or a short phrase", "goals": ["1 specific goal"] }],
  "rules": [{ "name": "Specific rule name", "description": "The exact mechanical rule as described in the source" }],
  "tags": ["genre-tag", ...]
}

QUANTITY GUIDANCE (scale with input detail):
- Locations: Extract every named location. Invent connections to form a connected graph.
- Factions: Extract every named faction, power, nation, or political entity. No maximum.
- Lore: Create one entry per distinct concept. A detailed world may produce 25-40+ entries. Err on the side of more granular entries rather than fewer compressed ones.
- NPCs: 1-2 per faction minimum. Invent names and traits consistent with the faction's culture if not provided.
- Rules: Extract every stated mechanical rule, restriction, or law as its own entry.
- Tags: 3-8 tags describing genre, tone, and setting.

Return ONLY the JSON object, no other text.`;

    try {
      const response = await (this.client as any).ai.chats.create({
        model: this.client.modelName,
        config: {
          systemInstruction: "You are a precise extraction engine. Faithfully decompose world descriptions into structured JSON. Prefer granularity over compression. Output only valid JSON.",
          temperature: 0.4,
          topP: 0.90,
          topK: 30
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

  /* expandWorld uses slightly higher temperature (0.5) since merging requires more judgment */
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
          systemInstruction: "You are a precise world-building assistant. Merge new content into existing world data without duplicating entries. Output only valid JSON.",
          temperature: 0.5,
          topP: 0.90,
          topK: 30
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
