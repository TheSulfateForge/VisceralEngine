// ============================================================================
// utils/hookNudge.ts — v1.25
//
// AMBIENT HOOK NUDGE. The engine is very good at not railroading the player —
// and, as a side effect, never volunteers anything. The world pulse writes
// [OPPORTUNITY] lines into the hidden registry, but the registry is passive
// context and §5's "default state is NO THREATS" trains the model to sit on
// it. This module closes the loop: on a jittered cadence, during calm
// narrative beats, code picks ONE hook from established world state and
// instructs the model to surface it as something noticeable and IGNORABLE.
//
// Everything the model is bad at (timing, rate-limiting, content selection,
// non-repetition) is decided in code; the model only weaves a given line
// into prose. Cost: ~80 prompt tokens roughly every 8-12 turns.
//
// Source priority (all pre-existing content — nothing is invented here):
//   1. An unconsumed [OPPORTUNITY] line from the hidden registry
//      (consumed after surfacing so it never repeats).
//   2. A dormant hook FORESHADOW — a rumor brushing against the hook,
//      explicitly not an activation (Origin Gate untouched).
//   3. A trace of an offscreen NPC's recent activity (ledger tail).
// ============================================================================

import { GameWorld } from '../types';

export interface AmbientHook {
    /** Prompt block appended to the trailing reminder. */
    block: string;
    /** Short description for the debug log. */
    summary: string;
    /** Exact registry line to strike after surfacing (opportunity source only). */
    consumeRegistryLine?: string;
}

// Cadence state — module-scoped, resets on reload (harmless: worst case the
// first nudge of a session arrives a few turns early or late).
const NUDGE_INTERVAL_MIN = 8;
const NUDGE_INTERVAL_JITTER = 5;   // interval ∈ [8, 12]
let lastNudgeTurn = 0;
let currentInterval =
    NUDGE_INTERVAL_MIN + Math.floor(Math.random() * NUDGE_INTERVAL_JITTER);

const TENSION_CEILING = 40;
const IMMINENT_THREAT_ETA = 3;
const MIN_TURN = 5;

/** Eligibility: calm NARRATIVE beat, cadence elapsed, nothing imminent. */
export const shouldNudgeHook = (turnCount: number, world: GameWorld): boolean => {
    if (turnCount < MIN_TURN) return false;
    if (turnCount - lastNudgeTurn < currentInterval) return false;
    if ((world.sceneMode ?? 'NARRATIVE') !== 'NARRATIVE') return false;
    if ((world.tensionLevel ?? 0) >= TENSION_CEILING) return false;
    if ((world.emergingThreats ?? []).some(t => (t.turns_until_impact ?? 99) <= IMMINENT_THREAT_ETA)) {
        return false;
    }
    return true;
};

/** Record that a nudge fired this turn and re-roll the next interval. */
export const markHookNudged = (turn: number): void => {
    lastNudgeTurn = turn;
    currentInterval =
        NUDGE_INTERVAL_MIN + Math.floor(Math.random() * NUDGE_INTERVAL_JITTER);
};

const buildBlock = (hookText: string, extraRule: string = ''): string => `[AMBIENT HOOK — surface ONCE, gently]
Weave the following into this turn's narrative as something the PC notices, overhears, or receives in passing:
  "${hookText}"
Rules: it must be IGNORABLE. Do NOT interrupt or redirect the player's stated action. No threat, no obligation, no roll_request. One or two sentences woven into the scene — a notice board, a snatch of conversation, a passing sight. If the player does not engage, drop it; it does not recur.${extraRule ? `\n${extraRule}` : ''}`;

const pickRandom = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

/**
 * Select one ambient hook from established world state. Returns null when no
 * suitable source exists (the nudge is simply skipped that turn — cadence is
 * NOT consumed, so it retries next turn).
 */
export const selectAmbientHook = (world: GameWorld): AmbientHook | null => {
    // 1. Unconsumed [OPPORTUNITY] registry line (oldest first — FIFO keeps
    //    the registry from silting up with stale openings).
    const registryLines = (world.hiddenRegistry ?? '').split('\n');
    const opportunityLine = registryLines.find(l => /^\[OPPORTUNITY[^\]]*\]/.test(l.trim()));
    if (opportunityLine) {
        const text = opportunityLine.trim().replace(/^\[OPPORTUNITY[^\]]*\]\s*/, '');
        if (text) {
            return {
                block: buildBlock(text),
                summary: `opportunity: ${text.slice(0, 60)}`,
                consumeRegistryLine: opportunityLine,
            };
        }
    }

    // 2. Dormant hook foreshadow — atmosphere only, never an activation.
    const dormant = (world.dormantHooks ?? []).filter(h => h.status === 'dormant');
    if (dormant.length > 0) {
        const hook = pickRandom(dormant);
        return {
            block: buildBlock(
                `A faint thread connected to: ${hook.summary}`,
                'This is FORESHADOW ONLY — do not activate the hook, do not seed a threat, do not name the tension outright. A rumor, a glimpse, a familiar name in passing.',
            ),
            summary: `foreshadow: ${hook.id}`,
        };
    }

    // 3. Trace of an offscreen NPC's recent activity.
    const offscreen = (world.knownEntities ?? []).filter(e =>
        e.status !== 'dead' &&
        (e.status === 'distant' || e.status === 'nearby') &&
        (e.ledger?.length ?? 0) > 0
    );
    if (offscreen.length > 0) {
        const npc = pickRandom(offscreen);
        const trace = npc.ledger[npc.ledger.length - 1];
        return {
            block: buildBlock(
                `A secondhand trace of ${npc.name} (${npc.role}): ${trace}`,
                'Render it as indirect — a mention, a sighting at a distance, a note — not the NPC arriving in the scene.',
            ),
            summary: `npc-trace: ${npc.name}`,
        };
    }

    return null;
};
