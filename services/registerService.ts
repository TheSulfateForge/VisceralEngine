// ============================================================================
// services/registerService.ts — v1.59
//
// The post-turn REGISTER PASS. After each turn, one small background call
// reads that exchange plus the current register of each named NPC in the
// scene and returns what changed for them: what they learned (and how), keyed
// state, promises, feelings, intimate history, and — rarely — a sustained
// change in how they behave. The engine validates and applies the result
// (utils/engine/npcRegister.ts); the model never writes the record directly.
//
// It is a separate call on purpose: the live narrator skips optional fields
// (it left time_passed_minutes out of 13 of 16 turns), and a narrow
// bookkeeping prompt can be strict where a storyteller won't be. It runs
// after the turn is shown, so the player never waits on it; the next turn
// waits for it (bounded) so the record is current. Failures are logged and
// swallowed — play never depends on this call.
// ============================================================================

import { GoogleGenAI, Type } from "@google/genai";
import type { KnownEntity } from "../types";
import { registerBrief, parseRegisterDiffs, type RegisterDiff } from "../utils/engine/npcRegister";
import { getSection, KINKS_LABEL } from "../utils/engine/sheetSections";

const REGISTER_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        updates: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    npc: { type: Type.STRING },
                    knowledge: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                text: { type: Type.STRING },
                                source: { type: Type.STRING, enum: ["witnessed", "told", "rumor"] },
                                from: { type: Type.STRING, nullable: true },
                            },
                            required: ["text", "source"],
                        },
                    },
                    state: {
                        type: Type.ARRAY,
                        items: { type: Type.OBJECT, properties: { key: { type: Type.STRING }, value: { type: Type.STRING } }, required: ["key", "value"] },
                    },
                    promises: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                text: { type: Type.STRING },
                                by: { type: Type.STRING, enum: ["player", "npc"] },
                                status: { type: Type.STRING, enum: ["open", "kept", "broken"], nullable: true },
                            },
                            required: ["text", "by"],
                        },
                    },
                    feelings: {
                        type: Type.ARRAY,
                        items: { type: Type.OBJECT, properties: { toward: { type: Type.STRING }, text: { type: Type.STRING } }, required: ["toward", "text"] },
                    },
                    intimacy: {
                        type: Type.OBJECT,
                        nullable: true,
                        properties: {
                            acts: { type: Type.ARRAY, items: { type: Type.STRING } },
                            wants: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: { text: { type: Type.STRING }, kind: { type: Type.STRING, enum: ["want", "limit", "not_yet"] } },
                                    required: ["text", "kind"],
                                },
                            },
                            kinks_shown: { type: Type.ARRAY, items: { type: Type.STRING } },
                        },
                    },
                    development: {
                        type: Type.OBJECT,
                        nullable: true,
                        properties: { text: { type: Type.STRING }, turns: { type: Type.ARRAY, items: { type: Type.INTEGER } } },
                        required: ["text"],
                    },
                },
                required: ["npc"],
            },
        },
    },
    required: ["updates"],
};

/** At most this many NPCs per pass — the ones most in the scene. */
export const REGISTER_PASS_MAX_NPCS = 4;

export interface RegisterPassInput {
    pcName: string;
    turn: number;
    playerInput: string;
    narrative: string;
    npcs: KnownEntity[];
}

