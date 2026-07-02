// ============================================================================
// services/worldPulseService.ts — v1.24
//
// Background world simulation. The live turn asks one model to narrate AND
// simulate the world simultaneously — which is why the world reads as
// reactionary: world_tick is generated in response to player input, competing
// for the narrator's attention. This service moves the "world moves without
// you" work OFF the live turn: a cheap, non-blocking Flash-Lite call that
// advances NPC goals and faction agendas offscreen and writes the results
// into the hidden registry, where the next live turn's narrator SURFACES a
// world that already moved instead of inventing movement on demand.
//
// It also generates OPPORTUNITY seeds — the positive counterpart the threat
// pipeline lacks. A world that only ever schedules harm reads adversarial
// even when every threat is proportional and gated.
//
// Triggered fire-and-forget from useGeminiClient on downtime (large time
// skips) and every N turns. Failures are logged and swallowed — the live
// game never depends on this call.
// ============================================================================

import { GoogleGenAI, Type } from "@google/genai";
import { GameWorld } from "../types";

export interface WorldPulseResult {
    developments: string[];
    opportunities: string[];
}

const PULSE_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        developments: {
            type: Type.ARRAY,
            description: "2-4 one-line offscreen developments. Each advances an EXISTING NPC goal or faction agenda from the brief. Format: '<Actor>: <what they did> (<where, ~distance from player if not local>)'.",
            items: { type: Type.STRING },
        },
        opportunities: {
            type: Type.ARRAY,
            description: "0-2 one-line openings the player could benefit from: a job posting, a festival, a caravan hiring, a contact surfacing, a rumor of a windfall. Neutral-to-positive pressure only.",
            items: { type: Type.STRING },
        },
    },
    required: ["developments", "opportunities"],
};

/** Compact world brief — only what the offscreen simulator needs. */
const buildPulseBrief = (world: GameWorld, turn: number): string => {
    const lines: string[] = [];
    lines.push(`Turn: ${turn} | Time: ${world.time?.display ?? 'unknown'} | Player location: ${world.location ?? 'unknown'}`);

    const npcs = (world.knownEntities ?? [])
        .filter(e => e.status !== 'dead' && (e.relationship_level !== 'NEUTRAL' || (e.ledger?.length ?? 0) > 2))
        .slice(0, 8)
        .map(e => `- ${e.name} (${e.role}) [${e.relationship_level}] @ ${e.location} — recent: ${(e.ledger ?? []).slice(-2).join('; ') || 'none'}`);
    if (npcs.length) lines.push(`\nNAMED NPCs WITH AGENDAS:\n${npcs.join('\n')}`);

    const factions = (world.factions ?? [])
        .slice(0, 6)
        .map(f => `- ${f.name} (influence ${f.influence}, player reputation: ${f.playerStanding?.reputation ?? 0})${f.activeObjective ? ` — objective: ${f.activeObjective}` : ''}`);
    if (factions.length) lines.push(`\nFACTIONS:\n${factions.join('\n')}`);

    const threats = (world.emergingThreats ?? [])
        .map(t => `- ${t.description.slice(0, 80)} (ETA ${t.turns_until_impact ?? '?'})`);
    if (threats.length) lines.push(`\nACTIVE THREAT SEEDS (do not duplicate or accelerate these):\n${threats.join('\n')}`);

    const registryTail = (world.hiddenRegistry ?? '').split('\n').filter(Boolean).slice(-10);
    if (registryTail.length) lines.push(`\nRECENT HIDDEN REGISTRY (do not repeat):\n${registryTail.join('\n')}`);

    if (world.worldTags?.length) lines.push(`\nWORLD TONE: ${world.worldTags.join(', ')}`);

    return lines.join('\n');
};

export class WorldPulseService {
    constructor(private ai: GoogleGenAI) {}

    async pulse(world: GameWorld, turn: number): Promise<WorldPulseResult | null> {
        try {
            const brief = buildPulseBrief(world, turn);
            const response = await this.ai.models.generateContent({
                model: "gemini-2.5-flash-lite",
                contents: `You are the OFFSCREEN WORLD SIMULATOR for a sandbox RPG. The player is not watching; you advance the world anyway.

RULES:
1. Advance EXISTING goals of the named NPCs and factions below. Do not invent new named characters (unnamed minor figures like "a courier" are fine).
2. Developments must respect distance and travel time — an actor 200 miles away acts 200 miles away.
3. Do NOT create threats against the player, accelerate existing threat seeds, or reference the player's current activity. Threats are the live engine's job. You are neutral world motion: commerce, politics, weather, rivalries between NPCs, faction maneuvering.
4. Opportunities are openings the player COULD pursue, discoverable through ordinary play (notice boards, gossip, an NPC reaching out). Concrete and specific, never "adventure awaits."
5. One line each. No prose, no drama — registry entries.

WORLD BRIEF:
${brief}`,
                config: {
                    thinkingConfig: { thinkingBudget: 256 },
                    responseMimeType: "application/json",
                    responseSchema: PULSE_SCHEMA,
                },
            });
            const raw = JSON.parse(response.text || "{}") as {
                developments?: string[];
                opportunities?: string[];
            };
            const clean = (arr: unknown): string[] =>
                Array.isArray(arr)
                    ? arr.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
                        .map(s => s.trim())
                    : [];
            return {
                developments: clean(raw.developments).slice(0, 4),
                opportunities: clean(raw.opportunities).slice(0, 2),
            };
        } catch (e) {
            console.warn("[WORLD PULSE] generation failed:", e);
            return null;
        }
    }
}
