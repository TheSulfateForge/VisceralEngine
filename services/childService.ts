// ============================================================================
// services/childService.ts — v1.61
//
// The post-birth TRAIT PASS. When the engine delivers a child (pipeline step
// 20 or a montage), the child exists with its gender rolled and everything
// else pending. This one small call reads both parents' race and appearance
// plus the campaign's inheritance rules and returns the child's race, hair,
// eyes, a name and a one-line appearance. The engine validates and applies it
// (utils/reproductionSystem.ts); gender is never the model's to change.
//
// Separate call for the same reason as the register pass: a narrow prompt
// with every field required is filled reliably where the narrator skips
// optional fields. Failures are logged and retried on the next turn.
// ============================================================================

import { GoogleGenAI, Type } from "@google/genai";
import type { KnownEntity } from "../types";
import { parseChildTraits, type ChildTraits, type ParentInfo, childKid } from "../utils/reproductionSystem";

const CHILD_TRAIT_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        name: { type: Type.STRING, description: "The child's name." },
        race: { type: Type.STRING, description: "The child's race/species." },
        hair: { type: Type.STRING, description: "Hair colour (and texture if a parent's description gives one)." },
        eyes: { type: Type.STRING, description: "Eye colour." },
        appearance: { type: Type.STRING, description: "One sentence describing the newborn using only the traits above." },
    },
    required: ["name", "race", "hair", "eyes", "appearance"],
};

export interface ChildTraitInput {
    child: KnownEntity;
    mother: ParentInfo;
    father: ParentInfo;
    /** The campaign's inheritance rules (Settings). May be empty. */
    rules: string;
}

const parentBlock = (label: string, p: ParentInfo): string => [
    `${label}: ${p.name}`,
    p.race ? `  Race: ${p.race}` : '',
    p.appearance ? `  Appearance: ${p.appearance}` : '',
    p.notes ? `  Notes: ${p.notes}` : '',
    !p.race && !p.appearance && !p.notes ? '  (nothing on record)' : '',
].filter(Boolean).join('\n');

const buildPrompt = (input: ChildTraitInput): string => {
    const c = input.child.child!;
    return `A child has just been born in a roleplaying game. Decide the child's inherited traits.

The child is a ${childKid(c.gender)}. That is fixed — do not change it.

${input.rules.trim()
    ? `INHERITANCE RULES FOR THIS CAMPAIGN (binding — they override everything below):\n${input.rules.trim()}`
    : 'No campaign inheritance rules are set.'}

${parentBlock('MOTHER', input.mother)}

${parentBlock('FATHER', input.father)}

How to decide:
- Hair and eyes come from the parents: take each from one parent or blend them. Do not give a colour neither parent has unless an inheritance rule or the race requires it.
- Race follows the inheritance rules first. Without a rule that applies, derive it from both parents' races (a mixed-race child when they differ). If a parent's race is not stated, read it from their appearance or notes.
- Name: one name fitting the parents' culture and the world (with the family name if the parents use one).
- appearance: one plain sentence describing the newborn using only these traits.`;
};

export class ChildService {
    constructor(
        private ai: GoogleGenAI,
        private modelName: string,
        private thinkingConfig?: Record<string, unknown>,
    ) {}

    async generate(input: ChildTraitInput): Promise<ChildTraits | null> {
        try {
            const response = await this.ai.models.generateContent({
                model: this.modelName,
                contents: buildPrompt(input),
                config: {
                    ...(this.thinkingConfig ? { thinkingConfig: this.thinkingConfig } : {}),
                    responseMimeType: "application/json",
                    responseSchema: CHILD_TRAIT_SCHEMA,
                },
            });
            return parseChildTraits(JSON.parse(response.text || "{}"));
        } catch (e) {
            console.warn("[CHILD TRAITS] pass failed:", e);
            return null;
        }
    }
}

export const _buildChildTraitPrompt = buildPrompt; // tests
