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
      Generate 4 distinct starting scenarios for a grounded, gritty-but-fair roleplaying game based on this character:
      ${JSON.stringify(character)}
      1. MUNDANE HOOK: Low stakes, everyday problem with a subtle complication.
      2. VIOLENT HOOK: Immediate danger/action with a plausible cause and a clear exit/next step.
      3. MATURE HOOK: Social/ethical complexity. Adult themes are allowed, including sexual situations.
      4. NIGHTMARE HOOK: The character begins at their absolute worst-case starting position — they are already on the back foot with no easy outs. This scenario MUST combine at least two of the following pressure types: severe physical peril or ongoing violence, sexual exploitation or coercion, crushing social humiliation or manipulation. The character has no obvious escape, is already compromised (injured, blackmailed, captive, in debt, violated, betrayed), and the opening line drops them directly into the crisis with zero buffer. This is the hardest possible entry point. Do not soften it.
      Output JSON only.
      `;

            const response = await this.client.ai.models.generateContent({
                model: (this.client as any).modelName,
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: SCENARIO_SCHEMA,
                    safetySettings: SAFETY_SETTINGS,
                    temperature: 0.95
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