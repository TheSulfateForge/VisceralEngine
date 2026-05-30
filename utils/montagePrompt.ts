// ============================================================================
// montagePrompt.ts — Montage instruction builder (v0.13, Step 6 / System 5)
// ----------------------------------------------------------------------------
// Pure string assembly. Produces the trailing instruction the engine appends to
// the montage turn so the AI fills a `montage_block` instead of a normal scene.
// No IO, no Dexie — testable in isolation.
//
// The engine owns the elapsed time (declared-action duration); the AI only
// proposes the *artifacts* of that time (memories, traumas, skill gains, NPC
// drift, aging). Everything the AI returns is an UNCOMMITTED proposal the player
// reviews item-by-item, so the prompt asks for plausible, vetoable output rather
// than authoritative state.
// ============================================================================

import type { Character, GameWorld, DeclaredAction, MontageType } from '../types';
import { formatDeclaredDuration } from './engine/declaredActions';
import { MONTAGE_MAX_SKILL_ADVANCE_PER_SKILL } from '../config/engineConfig';

/** One-line roster of in-scope NPCs the AI may drift (id is what deltas key on). */
const knownEntityRoster = (world: GameWorld): string => {
    const entities = (world.knownEntities ?? []).filter(
        e => !e.status || e.status === 'present' || e.status === 'nearby' || e.status === 'distant',
    );
    if (entities.length === 0) return '(no known NPCs on record)';
    return entities
        .map(e => `  - id=${e.id} "${e.name}"${e.status ? ` [${e.status}]` : ''}`)
        .join('\n');
};

/** Compact list of the PC's current skills so proposed advances stay grounded. */
const currentSkills = (character: Character): string => {
    const skills = character.skills ?? [];
    if (skills.length === 0) return '(no skills on record yet)';
    return skills.map(s => `${s.name} (${s.level})`).join(', ');
};

const TYPE_GUIDANCE: Record<MontageType, string> = {
    training: 'Focus on skill growth earned through deliberate practice. Memories should mark milestones, plateaus, or breakthroughs — not every session.',
    travel:   'Focus on the passage across places: what changed in the world, who was met or lost, what the journey cost. Skill gains are incidental, not the point.',
    aging:    'Years pass. Propose aging for the PC and for NPCs (age, role changes, marriages, deaths). Memories are sparse and load-bearing — the texture of a life, not a diary.',
    rest:     'Recovery and routine. Light on artifacts: maybe one settling memory, trauma easing rather than accruing, little to no skill change.',
    work:     'Labor and obligation. Propose memories of the work itself, any skills the trade sharpened, and how standing/relationships shifted.',
};

/**
 * Build the montage instruction block appended to the turn's trailing reminder.
 * `declaredAction` carries the engine-fixed duration; `montageType` selects the
 * tonal guidance. Output is plain text (no markdown fences) ready to join into
 * the reminder string.
 */
export function buildMontageInstruction(
    declaredAction: DeclaredAction,
    montageType: MontageType,
    character: Character,
    world: GameWorld,
): string {
    const durationLabel = formatDeclaredDuration(declaredAction.unit, declaredAction.quantity);
    const focusLine = declaredAction.focus
        ? `The player set a focus: "${declaredAction.focus}". Center the montage on it.`
        : 'No explicit focus — infer a sensible emphasis from the character and situation.';

    return [
        '[MONTAGE MODE]',
        `A span of time passes: ${durationLabel} (${montageType}). ${focusLine}`,
        'The engine has ALREADY advanced the clock by this duration — do not narrate a different elapsed time. Your job is to propose the ARTIFACTS of the elapsed time as a montage_block. Everything you return is an uncommitted proposal the player will review, edit, or veto item by item, so propose plausibly and do not assume any item will stick.',
        '',
        `Tonal guidance: ${TYPE_GUIDANCE[montageType]}`,
        '',
        'Fill the montage_block fields:',
        `- proposed_memories: a SMALL number of load-bearing memories (typically 1–4). Each: { summary, salience 1–5, pinned?, can_play_out? }. Set can_play_out=true only for a memory vivid enough to be worth playing as a live scene.`,
        '- proposed_traumas: only if the focus genuinely warrants it. Each: { description, severity 1–5, source }. Most montages propose none.',
        `- proposed_skill_updates: Path A advancement only. Each: { skill_name, new_level, category?, reason }. HARD CAP: at most ${MONTAGE_MAX_SKILL_ADVANCE_PER_SKILL} proficiency tier per skill for the WHOLE montage regardless of duration — duration gates whether growth is earned, it is not a multiplier. You MAY propose brand-new skills the character's environment/family/era would plausibly impart; the player can veto them.`,
        '- proposed_npc_deltas: one per relevant known NPC below. Each: { entity_id, change_type, description }. change_type ∈ none|aged|moved|married|died|role_change|new_relationship. Use the exact entity_id. Prefer "none" over inventing change; a long span should still move SOME NPCs so the world is not frozen.',
        '- age_increment_years: whole years the PC ages (0 for sub-year montages).',
        '- season_delta: optional human-readable note on seasonal/era shift.',
        '',
        `Character skills on record: ${currentSkills(character)}`,
        'Known NPCs (use these exact ids for proposed_npc_deltas):',
        knownEntityRoster(world),
        '',
        'Also write a `narrative`: a tight prose montage (a few paragraphs) summarizing the span. Do NOT enumerate the proposed_* items as a list inside the narrative — the player sees those separately.',
    ].join('\n');
}
