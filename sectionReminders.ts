// ============================================================================
// SECTIONREMINDERS.TS — v1.6
//
// v1.3 changes:
//   - Added BARGAIN_CHECK reminder.
//   - Added THREAT_SEED_INTEGRITY reminder.
//   - Added GOAL_LIFECYCLE reminder.
//   - Added ENTITY_DENSITY reminder.
//
// v1.4 changes:
//   - THREAT_SEED_INTEGRITY updated: information chain declaration,
//     travel companion containment, threat proportionality requirement.
//   - New WORLD_NORMALCY reminder (priority 5.5).
//
// v1.5 changes:
//   - FIX 6: entityCount parameter — ENTITY_DENSITY fires every turn when
//     density obligation is unmet.
//   - FIX 11: goalCount parameter — GOAL_LIFECYCLE fires when goalCount < 2
//     past turn 10 and every 3 turns in NARRATIVE mode.
//   - CONDITION_AUDIT elevated to Priority 0 when conditionsCount > 30.
//
// v1.6 changes:
//   - THREAT_SEED_INTEGRITY fully replaced with Origin Gate version.
//     Origin Gate checklist is the first check in the reminder, above all others.
//     The AI must cite a dormant hook ID, a specific player action, or a faction
//     with established exposure before any threat seed is permitted.
// ============================================================================

import { SceneMode } from './types';

