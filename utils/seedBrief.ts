// utils/seedBrief.ts
// v0.12.3 — Compact projection of a WorldSeed for prompt injection.
//
// Two clients use this:
//   1. services/scenarioService.ts → generateScenarios() — turn-zero scenario generation
//   2. utils/promptUtils.ts → constructGeminiPrompt()    — first-turn primer (turnCount === 0)
//
// On every turn after the first, the hybrid RAG engine surfaces relevant
// lore/entities/NPCs organically, so the brief is intentionally only used
// at scenario generation and turn 1. This keeps ongoing per-turn token
// cost unchanged.
//
// Token cost is bounded by hard caps on each section's item count and
// per-item character length. Full-fidelity sections (tags, rules) are
// small by definition; locations/factions/NPCs/lore are top-N truncated.
// Target budget: ~1.0–1.5K tokens for a densely populated seed.

import { WorldSeed } from '../types';

// Per-section caps. Tuned to fit roughly within ~4800 chars (~1.2K tokens)
// when the seed is densely populated. Raise/lower here if budget changes.
const MAX_LOCATIONS = 5;
const MAX_FACTIONS = 5;
const MAX_NPCS = 8;
const MAX_LORE = 8;
const PER_ITEM_DESC_CHARS = 180; // one-line summary ceiling for descriptions

const truncate = (s: string | undefined, max: number = PER_ITEM_DESC_CHARS): string => {
    if (!s) return '';
    const trimmed = s.trim();
    if (trimmed.length <= max) return trimmed;
    return trimmed.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
};

/**
 * Build a compact, prompt-friendly summary of the world seed.
 *
 * Returns an empty string if the seed is null/undefined or has no content,
 * so callers can safely interpolate the result without null-guards.
 *
 * Output is plaintext + light markdown bullets, designed to interpolate
 * cleanly into either:
 *   - the scenarioService prompt (above the character JSON), or
 *   - a [WORLD PRIMER] block in constructGeminiPrompt.
 */
export const buildSeedBrief = (seed: WorldSeed | null | undefined): string => {
    if (!seed) return '';

    const lines: string[] = [];
    lines.push(`[WORLD: ${seed.name}]`);

    if (seed.description?.trim()) {
        lines.push(truncate(seed.description, 280));
    }

    if (seed.tags?.length) {
        lines.push(`Tone/genre tags: ${seed.tags.join(', ')}`);
    }

    if (seed.rules?.length) {
        lines.push('Rules:');
        for (const rule of seed.rules) {
            lines.push(`- ${rule.name}: ${truncate(rule.description, 160)}`);
        }
    }

    if (seed.locations?.length) {
        const shown = Math.min(MAX_LOCATIONS, seed.locations.length);
        lines.push(`Key locations (top ${shown} of ${seed.locations.length}):`);
        for (const loc of seed.locations.slice(0, MAX_LOCATIONS)) {
            const ctrl = loc.controllingFaction ? ` [${loc.controllingFaction}]` : '';
            lines.push(`- ${loc.name}${ctrl}: ${truncate(loc.description)}`);
        }
    }

    if (seed.factions?.length) {
        // Highest-influence factions first — they drive scenario stakes.
        const sorted = [...seed.factions].sort((a, b) => (b.influence ?? 0) - (a.influence ?? 0));
        const shown = Math.min(MAX_FACTIONS, sorted.length);
        lines.push(`Factions (top ${shown} of ${seed.factions.length} by influence):`);
        for (const f of sorted.slice(0, MAX_FACTIONS)) {
            const leader = f.leader ? ` led by ${f.leader}` : '';
            lines.push(`- ${f.name}${leader}: ${truncate(f.description)}`);
        }
    }

    if (seed.npcs?.length) {
        const shown = Math.min(MAX_NPCS, seed.npcs.length);
        lines.push(`Notable NPCs (top ${shown} of ${seed.npcs.length}):`);
        for (const npc of seed.npcs.slice(0, MAX_NPCS)) {
            const fac = npc.faction ? `, ${npc.faction}` : '';
            // Personality is rendered as a second line per NPC. It's
            // canonical characterization and must reach the model intact —
            // truncating it to 120 chars (like description) silently
            // collapsed seed-defined warm/diverse traits into the system
            // prompt's threat-parity default. Wider cap, own line.
            lines.push(`- ${npc.name} (${npc.role}${fac}, at ${npc.location}): ${truncate(npc.description, 140)}`);
            if (npc.personality?.trim()) {
                lines.push(`  Personality (canonical): ${truncate(npc.personality, 220)}`);
            }
        }
    }

    if (seed.lore?.length) {
        const shown = Math.min(MAX_LORE, seed.lore.length);
        lines.push(`Lore (top ${shown} of ${seed.lore.length}):`);
        for (const item of seed.lore.slice(0, MAX_LORE)) {
            lines.push(`- ${item.keyword} [${item.category}]: ${truncate(item.content, 160)}`);
        }
    }

    lines.push(
        'Treat the above as authoritative world canon. Anchor scenarios, NPCs, and locations to the entities listed here rather than inventing parallel substitutes. Do not contradict the rules or tone tags.'
    );

    return lines.join('\n');
};