const buildPrompt = (input: RegisterPassInput): string => {
    const npcBlocks = input.npcs.map(e => {
        const kinks = getSection(e.personality, KINKS_LABEL).slice(0, 700);
        const ledger = (e.ledger ?? []).slice(-6).join(' | ');
        return [
            `### ${e.name} (${e.role})`,
            `CURRENT REGISTER:\n${e.register ? registerBrief(e.register) : '(empty)'}`,
            ledger ? `RECENT LEDGER: ${ledger}` : '',
            kinks ? `SHEET — THE KINKS (only for kinks_shown):\n${kinks}` : '',
        ].filter(Boolean).join('\n');
    }).join('\n\n');

    return `You are the RECORD KEEPER for an RPG engine. You do not write story. You read ONE exchange and record what changed for each named NPC listed, as JSON.

THE PLAYER CHARACTER IS ${input.pcName}. "PLAYER" lines are ${input.pcName}'s words and actions. In the NARRATION, "I", "me" and "my" also mean ${input.pcName}.

RULES — record ONLY what happened on the page in THIS exchange, and only what the NPC's CURRENT REGISTER does not already say. Put each thing in the ONE section it belongs to:

1. knowledge — a FACT this NPC learned this exchange, about the player, another person, or the world. One self-contained sentence naming people ("Ryan told her he called the King a bastard to his face."). source "witnessed" = they saw it while present; "told" = someone said it to them (set "from"; record what they were told, even if it may be false); "rumor" = hearsay. Never what they could not have seen or heard. Max 4.
2. state — ONLY a fact about the NPC that will STILL be true next week and replaces an older value: title, marital status, residence, household role, duties, a standing arrangement or schedule (e.g. milking twice a day), a lasting injury. Max 3.
   NEVER state: where they are or how they sit/stand/lie, what they wear, what they are doing right now, how they are reacting this moment, the meal, the scene's mood, body language, technique. Those belong to the narration and are NOT recorded anywhere.
   Never record virginity or pregnancy (the engine tracks those).
3. feelings — how the NPC now feels toward a named PERSON, only if it clearly changed this exchange ("toward": the person's name). Moods toward people go HERE, never in state. Max 2.
4. promises — ONLY an explicit commitment about the future: "I will…", "I won't…", "you have my word…", made this exchange by "player" to the NPC or by "npc" to the player; or an existing promise from the register now kept or broken (repeat its text, set status). Agreements about what just happened, plans for the next hour, and summaries are NOT promises. Max 2.
5. intimacy — REQUIRED whenever anything sexual or intimate happened between them this exchange:
   acts: every such act, short labels ("kiss", "milking", "orgasm (hers)", "fingering", "oral (her giving)", "oral (him giving)", "vaginal sex"). List each act that happened, even if it happened before. The engine counts them and records the first time.
   wants: ONLY about sex and intimacy — what the NPC SAID they want ("want"), refuse ("limit") or not yet ("not_yet"). These become rules. Nothing non-sexual goes here.
   kinks_shown: items from the NPC's SHEET — THE KINKS that actually appeared on the page this exchange (use the sheet's own words); never anything not on that list.
6. development — RARE. Only when this exchange completes a pattern already visible in the register/ledger across several scenes, or is one decisive event that changes how they will behave from now on. One sentence; list the turns that show it. Almost every turn has none.
7. Leave a field out when nothing qualifies. An NPC with nothing new gets no entry. A quiet conversational turn usually produces nothing at all.
8. Use the NPC's exact name as given in the ### heading.

THIS IS TURN ${input.turn}.

NAMED NPCS IN THE SCENE:
${npcBlocks}

PLAYER:
${input.playerInput}

NARRATION:
${input.narrative}`;
};

export class RegisterService {
    constructor(
        private ai: GoogleGenAI,
        private modelName: string,
        private thinkingConfig?: Record<string, unknown>,
    ) {}

    async extract(input: RegisterPassInput): Promise<RegisterDiff[] | null> {
        if (input.npcs.length === 0) return [];
        try {
            const response = await this.ai.models.generateContent({
                model: this.modelName,
                contents: buildPrompt(input),
                config: {
                    ...(this.thinkingConfig ? { thinkingConfig: this.thinkingConfig } : {}),
                    responseMimeType: "application/json",
                    responseSchema: REGISTER_SCHEMA,
                },
            });
            return parseRegisterDiffs(JSON.parse(response.text || "{}"));
        } catch (e) {
            console.warn("[NPC REGISTER] pass failed:", e);
            return null;
        }
    }
}

export const _buildRegisterPrompt = buildPrompt; // tests
