
import { GoogleGenAI, Schema, Type } from "@google/genai";
import { GeneratedCharacterFields, Character } from "../types";
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
                    temperature: 1.0 // Higher creativity for character gen
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
            // Build context from whatever the user has already filled in
            const context = Object.entries(character)
                .filter(([_, v]) => {
                    if (typeof v === 'string') return v.trim().length > 0;
                    if (Array.isArray(v)) return v.length > 0;
                    return false;
                })
                .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
                .join('\n');

            const isArrayField = ['inventory', 'relationships', 'conditions', 'goals'].includes(fieldName);

            const prompt = `
You are generating a SINGLE field for a character in a "Visceral Realism" RPG.

EXISTING CHARACTER DATA (use this as context — maintain consistency):
${context || "No data yet. Make bold creative choices."}

GENERATE THE FOLLOWING FIELD: ${fieldName}
FIELD DESCRIPTION: ${fieldDescription}

${isArrayField ? 
    `Return a JSON array of 2-5 strings. Each string should be specific and vivid.` : 
    `Return a JSON object with a single "value" key containing the generated text. Be detailed and specific — 2-4 sentences for descriptive fields, concise for labels.`
}

RULES:
- Stay consistent with existing data.
- Be specific, not generic. Real-feeling details.
- NEVER use these names: Elara, Kaela, Lyra, Aria, Kaelith, Kael, Vex, Nyx, Thorne.
        `;

            const schema: Schema = isArrayField ? {
                type: Type.ARRAY,
                items: { type: Type.STRING }
            } : {
                type: Type.OBJECT,
                properties: {
                    value: { type: Type.STRING }
                },
                required: ["value"]
            };

            const response = await this.client.ai.models.generateContent({
                model: (this.client as any).modelName,
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: schema,
                    safetySettings: SAFETY_SETTINGS,
                    temperature: 0.9
                }
            });

            const text = response.text;
            if (!text) return null;

            const clean = this.client.cleanJsonOutput(text);
            const parsed = JSON.parse(clean);

            if (isArrayField) {
                return Array.isArray(parsed) ? parsed : null;
            } else {
                return typeof parsed.value === 'string' ? parsed.value : null;
            }
        } catch (e) {
            console.error(`Field generation failed for ${fieldName}:`, e);
            return null;
        }
    }
}