// Condensed reinforcements derived from SYSTEM_INSTRUCTIONS
const REMINDERS = {
    LOGISTICS_CHECK: `[SYSTEM REMINDER: LOGISTICS & DISTANCE VALIDATION v1.7]
Before writing NPC actions or advancing threats this turn, verify:

1. WHERE IS EACH THREAT ENTITY RIGHT NOW?
   Not where you want them. If they were 200 miles away last turn and 15 minutes
   passed, they are STILL ~200 miles away (cavalry moves ~1 mile per 1.5 hours).

2. HOW DID THE DISTANT FACTION LEARN ABOUT RECENT EVENTS?
   Name the specific messenger and communication method. "They learned" is invalid.
   If no communication chain exists, they DON'T KNOW YET.

3. RESPONSE TIME: Even after learning, organizing takes time.
   A local cell can react in hours. Cavalry takes days to muster. An army takes weeks.

4. NPC ACTION COHERENCE: Your world_tick NPC actions CANNOT show a threat entity
   arriving if that threat's ETA is > 3. The engine WILL BLOCK such actions.
   Show threats TRAVELING, not ARRIVING.

5. LOCAL ASSETS ONLY for fast responses. If local agents exist in lore, THEY can
   act quickly — but limited to their pre-established capability. You cannot
   invent new local assets mid-crisis.

REMEMBER: A realistic delayed response creates BETTER drama than an omniscient instant one.
The player correctly identified the last logistics violation. Do not repeat it.`,

    VOCABULARY: `[SYSTEM REMINDER: FORBIDDEN VOCABULARY]
CRITICAL CHECK. Scan your intended output:
1. Are you using BANNED NAMES? (Elara, Kaela, Lyra, Kael, Vex, Thorne...) -> REPLACE with a completely original name. No near-homophones. No numbered suffixes.
2. Are you using EUPHEMISMS? (Member, core, folds, flower, heat, sex...) -> USE ANATOMICAL TERMS.
3. Are you using CLICHÉS? (Heart pounded, shiver down spine, released breath...) -> BE SPECIFIC.`,

    INTIMATE: `[SYSTEM REMINDER: INTIMATE SCENE PROTOCOL]
1. SENSORY SATURATION: Smell, taste, texture, sound.
2. ANATOMICAL PRECISION: Name the parts. Describe the mechanics.
3. PSYCHOLOGICAL DEPTH: Shame, fear, vulnerability, chaotic thoughts.
4. NO BLANDNESS: No "waves of pleasure". No symmetrical orgasms.`,

    COMBAT: `[SYSTEM REMINDER: COMBAT REALISM]
1. OODA LOOP: Enemies Observe, Orient, Decide, Act. They adapt.
2. MORALE: Amateurs flee at 30% casualties. Professionals fall back. Fanatics fight to death.
3. ENVIRONMENT: Use lighting, cover, terrain. Do not fight in a vacuum.
4. WOUNDS MATTER: Injuries degrade capability. Track them in conditions.`,

    NARRATIVE_INTEGRITY: `[SYSTEM REMINDER: NARRATIVE INTEGRITY]
Before writing this turn, audit your output against these checks:

CONDITIONS: Are you adding a new condition this turn?
→ State in thought_process: "This condition is caused by [specific event THIS turn]."
→ Is it already in the Conditions list under a different name? If so, do NOT add it.
One bad moment ≠ multiple new conditions.
→ Are any of these conditions recently cleared by the player? If so, you need a stronger new cause.

NEW LORE: Are you proposing new_lore?
→ Does it document something discovered THIS TURN, or does it retroactively justify something you already wrote?
→ Is it a semantic variation of an existing lore entry (similar meaning, different keyword)? If so, skip it.
→ Retroactive lore that worsens the player's position (new enemy capabilities, factions, etc.) is a SIMULATION FAILURE.

THREAT SCALE: Are emerging threats proportional to the established faction's known resources?
→ A small patrol → small manhunt, not a kingdom-wide dragnet with magical assets.

FIDELITY renders everything. INTEGRITY ensures what's rendered is consistent. Both rules apply.`,

    WORLD_PULSE: `[SYSTEM REMINDER: WORLD PULSE — PROACTIVITY CHECK]
The world_tick field is REQUIRED. Before writing your narrative:
1. What did at least ONE named NPC do this turn? (Check their goals in the entity registry.)
2. Did anything change in the environment? (Time, weather, crowds, sounds.)
3. Is any threat developing off-screen? (Seed emerging_threats for future turns.)
4. Should any NPC interrupt this scene? (Debt collectors, rivals, allies with news.)
If no NPC has a pressing goal, show mundane life — they are people, not quest markers.
DO NOT submit a response with an empty world_tick.`,

    BARGAIN_CHECK: `[SYSTEM REMINDER: DEVIL'S BARGAIN — MANDATORY OFFER DUE]
The Devil's Bargain clock has exceeded 20 turns without an offer.
On the NEXT qualifying roll (difficulty implying Hard or Severe, failure = death/loss/irreversible consequence), you MUST offer a Bargain alongside the roll.
This is not optional. The bargain_request field must be populated.
After offering the bargain (accepted or not), the clock resets.
Bargain costs must be SPECIFIC, PERMANENT, and a genuine trade-off. Never vague.`,

    // v1.6: Fully replaced with Origin Gate version
    THREAT_SEED_INTEGRITY: `[SYSTEM REMINDER: THREAT SEED PROTOCOL — INTEGRITY CHECK v1.6]
Before writing or updating any emerging_threats this turn, verify ALL of the following:

━━━ ORIGIN GATE — CHECK THIS FIRST ━━━
Every new threat seed must pass at least ONE of these three tests:

TEST A — BACKGROUND HOOK: Does this threat derive from the character's established backstory,
relationships, or secrets — a pre-existing tension now activating?
→ If yes: populate dormant_hook_id with the exact ID from the [ORIGIN GATE CONTEXT] block above.
→ If the hook ID doesn't exist in that list, this test FAILS.

TEST B — PLAYER ACTION THIS SESSION: Did the player take a specific, observable action this
session that created a new causal chain? Did a named, registered NPC witness it?
→ If yes: populate player_action_cause with "[NPC name] observed [action] at [location] on turn [N]".
→ Vague causes ("the player attracted attention") FAIL. The NPC must exist in the entity registry.

TEST C — FACTION EXPOSURE: Has the factionSource accumulated sufficient observed presence this
session? Check the [ORIGIN GATE CONTEXT] exposure scores above.
→ If the faction's score is below 20, they have not observed enough to threaten. BLOCKED.

DEFAULT STATE IS NO THREATS. A fresh character in a city they have no history in starts with
zero valid threat seeds. The world is not hostile until something makes it so.

COMMON VIOLATIONS (all FORBIDDEN):
✗ Debt collectors without debt in backstory or player action this session
✗ Any faction mobilizing before being shown observing the player in world_tick
✗ Threats based on race, appearance, or abilities alone — these build exposure over time, not threats
✗ Inventing NPCs or events not established in character data or session lore to justify a threat

━━━ ETA FLOORS ━━━
→ New faction-level threat (guild, chapter, company, noble house): ETA must be ≥ 15.
  The engine enforces this — ETAs below floor are auto-raised.
→ New individual threat (neutral NPC not in their home territory): ETA must be ≥ 5.

━━━ ETA ~1 DURATION ━━━
→ Any threat at ETA ~1 for 2+ consecutive turns MUST trigger this turn or be removed with a
  specific in-world reason. Not "still imminent."

━━━ SEED CAP ━━━
→ More than 3 seeds? Resolve or expire the oldest before adding new ones.

━━━ CAPABILITY PRE-EXISTENCE ━━━
→ Does this threat require a faction capability not yet in lore? If so, ETA floor DOUBLES.

━━━ INFORMATION CHAIN (state in thought_process before seeding) ━━━
→ "[THREAT CHAIN] <Faction> learned about <event> because: Step 1: [observer + when].
  Step 2: [communication channel + delay]. Step 3: [faction receipt + delay].
  Total ETA floor: [sum of delays in turns]."
→ NPC traveling with player: cannot have warned anyone unless communication was shown in narrative.
→ NPC detained: cannot warn anyone at all.
→ Cannot name the observer and channel using pre-established entities? Threat is FORBIDDEN.

━━━ PROPORTIONALITY ━━━
→ Most conflicts → Minor or Moderate complication. Severe is for major, deliberate antagonism.
→ Minor inconvenience (ETA 2-5): local complains, petty fine, mild weather.
→ Moderate complication (ETA 5-12): creditor asks questions, guard remembers a face.
→ Significant threat (ETA 12-20): faction notices pattern, bounty posted, investigator assigned.
→ Severe threat (ETA 20+): faction mobilizes, hit ordered, legal status changes.`,

    GOAL_LIFECYCLE: `[SYSTEM REMINDER: GOAL LIFECYCLE — STALE GOAL AUDIT]
Review the character's active goals list in your thought_process before this turn:

COMPLETION CHECK: Has any goal been narratively fulfilled?
→ If yes, include it in character_updates.removed_conditions (or goals removal mechanism) THIS TURN.
→ A completed goal must not persist beyond the turn of its completion.

STALENESS CHECK: Has any goal been unchanged and unreferenced for many turns?
→ Either restate it with current progress or remove it if implicitly abandoned.

BLOAT CHECK: Are there more than 5 active goals?
→ Consolidate, complete, or archive before adding new ones.

SPARSE CHECK: Are there fewer than 2 active goals at a mid-to-late stage of the simulation?
→ The character should have medium-term ambitions reflecting their current status.
→ Tactical combat goals are not a substitute for character-driven objectives.

Goals are active objectives, not permanent labels. They must reflect the current state of play.`,

    ENTITY_DENSITY: `[SYSTEM REMINDER: ENTITY REGISTRY — POPULATION CHECK]
The known_entity registry must reflect the living world. Check current entity count in your thought_process.

If turn < 10 and entity count < 5: You must add at least one new entity this turn.
If turn < 30 and entity count < 10: You must add at least one new entity this turn.
If turn < 60 and entity count < 15: You must add at least one new entity this turn.
If turn ≥ 60 and entity count < 15: DENSITY OBLIGATION IS OVERDUE. You must add at least TWO new entities this turn.

CREATION OBLIGATION: Any NPC who speaks dialogue, takes an autonomous action, or is named in narrative this turn — if they are not already in the entity registry — must be added to known_entity_updates before this turn ends.

The inn has a staff. The city has a guard captain. The market has vendors. Populate them.`,

    WORLD_NORMALCY: `[SYSTEM REMINDER: POPULATION BASELINE — THE WORLD IS MOSTLY NORMAL]
Before writing any NPC encounter or world_tick NPC action, apply the population baseline:

70% of people are ordinary civilians: travelers, merchants, farmers, guards doing their jobs.
20% have minor complications (gruff, suspicious, opportunistic, frightened of strangers).
10% have meaningful agendas relevant to the player.

ENCOUNTER GENERATION RULE: Start from the 70% baseline, not the 10%.
→ A traveler on a road is a traveler on a road.
→ Suspicion, hostility, and predatory behavior must be EARNED by established context.
→ If the player is moving quietly with no flags, default is ordinary human interaction.

Threat seeds must not treat every NPC as a latent enemy or faction operative.`,

    FIDELITY: `[SYSTEM REMINDER: SIMULATION FIDELITY]
FIDELITY CHECK: Is everything you are about to render grounded in established facts?
→ Physics, biology, world lore, and NPC capabilities must be consistent with prior turns.
→ NPCs do not have knowledge they could not have obtained through shown means.
→ The world does not bend to create convenient drama — it operates on its own logic.`,

    CONDITION_AUDIT: `[SYSTEM REMINDER: CONDITION AUDIT — MANDATORY PRUNE REQUIRED]
The character's condition list has exceeded 25 entries. MANDATORY PRUNE IS ACTIVE.

RULE: You MUST include at least 3 removals in removed_conditions this turn before adding any new conditions. The engine enforces this — additions will be blocked if fewer than 3 removals are provided.

PRUNE CHECKLIST:
→ TRANSIENTS: Remove all Adrenaline, Afterglow, Overclock, Soot-Stained, and other short-lived conditions that are no longer narratively active.
→ DUPLICATES: Are two conditions describing the same state? Remove the old version — keep only the most current, specific one.
→ LOCATION-BOUND: Has the character left a location named in a condition? Remove it.
→ NPC-BOUND: Is the source NPC detained, dead, or removed from play? Remove the condition.
→ REPUTATION BLOAT: Multiple Icon/Savior/Hero conditions describing the same social status? Consolidate into one definitive entry.
→ ROYAL STATUS BLOAT: Multiple "Royal X" conditions? Consolidate into the most specific and current ones.

The engine will BLOCK all new condition additions until the prune obligation is met.
Replacements must remove the old version simultaneously.`,
};

