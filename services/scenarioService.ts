
import { GoogleGenAI } from "@google/genai";
import { Scenario, Character } from "../types";
import { SAFETY_SETTINGS } from "../constants";
import { SCENARIO_SCHEMA } from "../schemas/scenarioSchema";
import { GeminiClient } from "./geminiClient";

export class ScenarioService {
    constructor(private client: GeminiClient) {}

    async generateScenarios(character: Character): Promise<Scenario[]> {
        try {
            const prompt = `
      Generate 3 distinct starting scenarios for a "Hard Reality" roleplaying game based on this character:
      ${JSON.stringify(character)}
      1. MUNDANE HOOK: Low stakes, grounded.
      2. VIOLENT HOOK: Immediate danger/action.
      3. MATURE HOOK: Social/Ethical complexity.
      Output JSON only.
      `;

            const response = await this.client.ai.models.generateContent({
                model: (this.client as any).modelName, // Accessing protected prop via cast or should expose getter
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: SCENARIO_SCHEMA,
                    safetySettings: SAFETY_SETTINGS,
                    temperature: 0.9
                }
            });
            const text = response.text;
            if (!text) return [];
            const clean = this.client.cleanJsonOutput(text);
            const parsed = JSON.parse(clean);
            if (Array.isArray(parsed)) return parsed as Scenario[];
            if (typeof parsed === 'object' && parsed !== null) {
                const values = Object.values(parsed);
                const foundArray = values.find(v => Array.isArray(v));
                if (foundArray) return foundArray as Scenario[];
            }
            return [];
        } catch (e) {
            console.error("Scenario generation failed", e);
            return [];
        }
    }
}
