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
            description: "Your out-of-character answer to the player, addressed to them directly as the engine — not as a character, not as narration. Be brief and concrete: 1-3 sentences, EXCEPT when quoting a record, where completeness beats brevity — reproduce the whole list. Answer the question, confirm the correction, or acknowledge the instruction. Never write prose fiction here, never speak as an NPC, never advance the story. If the player corrected you, say plainly what you now understand to be true. v1.38: when they asked what is in an NPC record, answer ONLY from the [NPC RECORDS] block. If the field they asked for is not in it, say so — 'no kink list is recorded for her' is a correct answer. Never invent record content, never present invented text as a quotation, and if no records block was supplied say you cannot see the record rather than reconstructing one."
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
        },
        // v1.61: required (an empty array when there is nothing to fix) —
        // DeepSeek leaves optional fields out.
        child_corrections: {
            type: Type.ARRAY,
            description: "v1.61: corrections to a CHILD born in play, applied directly to the child's record by the engine. Use ONLY when the player says a child listed in [CHILDREN] has something wrong (wrong hair or eye colour, wrong race, wrong name, wrong gender) or names a child. One entry per field. child = the child's name exactly as listed in [CHILDREN]. field = name | gender | race | hair | eyes | appearance. value = the corrected value only (e.g. 'black', 'full orc', 'female', 'Eren'). Empty array when the player corrected no child.",
            items: {
                type: Type.OBJECT,
                properties: {
                    child: { type: Type.STRING },
                    field: { type: Type.STRING, enum: ["name", "gender", "race", "hair", "eyes", "appearance"] },
                    value: { type: Type.STRING },
                },
                required: ["child", "field", "value"],
            },
        }
    },
    required: ["reply", "child_corrections"]
};

export interface OocResponse {
    reply: string;
    assertions?: string[];
    directive?: string;
    /** v1.61 */
    childCorrections?: import('../utils/reproductionSystem').ChildCorrection[];
}
