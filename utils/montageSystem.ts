// ============================================================================
// montageSystem.ts — Montage Proposal Build + Commit (v0.13, Steps 6/7/9)
// ----------------------------------------------------------------------------
// Pure transforms only — NO Dexie / IO here (the DB transaction wraps the
// committed result in db/index.ts). Two halves:
//   1. buildMontageProposal — wrap an AI `montage_block` into a reviewable,
//      uncommitted `MontageProposal` (per-item id + status='pending').
//   2. commitMontageProposal — apply all NON-vetoed items to Character + World
//      (memories, traumas, skills [Path A, 1-tier cap], NPC drift, aging) and
//      advance the clock. Returns new state + a human-readable event log.
// See TIME_AND_MONTAGE_DESIGN.md System 5.
// ============================================================================

import type {
    Character,
    GameWorld,
    MemoryItem,
    KnownEntity,
    MontageBlock,
    MontageProposal,
    DeclaredAction,
    ProposedMemory,
    ProposedTrauma,
    ProposedSkillUpdate,
    ProposedNpcDelta,
    ReviewableItem,
    CalendarConfig,
} from '../types';
import { generateUUID, generateMemoryId } from '../idUtils';
import { applySkillUpdates, PROFICIENCY_LADDER, isProficiencyLevel } from './skillSystem';
import { updateTime } from './engine/timeUtils';
import {
    DEFAULT_CALENDAR,
    MONTAGE_DEFAULT_MEMORY_SALIENCE,
    PINNED_MEMORY_SALIENCE_THRESHOLD,
} from '../config/engineConfig';

// --- Proposal construction -------------------------------------------------

const wrap = <T>(data: T): ReviewableItem<T> => ({
    id: generateUUID(),
    status: 'pending',
    data,
    original: data,
});

/**
 * Wrap an AI montage block into an uncommitted, reviewable proposal. The
 * proposal is held in the pending slice and persisted to the `pending_montage`
 * row so a mid-review app close survives. Nothing is written to the character
 * or world until `commitMontageProposal` runs.
 */
export function buildMontageProposal(
    block: MontageBlock,
    declaredAction: DeclaredAction,
    campaignId: string,
    currentTurn: number,
    narrative: string,
): MontageProposal {
    return {
        id: generateUUID(),
        campaignId,
        createdTurn: currentTurn,
        declaredAction,
        type: block.type,
        durationMinutes: block.duration_minutes || declaredAction.durationMinutes,
        focus: block.focus,
        ageIncrementYears: Math.max(0, Math.round(block.age_increment_years || 0)),
        seasonDelta: block.season_delta,
        narrative,
        memories: (block.proposed_memories ?? []).map(wrap),
        traumas: (block.proposed_traumas ?? []).map(wrap),
        skillUpdates: (block.proposed_skill_updates ?? []).map(wrap),
        npcDeltas: (block.proposed_npc_deltas ?? []).map(wrap),
        regenerateCount: 0,
        status: 'reviewing',
    };
}

/** An item is committed unless the player explicitly vetoed it. */
const approved = <T>(item: ReviewableItem<T>): boolean => item.status !== 'vetoed';

// --- Commit transform ------------------------------------------------------

export interface MontageCommitResult {
    character: Character;
    world: GameWorld;
    /** Human-readable log lines for the debug log / narrative beat. */
    events: string[];
}

/**
 * Apply a reviewed proposal to character + world. Idempotent in the sense that
 * it derives entirely from inputs; callers should run it exactly once on accept
 * and then clear the held proposal. The clock advances by the declared duration
 * REGARDLESS of how many items were vetoed (the player asked for the time).
 */
