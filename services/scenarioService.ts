import { GoogleGenAI } from "@google/genai";
import { Scenario, Character } from "../types";
import { GEMINI_SAFETY_SETTINGS } from "../constants";
import { SCENARIO_SCHEMA } from "../schemas/scenarioSchema";
import { GeminiClient } from "./geminiClient";

export class ScenarioService {
    constructor(private client: GeminiClient) {}

    /**
     * v0.12.3: Optional `seedBrief` is a compact projection of the selected
     * WorldSeed (built via utils/seedBrief.ts). When provided, scenarios are
     * anchored to canon NPCs/factions/locations/rules from the seed instead
     * of inventing parallel substitutes. When omitted (no seed selected),
     * behavior is identical to pre-0.12.3.
     */
    async generateScenarios(character: Character, seedBrief?: string): Promise<Scenario[]> {
        try {
            const worldCanonBlock = seedBrief && seedBrief.trim().length > 0
                ? `\n      [WORLD CANON — AUTHORITATIVE]\n${seedBrief}\n      Anchor every scenario's NPCs, factions, locations, and lore references to the canon above. Do not invent parallel substitutes for entities that already exist in the seed. Tone and technology level must align with the listed tags and rules.\n`
                : '';

            const prompt = `
      You are generating 4 distinct starting scenarios for a grounded, gritty-but-fair roleplaying game.

      CHARACTER:
      ${JSON.stringify(character)}${worldCanonBlock}

      STEP 1 — READ THE CHARACTER (silent; do not output). Identify, for THIS character specifically:
      - What they actively want (their pull-toward).
      - What they avoid, fear, or have already paid for once (their pull-away).
      - What they are built to do well — and what they are conspicuously bad at.
      - Who or what they are tied to (people, places, debts, obligations, possessions they could not lose).
      - Where they fit in this world — what it rewards them for, what it punishes them for.
      The four scenarios below MUST be derived from this read. Do not fall back on generic templates.

      STEP 2 — GENERATE 4 SCENARIOS THAT CONTRAST EACH OTHER. No two scenarios may share the same combination of these axes; each must be different across all four:
      - OPENING POSTURE: the character pursues / is invited / is approached / is cornered.
      - THREAT VECTOR: interpersonal, professional or duty-bound, physical, moral or identity-based, supernatural or uncanny, social or reputational.
      - TONAL REGISTER: quiet and warm, weird and uncanny, harsh and gritty, dread and horror.
      - STAKES SCALE: personal, relational, communal, existential.
      Location CAN repeat — the campaign may be centered in one place. Posture, threat, tone, and stakes must each be different across the four.

      BALANCE RULE (applies to hooks 1–3 only): The player character must begin from a NEUTRAL or ADVANTAGED position. They are not already compromised, captured, ambushed, blackmailed, humiliated, or in physical distress at scene open. Any complication or threat must emerge DURING play as a result of player choices — not be pre-loaded into the opening situation. The character has full agency from the first moment.

      HOOKS 1–3: Pick the axis combinations MOST GENERATIVE for THIS character — not a fixed genre slot. A duty-bound character should feel professional pressure; a drifter should feel curiosity or kindness; a paranoid character should feel surveillance or exposure; a fixer should feel obligation or leverage. Let the character sheet dictate which axes hit hardest. Avoid defaulting to "small errand with a twist," "fight breaks out," or "ethical bind" unless the character read genuinely points there.

      HOOK 4 — HARDEST ENTRY FOR THIS CHARACTER. Worst-case opening, derived directly from STEP 1: this character's specific fears, what they protect, what they have already paid for once, or what they cannot afford to lose. Structurally different nightmares for different characters — a paranoid hacker's worst case is exposure and a kicked-in door; a tender medic's is being the one who couldn't save someone; a con artist's is being read for free in front of a mark; a soldier's may be a friendly-fire moment or a betrayal from inside the unit; a true believer's is the proof their cause was a lie. Do NOT default to physical restraint, sexual coercion, or public humiliation unless the character read points specifically there. Drop the player directly into the crisis — the first sentence is a sharp sensory detail mid-pain, mid-threat, mid-dread, or mid-realization, with no exposition. Establish that normal exits (fighting, talking, fleeing) are blocked specifically by THIS character's weaknesses, commitments, or ties. This is the hardest possible entry point FOR THIS CHARACTER — not a generic worst case. Do not soften it.

      BANNED NAMES — DO NOT USE: Elara, Kaela, Lyra, Kael, Vex, Thorne, Kaelen, Valerius, Seraphina, Zara, Zephyr, Aria, Aurelia, Draven, Caelan, Aldric, Caelum, Sylva, Rhea, Celeste, Mira, Isolde, Aelindra, Calen, Soraya, Tristan, Eryndor, Alara, Oakhaven

      Output JSON only.
      `;

            const response = await this.client.ai.models.generateContent({
                model: this.client.modelName,
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: SCENARIO_SCHEMA,
                    safetySettings: GEMINI_SAFETY_SETTINGS,
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