import { Type, Schema } from "@google/genai";

/**
 * v1.31: OUT-OF-CHARACTER RESPONSE SCHEMA.
 *
 * An OOC turn is not a turn. It produces no narrative, no world_tick, no
 * threats, no clock advance — so it must not be sent the full RESPONSE_SCHEMA,
 * which would invite the model to generate all of those and would cost the
 * request tokens of a ~40-property schema for a two-sentence answer.
 *
 * This is deliberately tiny: an answer, and any facts the exchange established.
 */
export const OOC_RESPONSE_SCHEMA: Schema = {
    type: Type.OBJECT,
    properties: {
        reply: {
            type: Type.STRING,
            description: "Your out-of-character answer to the player, addressed to them directly as the engine — not as a character, not as narration. Be brief and concrete: 1-3 sentences. Answer the question, confirm the correction, or acknowledge the instruction. Never write prose fiction here, never speak as an NPC, never advance the story. If the player corrected you, say plainly what you now understand to be true."
        },
        assertions: {
            type: Type.ARRAY,
            nullable: true,
            items: { type: Type.STRING },
            description: "0-3 short declarative clauses capturing facts the player established in this exchange about THEIR OWN character (body, gear, abilities, history) or corrections to something previously narrated about them. Record the fact, not the phrasing. NEVER record claims about NPC thoughts/feelings, faction plans, or world events. Omit entirely when the player gave a pure instruction ('stop repeating yourself') rather than a fact."
        },
        directive: {
            type: Type.STRING,
            nullable: true,
            description: "OPTIONAL. When the player gave a standing instruction about HOW to narrate (pacing, tone, how NPCs speak or read them, how often NPCs touch them, how explicit to be), restate it here as ONE imperative clause. v1.35: this is now PERSISTED and injected into every subsequent turn as a binding [STANDING DIRECTIVES] block, so write it as a durable rule the engine can follow forever, not as a reaction to this one turn. A complaint ('why do you keep doing X') becomes the instruction it implies ('Do not do X'). Be specific and behavioural. Omit when the input was a question or a fact rather than an instruction."
        }
    },
    required: ["reply"]
};

export interface OocResponse {
    reply: string;
    assertions?: string[];
    directive?: string;
}