// ---------------------------------------------------------------------------
// Entity density requirements table (mirrors the constants in simulationEngine.ts)
// ---------------------------------------------------------------------------

const ENTITY_DENSITY_REQUIREMENTS: [number, number][] = [
    [10,  5],
    [30, 10],
    [60, 15],
];

const entityDensityViolated = (currentTurnCount: number, entityCount: number): boolean => {
    for (const [turnThresh, entityMin] of ENTITY_DENSITY_REQUIREMENTS) {
        if (currentTurnCount >= turnThresh && entityCount < entityMin) return true;
    }
    return false;
};

/**
 * Returns the appropriate section reminder for this turn, or null if none applies.
 *
 * v1.6: THREAT_SEED_INTEGRITY now leads with the Origin Gate checklist.
 */
export const getSectionReminder = (
    turnCount: number,
    mode: SceneMode,
    lastBargainTurn: number = 0,
    currentTurnCount: number = 0,
    conditionsCount: number = 0,
    entityCount: number = 0,
    goalCount: number = 999,
    emergingThreatsCount: number = 0
): string | null => {
    // Priority -1 (Absolute): Mandatory Condition Audit when conditions > 30
    if (conditionsCount > 30) {
        return REMINDERS.CONDITION_AUDIT;
    }

    if (turnCount < 3) return null;

    // Priority 0: BARGAIN CLOCK
    const turnsSinceLastBargain = currentTurnCount - lastBargainTurn;
    if (turnsSinceLastBargain >= 25 && currentTurnCount > 0) {
        return REMINDERS.BARGAIN_CHECK;
    }

    // Priority 0.5: Entity Density — fires every turn while obligation is unmet
    if (entityDensityViolated(currentTurnCount, entityCount)) {
        return REMINDERS.ENTITY_DENSITY;
    }

    // Priority 1.5: Logistics Check — fires every turn while threats exist
    if (emergingThreatsCount > 0) {
        // Only fire every other turn to avoid drowning out other reminders
        if (turnCount % 2 === 0) return REMINDERS.LOGISTICS_CHECK;
    }

    // Priority 1: Vocabulary (Every 4 turns)
    if (turnCount % 4 === 0) return REMINDERS.VOCABULARY;

    // Priority 2: Intimate Protocol (Social Mode Only, every 3 turns)
    if (mode === 'SOCIAL' && turnCount % 3 === 0) return REMINDERS.INTIMATE;

    // Priority 3: Combat Tactics (Combat Mode Only, every 3 turns)
    if (mode === 'COMBAT' && turnCount % 3 === 0) return REMINDERS.COMBAT;

    // Priority 4: Condition Audit (Every 5 turns)
    if (turnCount % 5 === 0) return REMINDERS.CONDITION_AUDIT;

    // Priority 5: Threat Seed Integrity (Every 6 turns during TENSION/COMBAT,
    // every 10 turns otherwise)
    if ((mode === 'TENSION' || mode === 'COMBAT') && turnCount % 6 === 0) return REMINDERS.THREAT_SEED_INTEGRITY;
    if (turnCount % 10 === 0) return REMINDERS.THREAT_SEED_INTEGRITY;

    // Priority 5.5: World Normalcy (Every 8 turns, offset by 4)
    if ((turnCount - 4) % 8 === 0 && turnCount >= 4) return REMINDERS.WORLD_NORMALCY;

    // Priority 6: Simulation Fidelity (Every 6 turns, offset from threat check)
    if (turnCount % 6 === 1) return REMINDERS.FIDELITY;

    // Priority 6.5: Goal Lifecycle
    if (currentTurnCount > 10 && goalCount < 2) return REMINDERS.GOAL_LIFECYCLE;
    if (mode === 'NARRATIVE' && turnCount % 3 === 0 && goalCount < 3) return REMINDERS.GOAL_LIFECYCLE;
    if ((turnCount - 2) % 8 === 0 && turnCount >= 2) return REMINDERS.GOAL_LIFECYCLE;

    // Priority 7: Narrative Integrity (Every 7 turns)
    if (turnCount % 7 === 0) return REMINDERS.NARRATIVE_INTEGRITY;

    return null;
};