export function commitMontageProposal(
    proposal: MontageProposal,
    character: Character,
    world: GameWorld,
    currentTurn: number,
    calendar: CalendarConfig = DEFAULT_CALENDAR,
): MontageCommitResult {
    const events: string[] = [];
    let char: Character = { ...character };
    let w: GameWorld = { ...world };

    // 1. Memories ------------------------------------------------------------
    const newMemories: MemoryItem[] = [];
    for (const item of proposal.memories) {
        if (!approved(item)) continue;
        const m = item.data as ProposedMemory;
        const summary = (m.summary ?? '').trim();
        if (!summary) continue;
        let salience = typeof m.salience === 'number'
            ? Math.max(1, Math.min(5, Math.round(m.salience)))
            : MONTAGE_DEFAULT_MEMORY_SALIENCE;
        // Honor an explicit pin by ensuring the entry clears the pin threshold.
        if (m.pinned) salience = Math.max(salience, PINNED_MEMORY_SALIENCE_THRESHOLD);
        newMemories.push({
            id: generateMemoryId(),
            fact: summary,
            timestamp: new Date().toISOString(),
            salience,
            turnCreated: currentTurn,
        });
    }
    if (newMemories.length > 0) {
        w = { ...w, memory: [...w.memory, ...newMemories] };
        events.push(`[MONTAGE] +${newMemories.length} memory engram(s)`);
    }

    // 2. Traumas → trauma score + persistent conditions ----------------------
    const approvedTraumas = proposal.traumas.filter(approved).map(i => i.data as ProposedTrauma);
    if (approvedTraumas.length > 0) {
        // Map severity (1–5) → trauma points (×5). Clamp the running score 0–100.
        const traumaDelta = approvedTraumas.reduce(
            (sum, t) => sum + Math.max(1, Math.min(5, Math.round(t.severity || 1))) * 5,
            0,
        );
        const newTrauma = Math.max(0, Math.min(100, (char.trauma ?? 0) + traumaDelta));
        const newConditions = [...(char.conditions ?? [])];
        for (const t of approvedTraumas) {
            const desc = (t.description ?? '').trim();
            if (desc && !newConditions.includes(desc)) newConditions.push(desc);
        }
        char = { ...char, trauma: newTrauma, conditions: newConditions };
        events.push(`[MONTAGE] trauma +${traumaDelta} (now ${newTrauma}), +${approvedTraumas.length} condition(s)`);
    }

    // 3. Skills (Path A, capped to ONE tier per skill) -----------------------
    const approvedSkills = proposal.skillUpdates.filter(approved).map(i => i.data as ProposedSkillUpdate);
    if (approvedSkills.length > 0) {
        const clamped = approvedSkills.map(u => clampSkillToOneTier(char, u));
        const { character: updatedChar, events: skillEvents } = applySkillUpdates(char, clamped, currentTurn);
        char = updatedChar;
        for (const e of skillEvents) {
            events.push(`[MONTAGE:SKILL] ${e.skillName} ${e.fromLevel ?? 'NEW'} → ${e.toLevel}`);
        }
    }

    // 4. NPC drift -----------------------------------------------------------
    const approvedDeltas = proposal.npcDeltas.filter(approved).map(i => i.data as ProposedNpcDelta);
    if (approvedDeltas.length > 0) {
        const entities = applyNpcDeltas(w.knownEntities ?? [], approvedDeltas, currentTurn, events);
        w = { ...w, knownEntities: entities };
    }

    // 5. Aging ---------------------------------------------------------------
    if (proposal.ageIncrementYears > 0) {
        char = { ...char, age: (char.age ?? 0) + proposal.ageIncrementYears };
        events.push(`[MONTAGE] aged +${proposal.ageIncrementYears}y (now ${char.age})`);
    }

    // 6. Clock advance (always — even on veto-all) ---------------------------
    w = { ...w, time: updateTime(w.time.totalMinutes, proposal.durationMinutes, calendar) };
    events.push(`[MONTAGE] clock → ${w.time.display}`);

    return { character: char, world: w, events };
}

/**
 * Advance only the clock (used by the veto-all path: the player explicitly
 * asked for the duration, so time passes even though no artifacts commit).
 */
export function advanceClockForMontage(
    world: GameWorld,
    durationMinutes: number,
    calendar: CalendarConfig = DEFAULT_CALENDAR,
): GameWorld {
    return { ...world, time: updateTime(world.time.totalMinutes, durationMinutes, calendar) };
}

// --- internals -------------------------------------------------------------

/**
 * Cap an AI skill update so it advances at most one proficiency tier per
 * montage. Existing skill → currentRank + 1. NEW skill → 'familiar' at most
 * (one meaningful tier of acquisition; lean — see design doc skill rules).
 */
function clampSkillToOneTier(
    character: Character,
    update: ProposedSkillUpdate,
): ProposedSkillUpdate {
    if (!isProficiencyLevel(update.new_level)) return update; // applySkillUpdates will skip it
    const name = (update.skill_name ?? '').trim().toLowerCase();
    const existing = (character.skills ?? []).find(s => s.name.toLowerCase() === name);
    const existingRank = existing ? PROFICIENCY_LADDER.indexOf(existing.level) : -1;
    const maxRank = Math.min(
        existingRank < 0 ? 1 : existingRank + 1,
        PROFICIENCY_LADDER.length - 1,
    );
    const targetRank = PROFICIENCY_LADDER.indexOf(update.new_level);
    if (targetRank > maxRank) {
        return { ...update, new_level: PROFICIENCY_LADDER[maxRank] };
    }
    return update;
}

/** Apply per-entity montage deltas. Returns a new entities array. */
function applyNpcDeltas(
    entities: KnownEntity[],
    deltas: ProposedNpcDelta[],
    currentTurn: number,
    events: string[],
): KnownEntity[] {
    const byId = new Map(entities.map(e => [e.id, e]));
    for (const d of deltas) {
        if (d.change_type === 'none') continue;
        const ent = byId.get(d.entity_id);
        if (!ent) continue;
        const desc = (d.description ?? '').trim();
        const ledger = [...(ent.ledger ?? []), `[montage:${d.change_type}] ${desc}`];
        let updated: KnownEntity = { ...ent, ledger };
        if (d.change_type === 'died') {
            updated = {
                ...updated,
                status: 'dead',
                exitReason: desc || 'died during montage',
                statusChangedTurn: currentTurn,
            };
        }
        byId.set(d.entity_id, updated);
        events.push(`[MONTAGE:NPC] ${ent.name}: ${d.change_type}`);
    }
    return Array.from(byId.values());
}
