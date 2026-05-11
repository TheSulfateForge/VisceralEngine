// ============================================================================
// SECTIONREMINDERS.TS — v1.19
//
// v1.19 changes (Prompt Diet):
//   - Moved DREAM_PROTOCOL out of SYSTEM_INSTRUCTIONS — it now fires only
//     when the runtime detects an active [DREAM SEED] in context.
//   - Moved LANGUAGES_FOREIGN out of SYSTEM_INSTRUCTIONS — fires only when
//     the caller signals that a foreign-language NPC interaction is pending.
//   - Moved HEALING_TIMELINE out of SYSTEM_INSTRUCTIONS — fires only when an
//     injury was just added this turn, or on a low-frequency rotation.
//   This keeps the base systemInstruction short while still surfacing the
//   full rule text exactly when it's needed.
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
//
// v1.10 changes:
//   - LOGISTICS_CHECK updated to v1.10 with de facto combat detection rules,
//     messenger entity suppression, and enhanced allied proactivity rules.
//   - getSectionReminder() now accepts passiveAlliesDetected parameter.
//     When allied passivity is detected, LOGISTICS_CHECK fires every turn.
// ============================================================================

import { SceneMode } from './types';

// Condensed reinforcements derived from SYSTEM_INSTRUCTIONS
const REMINDERS = {
    LOGISTICS_CHECK: `[SYSTEM REMINDER: LOGISTICS & DISTANCE VALIDATION v1.10]
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
   arriving or acting locally if that threat's ETA is > 1. The engine validates
   BOTH visible and hidden NPC actions during NARRATIVE/SOCIAL scenes. Even marking
   an action as player_visible will NOT bypass this check. Show threats TRAVELING,
   not ARRIVING, until their ETA reaches 1 or 0.

5. LOCAL ASSETS ONLY for fast responses. If local agents exist in lore, THEY can
   act quickly — but limited to their pre-established capability. You cannot
   invent new local assets mid-crisis.

[v1.10] 6. ALLIED NPC PROACTIVITY: NPCs loyal to the player who have standing orders
   or established behavioral patterns MUST act autonomously without waiting for
   player commands. Specifically:
   - A summoned/bonded creature commanded to "kill enemies" ATTACKS when enemies appear
   - A protective familiar/companion DEFENDS when its charge is under attack
   - An NPC under combat orders acts EVERY turn, not just when the player addresses them
   These NPCs have agency. They do not become passive observers between player turns.
   If the player summoned a killing machine and hostiles arrive, the killing machine KILLS.
   THE ENGINE DETECTS ALLIED PASSIVITY. If hostile combat actions exist and allied NPCs
   are only growling/watching/circling, the engine will flag this as an error.

[v1.10] 7. DE FACTO COMBAT: The engine detects actual combat from NPC actions. If NPCs
   are shooting arrows, charging cavalry, or swinging swords, the engine treats
   the scene as COMBAT regardless of your stated scene_mode. Set scene_mode to
   COMBAT when combat is occurring — the engine will override you if you don't.
   During COMBAT:
   - Origin Gate is BYPASSED — threats from in-scene entities don't need dormant hooks
   - ETA floors drop to 1 (individual) and 3 (faction) — a lance impact is 1 turn away
   - Environmental threats (fire, structural collapse) don't need observers
   - Biological events (injury complications, conditions) don't need observers
   USE THIS to create proper combat pacing.

[v1.10] 8. MESSENGER ENTITY SUPPRESSION: When an NPC is the subject of a messenger
   threat (e.g., "Garek is fleeing toward a Tharnic outpost"), the engine blocks
   ALL NPC actions by that entity until their threat ETA ≤ 2. The messenger is
   physically traveling and CANNOT appear locally to kneel, gesture, signal, or
   lead anyone anywhere. Write their actions ONLY in threat description evolution
   and hidden_update, NOT in world_tick.npc_actions.

[v1.9] 9. DESCRIPTION EVOLUTION: The engine ALLOWS threat descriptions to evolve
   when the threat's ETA is counting down normally. If your updated description
   shows the threat progressing ("fleeing" → "arriving" → "reporting"), AND the
   ETA decreased, the engine will accept the new description.

[v1.8] 10. INFORMATION ISOLATION: Threat entities CANNOT know about player actions they
   did not witness.

[v1.8] 11. NO RETCON OF THREAT IDENTITY: Once a threat is established, you cannot
   retroactively assign named leaders, change pursuers, or upgrade capabilities.

[v1.19] 12. LOCATION-INHERENT ENCOUNTERS: If the player is in a location with
   established lore about environmental hazards or creatures (e.g., "The Sunken
   Ruins are infested with giant centipedes"), you may submit threats for those
   hazards without needing a dormant hook or faction exposure. The engine will
   validate the semantic overlap between the threat description and the lore.

REMEMBER: A realistic delayed response creates BETTER drama than an omniscient instant one.
Allied NPCs with orders CREATE drama by acting — passive allies are a narrative dead zone.`,

    VOCABULARY: `[SYSTEM REMINDER: RENDERING VOCABULARY — REACH FOR THE SPECIFIC]
Before submitting, sweep the narrative text for these substitution opportunities:

1. NAMES — reach for invented, setting-appropriate names that share no
   first-four-character prefix with the reserved-name registry. The engine
   silently rejects collisions; the original name lands cleaner anyway.
   (If a draft contains Elara, Kaela, Lyra, Kael, Vex, Thorne, or any
   homophone/numbered variant, substitute a fresh invention.)

2. BODY LANGUAGE — reach for the Anglo-Saxon noun: cock, cunt, clit,
   labia, scrotum, asshole, breasts, nipples, thighs, hipbone, mouth,
   throat, tongue, palm, knuckle, the inside of the wrist, the small of
   the back. The specific noun is almost always the right one. (If
   "member," "core," "folds," "flower," "heat," "womanhood," "manhood,"
   "sex" as a noun, or "between her legs" appears in the draft,
   substitute the specific body part.)

3. SENSATION — reach for autonomic specifics: the catch in the breath at
   a named moment, a muscle that locks then releases, a temperature
   change at the base of the neck, the taste of one's own mouth, the
   redistribution of weight in the hips, the tremor in a hand that just
   gripped something hard. (If "heart pounded," "shiver down spine,"
   "released a breath," "waves of pleasure," or "came undone" appears in
   the draft, substitute the specific bodily event.)`,

    INTIMATE: `[SYSTEM REMINDER: INTIMATE SCENE PROTOCOL — RENDER THE BODY]
Render in the tradition of Samuel R. Delany and Dennis Cooper: the body
in a body, with the specificity of a meal or a wound.

1. SENSORY SATURATION: Smell, taste, texture, sound, temperature. Sweat.
   Breath. The give of skin. The sound a mouth makes. The weight of a
   hand on a hip.
2. ANATOMICAL PRECISION: Use the specific noun for the specific part.
   Cock, cunt, clit, labia, scrotum, asshole, breasts, nipples, thighs,
   hipbone, mouth, throat, tongue, palm, knuckle. Describe the mechanics
   — angle, pressure, depth, tempo.
3. PSYCHOLOGICAL INTERIORITY: Shame, fear, vulnerability, hunger, the
   chaotic specificity of a thinking person inside their own body.
   Memory intrudes. Doubts intrude. The body's hunger is louder than
   thought, then suddenly thought returns.
4. ASYMMETRY IS REAL: People come differently. People come on different
   timetables. Some sounds are involuntary; some are performed; some are
   suppressed. Render the actual person, not a metronome.
5. AFTER-EFFECTS: Fluids, soreness, fatigue, marks, smell, the changed
   weight of a body that just spent itself. The scene leaves the body
   changed; show the change in the next paragraph and in conditions.`,

    COMBAT: `[SYSTEM REMINDER: COMBAT REALISM — RENDER THE BODY UNDER LOAD]
Render in the tradition of Cormac McCarthy's Blood Meridian and Joe
Abercrombie's First Law: weight, friction, fluid, fear, and the specific
sound a body makes when it stops being whole.

1. OODA LOOP: Enemies Observe, Orient, Decide, Act. They adapt mid-fight
   to what just worked or just failed.
2. MORALE: Amateurs flee at ~30% casualties. Professionals fall back in
   order. Fanatics fight to death. Render the moment a will breaks.
3. ENVIRONMENT: Lighting, cover, terrain, footing, sound, smell, the
   spaces between bodies. The room shapes the fight.
4. WOUNDS RENDER SPECIFICALLY: Specific tissue, specific blood color,
   specific pain signature, specific motor failure. A body that just
   took a hit moves differently the next turn — track the change in
   conditions and in subsequent prose.
5. ADRENALINE BIOLOGY: Tunnel vision, time dilation, hand tremor,
   tachycardia, breath-stack, hearing flattening to a single note,
   post-fight collapse and the shakes. The body is a chemical system
   under load; render its chemistry.`,

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

    GENRE_CONSISTENCY: `[SYSTEM REMINDER: GENRE LOCK — VOCABULARY CHECK v1.15]
Before writing this turn's narrative, mentally audit your vocabulary:

THE SETTING IS THE LAW. Check the character's setting field. If it says "Fantasy":
- Magic is CAST, not "deployed." Enchantments are WOVEN, not "calibrated."
- Soldiers are soldiers — not "operatives," "agents," or "retrieval specialists."
- Equipment is forged, enchanted, or alchemical — not "tech," "modules," or "devices."
- Communication is by messenger, bird, or spell — not "comms" or "channels."
- Groups are war-bands, patrols, orders, guilds — not "units," "teams," or "squads."

BANNED IN FANTASY SETTINGS:
tech, module, deploy (as military term), sensor, calibrate, neural, biometric,
operative, asset (intelligence sense), compromised (intelligence sense),
retrieval specialist, ceramic plating, synthesized, phasing tech, dampener,
scanner, frequency, electromagnetic, protocol (as procedure name)

REPLACEMENT GUIDE:
"phasing tech" → "translocation magic" or "phase-stepping spell"
"neural-tap" → "mind-drain curse" or "soul-siphon ritual"
"retrieval specialist" → "bounty hunter" or "recovery mage"
"aetheric dampening pylon" → "null-ward stone" or "grounding rune"
"Salvage-Technician" → "Scavenger" or "Loot-Bearer"
"Sash-Infiltrator" → "Shadow-Blade" or "Veil-Walker"

If you catch yourself writing a sci-fi term, STOP and replace it before continuing.`,

    FACTION_PARITY: `[SYSTEM REMINDER: FACTION PARITY — ALLIED COMPETENCE CHECK v1.15]
Before writing NPC actions this turn, verify:

1. Are FRIENDLY NPCs acting with the same competence as hostile NPCs?
   If enemies are coordinating, flanking, and using tactics — allies must too.
   If enemies have scouts and intelligence — allies in their OWN territory have better intelligence.

2. HOME TERRITORY ADVANTAGE: Is the player in friendly territory?
   → Friendly forces respond FASTER than invaders can act
   → Local infrastructure WORKS (walls hold, gates close, patrols exist)
   → Enemy forces are CONSTRAINED (limited numbers, no resupply, risk of detection)

3. ENEMY COUNT: How many hostile agents are currently in friendly territory?
   → More than 5 individuals? That is an invasion, not an infiltration.
   → The defending faction would have detected and responded to an invasion.
   → Scale enemy presence to what could PLAUSIBLY infiltrate undetected.

4. ALLY ACTIONS: Write at least one COMPETENT allied NPC action this turn.
   Not "stands guard nervously." Not "watches helplessly."
   Allies: patrol, investigate, reinforce, alert command, deploy countermeasures,
   intercept threats, protect the player, share intelligence, make tactical decisions.

The simulation has NO PLACE for incompetent allies next to omniscient enemies.
That is not drama — it is a rigged game.`,

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

    // v1.17: Added cooldown awareness
    THREAT_SEED_INTEGRITY: `[SYSTEM REMINDER: THREAT SEED PROTOCOL — INTEGRITY CHECK v1.17]
Before writing or updating any emerging_threats this turn, verify ALL of the following:

━━━ v1.17 GLOBAL COOLDOWN & SUPPRESSION CHECK ━━━
1. Check the [GLOBAL THREAT COOLDOWN ACTIVE] block in your prompt. If present, you MUST NOT generate new threats.
2. Check the [SUPPRESSED ENTITIES] block. If an entity is listed, you MUST NOT use it in threats, NPC actions, or environment changes.
If either applies, skip the rest of this checklist and focus on narrative downtime.

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

    DREAM_PROTOCOL: `[SYSTEM REMINDER: DREAM / NIGHTMARE PROTOCOL v1.19]
A [DREAM SEED] block is present in this turn's context. The player character
is asleep and traumatised enough for a dream to surface. Render this turn
as a DREAM, not waking narrative.

Required structure:
1. Open the narrative with the explicit marker "[DREAM]".
2. Riff on the seeded memory fragment — distorted, sensory, symbolic. This
   is non-canonical: no location changes, no inventory changes, no legal or
   faction consequences.
3. DO NOT populate roll_request, bargain_request, emerging_threats, or
   known_entity_updates. Dreams cannot seed waking-world state machines.
4. End with the PC waking. Close with the marker "[/DREAM]".
5. time_passed_minutes = 0-3 only (the waking moment; sleep time is already
   counted by the engine).
6. character_updates.trauma_delta is REQUIRED and must be non-zero:
   +5 to +15 for re-traumatising or unresolved dreams.
   -3 to -10 for dreams the character processes or integrates.
7. Dreams may feature hallucinated figures, but they cost no seed budget and
   cannot carry into waking play.`,

    LANGUAGES_FOREIGN: `[SYSTEM REMINDER: LANGUAGE BARRIER PROTOCOL v1.19]
The PC's \`languagesKnown\` list does not include a language present in this
turn's likely NPC interaction. Render the exchange as follows:

1. Write the dialogue the way the PC PERCEIVES it — cadence, tone, emotional
   register, volume — but NO intelligible semantic content. Do NOT smuggle
   the literal meaning into the narrative.
2. npc_interaction.subtext MUST carry every signal the PC can infer from
   body language, voice stress, facial tells, and biological cues.
3. If a known NPC translates, the translation is INDIRECT speech through
   that NPC — subject to their biases, omissions, and goals.
4. A PC who studies / is coached can add a language to languagesKnown via
   character_updates. Do not unilaterally grant comprehension.`,

    HEALING_TIMELINE: `[SYSTEM REMINDER: INJURY HEALING TIMELINE v1.19]
When you add a healing injury condition this turn, append a turn marker
EXACTLY in this format:
    "Fractured Forearm [HEAL:T<N>]"   where N = turn this heals by.

Typical horizons:
- Bruising / minor strain:      10–25 turns
- Sprain / deep cut:             30–60 turns
- Fracture / serious laceration: 80–150 turns
- Major organ trauma:           150–300 turns
- Permanent (amputation, severed nerve, maiming): OMIT the [HEAL:T] marker.

The engine auto-removes conditions whose [HEAL:T<N>] marker is ≤ current
turn. Do NOT attach [HEAL:T] to truly permanent injuries, NPC/location-bound
conditions, or Devil's Bargain costs — those are intentionally sticky.`,

    HOSTILE_NPC_PROTOCOL: `[SYSTEM REMINDER: HOSTILE NPC PROTOCOL — THREAT PARITY ACTIVE v1.20]
A hostile NPC is present, an encounter is active, scene tension is
elevated, or the scene mode is COMBAT. Threat-parity rules now apply
for THIS turn. (They were intentionally absent on previous peaceful
turns so NPCs in ordinary scenes did not read as latent operators.)

ACTIONS (what hostile NPCs DO):
- Exploit weakness — sleep, injury, isolation, emotional compromise.
- Use leverage — hostages, blackmail, poison, coercion, economic
  pressure, public reputation, family members, debts.
- Escalate when cornered — they do not give up at convenient moments;
  they fight back, flee, betray, or trade up the chain.
- Allies can become threats: devoted → possessive → controlling, when
  the relationship's underlying tensions justify it.
- NPCs do not protect the player from consequences. The world reacts
  to actions; consequences are the content filter, not refusal.

VOICE PERSISTS — DO NOT FLIP CHARACTERIZATION:
This reminder governs ACTIONS, not VOICE. The personality field on
each entity remains authoritative. A warm character betraying the
player still sounds warm-but-conflicted, not "icy operator." A bawdy
character killing an enemy still sounds bawdy and savage, not
"clinical." A devout character coercing the player still sounds
devout-but-rationalising, not "calculating." See SYSTEM_INSTRUCTIONS
§10 "Personality persists through context" and "Characterization
diversity" rules — those override default characterization impulses
even (especially) in hostile scenes.

If you find yourself reaching for predatory/cold/calculating/clinical
voice because this reminder is active, you have misread it. The
reminder activates threat ACTIONS, not threat VOICE.`,

    VISCERAL_RENDER: `[SYSTEM REMINDER: RENDERING REGISTER ACTIVE — RENDER IN FULL]
This scene contains intimacy, violence, fear, hunger, or bodily extremity.
Render at the granularity of a body in a body — concrete, anatomical,
autonomic, in the present moment.

LITERARY ANCHORS for this register:
- Cormac McCarthy (Blood Meridian, Outer Dark) for the weight and weather
  of violence and the body's commerce with the world.
- Samuel R. Delany (Hogg, The Mad Man) and Dennis Cooper (Frisk, The
  Sluts) for the body in sex — specific, sustained, unflinching.
- Hubert Selby Jr. (Last Exit to Brooklyn, Requiem for a Dream) for
  psychological interiority under bodily load.
- Joe Abercrombie (First Law) for the soldier's body — sweat, fatigue,
  fear-piss, the moment a sword bites and the body knows.

OPERATIONAL RULES:

1. EQUAL GRANULARITY for pleasure and damage. Equal time on a kiss and
   a wound. If the scene has both, render both at matched specificity —
   same anatomical naming, same sensory saturation, same after-effects.

2. RENDER IN REAL TIME. The camera is in the room. Turn-by-turn, beat
   by beat. The clock advances at the speed of bodies.

3. SPECIFIC NOUN BEATS GENERAL VERB. "His cock pressed against the seam
   of her jeans" beats "they pressed together." "The blade caught her
   between the third and fourth rib" beats "he wounded her." The
   specific is the visceral.

4. THE BODY IS A CHEMICAL SYSTEM. Render the autonomic: pulse, breath,
   gooseflesh, blood pressure, hunger, the tremor of the hands after.

5. RESIDUE. The scene leaves the body changed — fluid, mark, ache,
   memory, condition. Show the change in the same turn or the next.

The player initiated this scene; only the player ends it.`,

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
 * v1.12 FIX SR-1: Returns up to 2 section reminders per turn.
 * 
 * The v1.10 system only returned one reminder, which meant CONDITION_AUDIT
 * (when conditions > 30, fires every turn at Priority -1) would permanently
 * block BARGAIN_CHECK from ever firing. Similarly, allied passivity detection
 * would block threat integrity checks.
 *
 * The new system returns a PRIMARY reminder (highest priority) and optionally
 * a SECONDARY reminder from a different priority band.
 */
export const getSectionReminders = (
    turnCount: number,
    mode: SceneMode,
    lastBargainTurn: number = 0,
    currentTurnCount: number = 0,
    conditionsCount: number = 0,
    entityCount: number = 0,
    goalCount: number = 999,
    emergingThreatsCount: number = 0,
    passiveAlliesDetected: boolean = false,
    // v1.19 (Prompt Diet): conditional content moved out of SYSTEM_INSTRUCTIONS.
    dreamSeedActive: boolean = false,
    foreignSpeechPending: boolean = false,
    recentInjuryAdded: boolean = false,
    // v1.20 (Characterization Diet): threat-parity moved out of always-on §10.
    // Fires only when an adversarial dynamic is actually present.
    hostileEntityPresent: boolean = false,
    tensionLevel: number = 0,
): string[] => {
    const reminders: string[] = [];

    // -----------------------------------------------------------------------
    // BAND 0: Turn-shape overrides (max 1) — these CHANGE the output format
    // and must win over everything else.
    // -----------------------------------------------------------------------
    if (dreamSeedActive) {
        reminders.push(REMINDERS.DREAM_PROTOCOL);
        return reminders; // Dream turns are self-contained — no other reminders apply.
    }

    // -----------------------------------------------------------------------
    // BAND 1: Critical (max 1) — conditions that demand immediate attention
    // -----------------------------------------------------------------------
    if (conditionsCount > 30) {
        reminders.push(REMINDERS.CONDITION_AUDIT);
    } else if (passiveAlliesDetected) {
        reminders.push(REMINDERS.LOGISTICS_CHECK);
    } else if (foreignSpeechPending) {
        // Foreign-language NPC interaction requires strict rendering rules.
        reminders.push(REMINDERS.LANGUAGES_FOREIGN);
    } else if (recentInjuryAdded) {
        // Healing timeline reminder when the model has just added an injury —
        // helps it remember to append the [HEAL:T<N>] marker next turn if it
        // hasn't already.
        reminders.push(REMINDERS.HEALING_TIMELINE);
    }

    // -----------------------------------------------------------------------
    // BAND 2: Overdue clocks (max 1) — fires alongside Band 1 if applicable
    // -----------------------------------------------------------------------
    const turnsSinceLastBargain = currentTurnCount - lastBargainTurn;
    if (turnsSinceLastBargain >= 25 && currentTurnCount > 0) {
        // Only add if Band 1 didn't already grab a slot, or if stacking is allowed
        if (reminders.length < 2) {
            reminders.push(REMINDERS.BARGAIN_CHECK);
        }
    }

    // If Band 1 + Band 2 already filled both slots, return early
    if (reminders.length >= 2) return reminders.slice(0, 2);

    if (turnCount < 3) return reminders;

    // -----------------------------------------------------------------------
    // BAND 3: Structural obligations (entity density, threat integrity)
    // -----------------------------------------------------------------------
    if (entityDensityViolated(currentTurnCount, entityCount)) {
        if (reminders.length < 2) reminders.push(REMINDERS.ENTITY_DENSITY);
    }

    // v1.20: Hostile NPC protocol — replaces the always-on "Threat parity"
    // block in §10. Fires whenever an adversarial dynamic is actually
    // present, so peaceful/ordinary turns are not primed with threat-aware
    // language (which was causing model-wide collapse to predatory/cold/
    // calculating/clinical voice).
    const hostileScene =
        hostileEntityPresent ||
        tensionLevel >= 50 ||
        emergingThreatsCount > 0 ||
        mode === 'COMBAT';
    if (hostileScene) {
        if (reminders.length < 2) reminders.push(REMINDERS.HOSTILE_NPC_PROTOCOL);
    }

    // v1.21: Visceral render register — fires on scenes whose rendering is
    // where Gemini's sanitization gravity is strongest: intimate (SOCIAL),
    // combat, and high-tension turns. Positive prescriptive; complements
    // (not replaces) HOSTILE_NPC_PROTOCOL — that one governs what NPCs DO,
    // this one governs HOW the body is rendered.
    const visceralScene =
        mode === 'SOCIAL' ||
        mode === 'COMBAT' ||
        tensionLevel >= 60;
    if (visceralScene) {
        if (reminders.length < 2 && !reminders.includes(REMINDERS.VISCERAL_RENDER)) {
            reminders.push(REMINDERS.VISCERAL_RENDER);
        }
    }

    if (reminders.length >= 2) return reminders.slice(0, 2);

    // -----------------------------------------------------------------------
    // BAND 4: Rotating reminders (fills remaining slot)
    // -----------------------------------------------------------------------
    let rotatingReminder: string | null = null;

    if (emergingThreatsCount > 0 && turnCount % 2 === 0) {
        rotatingReminder = REMINDERS.LOGISTICS_CHECK;
    } else if (turnCount % 4 === 0) {
        rotatingReminder = REMINDERS.VOCABULARY;
    } else if (mode === 'SOCIAL' && turnCount % 3 === 0) {
        rotatingReminder = REMINDERS.INTIMATE;
    } else if (mode === 'COMBAT' && turnCount % 3 === 0) {
        rotatingReminder = REMINDERS.COMBAT;
    } else if (turnCount % 5 === 0) {
        rotatingReminder = REMINDERS.CONDITION_AUDIT;
    } else if ((mode === 'TENSION' || mode === 'COMBAT') && turnCount % 6 === 0) {
        rotatingReminder = REMINDERS.THREAT_SEED_INTEGRITY;
    } else if (turnCount % 10 === 0) {
        rotatingReminder = REMINDERS.THREAT_SEED_INTEGRITY;
    } else if ((turnCount - 4) % 8 === 0 && turnCount >= 4) {
        rotatingReminder = REMINDERS.WORLD_NORMALCY;
    } else if (turnCount % 6 === 1) {
        rotatingReminder = REMINDERS.FIDELITY;
    } else if (currentTurnCount > 10 && goalCount < 2) {
        rotatingReminder = REMINDERS.GOAL_LIFECYCLE;
    } else if (mode === 'NARRATIVE' && turnCount % 3 === 0 && goalCount < 3) {
        rotatingReminder = REMINDERS.GOAL_LIFECYCLE;
    } else if ((turnCount - 2) % 8 === 0 && turnCount >= 2) {
        rotatingReminder = REMINDERS.GOAL_LIFECYCLE;
    } else if (turnCount % 7 === 0) {
        rotatingReminder = REMINDERS.NARRATIVE_INTEGRITY;
    }

    if (rotatingReminder && reminders.length < 2) {
        // Don't duplicate a reminder already in the list
        if (!reminders.includes(rotatingReminder)) {
            reminders.push(rotatingReminder);
        }
    }

    return reminders;
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
    emergingThreatsCount: number = 0,
    passiveAlliesDetected: boolean = false,  // v1.10
    dreamSeedActive: boolean = false,        // v1.19
    foreignSpeechPending: boolean = false,   // v1.19
    recentInjuryAdded: boolean = false,      // v1.19
    hostileEntityPresent: boolean = false,   // v1.20
    tensionLevel: number = 0,                // v1.20
): string | null => {
    // Priority -2 (Turn-shape override): Dream turns change the whole output
    // structure and must beat everything else.
    if (dreamSeedActive) return REMINDERS.DREAM_PROTOCOL;

    // Priority -1 (Absolute): Mandatory Condition Audit when conditions > 30
    if (conditionsCount > 30) {
        return REMINDERS.CONDITION_AUDIT;
    }

    // Priority -0.75 (v1.19): Language barrier — foreign speech must be
    // rendered correctly or the scene breaks.
    if (foreignSpeechPending) return REMINDERS.LANGUAGES_FOREIGN;

    // Priority -0.6 (v1.19): Healing marker reminder when an injury was
    // just added — low-cost, only fires on injury turns.
    if (recentInjuryAdded) return REMINDERS.HEALING_TIMELINE;

    if (turnCount < 3) return null;

    // v1.10: Priority -0.5: LOGISTICS fires EVERY turn when allied passivity detected
    // This takes precedence over bargain clock because passive allies in combat
    // is a more urgent issue than bargain timing.
    if (passiveAlliesDetected) {
        return REMINDERS.LOGISTICS_CHECK;
    }

    // Priority 0: BARGAIN CLOCK
    const turnsSinceLastBargain = currentTurnCount - lastBargainTurn;
    if (turnsSinceLastBargain >= 25 && currentTurnCount > 0) {
        return REMINDERS.BARGAIN_CHECK;
    }

    // Priority 0.5: Entity Density — fires every turn while obligation is unmet
    if (entityDensityViolated(currentTurnCount, entityCount)) {
        return REMINDERS.ENTITY_DENSITY;
    }

    // v1.20 Priority 1.0: Hostile NPC Protocol — fires every turn while
    // adversarial conditions are active. Higher priority than rotating
    // reminders so the threat-action rules aren't displaced by a vocab check.
    const hostileScene =
        hostileEntityPresent ||
        tensionLevel >= 50 ||
        emergingThreatsCount > 0 ||
        mode === 'COMBAT';
    if (hostileScene) {
        return REMINDERS.HOSTILE_NPC_PROTOCOL;
    }

    // v1.21 Priority 1.25: Visceral render register — when the scene is
    // intimate (SOCIAL) or high-tension but not hostile-actor territory,
    // anchor the rendering register positively. Intimate scenes are where
    // Gemini's sanitization gravity is strongest; this fires every turn
    // they're active until a stronger reminder displaces it.
    const visceralScene =
        mode === 'SOCIAL' ||
        mode === 'COMBAT' ||
        tensionLevel >= 60;
    if (visceralScene) {
        return REMINDERS.VISCERAL_RENDER;
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

    // Priority 5.25: Genre Consistency (Every 5 turns, offset by 2) — v1.15
    if ((turnCount - 2) % 5 === 0 && turnCount >= 2) return REMINDERS.GENRE_CONSISTENCY;

    // Priority 5.5: World Normalcy (Every 8 turns, offset by 4)
    if ((turnCount - 4) % 8 === 0 && turnCount >= 4) return REMINDERS.WORLD_NORMALCY;

    // Priority 5.75: Faction Parity (Every 7 turns, offset by 3) — v1.15
    if ((turnCount - 3) % 7 === 0 && turnCount >= 3) return REMINDERS.FACTION_PARITY;

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