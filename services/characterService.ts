// ============================================================================
// services/characterService.ts
// v1.6: Added extractDormantHooks() — called once at session start to build
//       the Dormant Hook Registry from character backstory/relationships/goals.
// ============================================================================

import { GoogleGenAI, Schema, Type } from "@google/genai";
import { GeneratedCharacterFields, Character, DormantHook, HookCategory, HookStatus } from "../types";
import { SAFETY_SETTINGS } from "../constants";
import { CHARACTER_GEN_SCHEMA } from "../schemas/characterSchema";
import { GeminiClient } from "./geminiClient";

export class CharacterService {
    constructor(private client: GeminiClient) {}

    async generateCharacter(concept: string): Promise<GeneratedCharacterFields | null> {
        try {
            const prompt = `
You are the character creation engine for a "Visceral Realism" roleplaying simulation.
Generate a COMPLETE, DETAILED character based on this concept from the user:

"${concept}"

RULES:
- The character must feel REAL. No generic fantasy tropes unless the concept demands it.
- Backstory should include specific events, not vague descriptions.
- Appearance should be cinematically detailed — a casting director should be able to picture them.
- Inventory should reflect their life situation, not a game loadout.
- Relationships should create dramatic tension and narrative hooks.
- Setting should be SPECIFIC — a place, time, and situation, not just a genre.
- If the concept is vague, make bold creative choices. Fill in the gaps with interesting details.
- NEVER use these names: Elara, Kaela, Lyra, Aria, Kaelith, Kael, Vex, Nyx, Thorne.

Output valid JSON matching the schema exactly.
        `;

            const response = await this.client.ai.models.generateContent({
                model: (this.client as any).modelName,
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: CHARACTER_GEN_SCHEMA,
                    safetySettings: SAFETY_SETTINGS,
                    temperature: 1.0
                }
            });

            const text = response.text;
            if (!text) return null;

            const clean = this.client.cleanJsonOutput(text);
            const parsed = JSON.parse(clean);
            return parsed as GeneratedCharacterFields;
        } catch (e) {
            console.error("Character generation failed:", e);
            return null;
        }
    }

    async generateCharacterField(
        character: Partial<Character>,
        fieldName: string,
        fieldDescription: string
    ): Promise<string | string[] | null> {
        try {
            const context = Object.entries(character)
                .filter(([_, v]) => {
                    if (typeof v === 'string') return v.trim().length > 0;
                    if (Array.isArray(v)) return v.length > 0;
                    return false;
                })
                .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
                .join('\n');

            const prompt = `
You are assisting with character creation for a "Visceral Realism" roleplaying simulation.
Generate ONLY the "${fieldName}" field for this character.

Field description: ${fieldDescription}

Existing character context:
${context}

RULES:
- Output must be appropriate for the field type (string or array of strings).
- Be specific and visceral. No generic fantasy tropes unless setting demands it.
- Maintain consistency with existing character context.
- NEVER use these names: Elara, Kaela, Lyra, Aria, Kaelith, Kael, Vex, Nyx, Thorne.

Output ONLY the value for the requested field as valid JSON.
            `;

            const response = await this.client.ai.models.generateContent({
                model: (this.client as any).modelName,
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    safetySettings: SAFETY_SETTINGS,
                    temperature: 0.9
                }
            });

            const text = response.text;
            if (!text) return null;

            const clean = this.client.cleanJsonOutput(text);
            return JSON.parse(clean);
        } catch (e) {
            console.error(`Character field generation failed for ${fieldName}:`, e);
            return null;
        }
    }

    /**
     * v1.6: Dormant Hook Registry extraction.
     *
     * Analyzes the character's backstory, relationships, goals, and inventory
     * to extract a Dormant Hook Registry — the set of latent tension vectors
     * that can legitimately activate as threats during gameplay.
     *
     * Called ONCE at session start (ScenarioSelectionView or equivalent).
     * Result stored in gameWorld.dormantHooks.
     *
     * The engine enforces that new threat seeds must reference one of these hooks
     * (via dormantHookId), OR cite a specific player action this session, OR belong
     * to a faction with accumulated exposure score ≥ 20. All other threat seeds
     * are blocked by validateThreatCausality() in simulationEngine.ts.
     */
    async extractDormantHooks(character: Character): Promise<DormantHook[]> {
        const DORMANT_HOOK_SCHEMA: Schema = {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    id: {
                        type: Type.STRING,
                        description: "Short snake_case identifier, e.g. hook_father_guild_records"
                    },
                    summary: {
                        type: Type.STRING,
                        description: "One sentence describing the latent tension."
                    },
                    category: {
                        type: Type.STRING,
                        description: "One of: relationship, backstory, secret, resource, location"
                    },
                    sourceField: {
                        type: Type.STRING,
                        description: "Which character field this comes from: backstory, relationships, goals, inventory, notableFeatures"
                    },
                    involvedEntities: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description: "Names of NPCs or factions involved. Only names present in the character data."
                    },
                    activationConditions: {
                        type: Type.STRING,
                        description: "Plain language: what specific player action or in-world event would cause this to activate."
                    },
                    status: {
                        type: Type.STRING,
                        description: "Always 'dormant' for newly extracted hooks."
                    }
                },
                required: ['id', 'summary', 'category', 'sourceField', 'involvedEntities', 'activationConditions', 'status']
            }
        };

        const prompt = `
You are the threat analysis subsystem for a Visceral Realism simulation engine.
Your job is to read a character's background and extract DORMANT HOOKS —
pre-existing tension vectors that could realistically activate during play.

A Dormant Hook is NOT a threat. It is a latent condition that COULD become a threat
if the player takes relevant actions or time passes. It must be rooted entirely in
the character's background — you may NOT invent new elements.

Character data:
Name: ${character.name}
Race: ${character.race}
Backstory: ${character.backstory}
Relationships: ${character.relationships.join(' | ')}
Goals: ${character.goals.join(' | ')}
Inventory: ${character.inventory.join(' | ')}
Setting: ${character.setting}

RULES:
- Extract 3–6 hooks maximum. Quality over quantity.
- Only extract hooks with a genuine, specific causal chain — not vague atmosphere.
- Do NOT invent new NPCs, factions, or events not present in the character data.
- A secret the character possesses counts as a hook only if the background implies
  someone ALREADY knows or could plausibly find out through normal social channels.
- Do NOT add a hook for general setting hazards ("the city is dangerous", "the dungeon exists").
- Relationship hooks require a named person and a specific tension, not just "has family."
- A character trait or physical attribute is NOT a hook by itself. It becomes a hook only
  if the background establishes a specific person or faction who already has reason to care.
- Set status to "dormant" for all hooks.

Output valid JSON array of hook objects.
        `;

        try {
            const response = await this.client.ai.models.generateContent({
                model: (this.client as any).modelName,
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: DORMANT_HOOK_SCHEMA,
                    safetySettings: SAFETY_SETTINGS,
                    temperature: 0.3 // Low temp — precise extraction, not creativity
                }
            });

            const text = response.text;
            if (!text) return [];

            const clean = this.client.cleanJsonOutput(text);
            const parsed = JSON.parse(clean) as DormantHook[];

            // Sanitize: ensure all IDs are unique and status is dormant
            const seen = new Set<string>();
            return parsed
                .filter(hook => hook.id && hook.summary && hook.activationConditions)
                .map(hook => ({
                    ...hook,
                    id: seen.has(hook.id)
                        ? `${hook.id}_${Date.now()}`
                        : (seen.add(hook.id), hook.id),
                    status: 'dormant' as HookStatus
                }));

        } catch (e) {
            console.error('[DormantHooks] Extraction failed:', e);
            return [];
        }
    }
}
