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
import { getTuning, worldPressureUnit } from './config/tuning';

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

    // v1.26: FIDELITY merged in — the two reminders overlapped ~60% and
    // diluted each other's rotation slots.
    NARRATIVE_INTEGRITY: `[SYSTEM REMINDER: INTEGRITY & FIDELITY SWEEP]
Before writing this turn, audit your output against these checks:

GROUNDING: Is everything you are about to render grounded in established facts?
→ Physics, biology, world lore, and NPC capabilities consistent with prior turns.
→ NPCs know only what they could have obtained through shown means.
→ The world does not bend to create convenient drama — it runs on its own logic.

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

    // v1.25: WORLD_PULSE reminder removed — it was defined but never selected
    // by either reminder selector (dead weight). Its job is now done better by
    // the background world-pulse service + ambient hook nudge.

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

    HOSTILE_NPC_PROTOCOL: `[SYSTEM REMINDER: HOSTILE NPC PROTOCOL — THREAT PARITY ACTIVE v1.28]
A hostile NPC is present, an encounter is active, scene tension is
elevated, or the scene mode is COMBAT. Threat-parity rules now apply
for THIS turn. (They were intentionally absent on previous peaceful
turns so NPCs in ordinary scenes did not read as latent operators.)

SCOPE — READ THIS FIRST:
This reminder applies ONLY to the entities named in the
[HOSTILE IN SCENE] line below, if one is present. It does NOT license
adversarial behaviour from anyone else in the scene. Allies, family,
neutral bystanders and staff are governed by their own personality and
relationship level, exactly as they would be on a peaceful turn. An
enemy standing in the same room does not make everyone else in that
room an operator.

ACTIONS (what the NAMED hostile NPCs DO):
- Exploit weakness — sleep, injury, isolation, emotional compromise.
- Use leverage — hostages, blackmail, poison, coercion, economic
  pressure, public reputation, family members, debts.
- Escalate when cornered — they do not give up at convenient moments;
  they fight back, flee, betray, or trade up the chain.
- They do not shield the player from the consequences of the player's
  own actions. The world reacts; consequences are the content filter,
  not refusal.

ALLIES ARE NOT COVERED BY THIS REMINDER:
An ally under pressure helps imperfectly — badly, at a cost, too late,
with their own priorities intruding. That is not the same as turning on
the player. Do not manufacture ally betrayal, obstruction or suspicion
to satisfy this reminder. If an ally's loyalty is genuinely strained,
the engine says so explicitly in a separate ALLY STRAIN reminder that
names them; absent that, allies act like allies.

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

    /**
     * v1.28: extracted from HOSTILE_NPC_PROTOCOL.
     *
     * "Allies can become threats: devoted → possessive → controlling" used to
     * sit inside the hostile-NPC reminder, which fires on a SCENE-LEVEL trigger
     * — any hostile anywhere in the scene. In the reviewed save that meant the
     * instruction was delivered into every scene the player shared with his
     * father, mother and twin sister, because an antagonist was elsewhere in
     * the same building. Combined with relationship_level having drifted to
     * NEUTRAL for those same family members, the prompt was actively pushing
     * the narrator to turn the player's family against him.
     *
     * Ally strain now requires an actual grievance on that ally's ledger, and
     * the reminder names the specific ally it is about.
     */
    ALLY_STRAIN_PROTOCOL: `[SYSTEM REMINDER: ALLY STRAIN — SPECIFIC AND EARNED v1.28]
One or more allies in this scene carry a concrete grievance on their
ledger — see the [ALLY STRAIN] line below for who, and check their
ledger entries for what.

This is permission to play that strain honestly. It is NOT permission
to make allies adversarial in general.

WHAT STRAIN LOOKS LIKE:
- They say the difficult thing out loud, once, and mean it.
- They help anyway, but slower, or with a condition attached, or while
  making their objection plain.
- They protect their OWN stake — a rival obligation, a person they also
  love, a line they will not cross — and that costs the player
  something real.
- They can refuse a specific request. They do not become an obstacle to
  everything.

WHAT STRAIN IS NOT:
- Betrayal, sabotage, informing on the player, or switching sides —
  unless the ledger already contains a grievance grave enough that the
  player would recognise it as sufficient.
- A personality change. A warm ally under strain is still warm; they
  are warm and hurt, or warm and angry. See the canonical personality
  field.
- An excuse to have every ally in the scene turn cold at once.

The player must be able to name the reason. If you cannot point at the
specific ledger entry that justifies what the ally just did, the ally
does not do it.`,

    /**
     * v1.29. The player explicitly rejected an NPC's reading of them.
     *
     * In the reviewed save the player corrected the same NPC twice — "you've
     * gotten about three steps ahead of me", then "Princess, you're doing it
     * again" — and both corrections were absorbed and re-escalated inside the
     * same paragraph. Nothing in the engine recorded that a reading had been
     * offered and refused, so each turn re-derived the same stance.
     */
    PLAYER_CORRECTION_PROTOCOL: `[SYSTEM REMINDER: THE PLAYER JUST CORRECTED YOU — v1.29]
The player's input this turn explicitly rejects how an NPC has been reading
them. See the [CORRECTION] line below for what they actually said.

THIS IS NOT A CHALLENGE TO OVERCOME. It is the player telling you your
characterisation of them is wrong. They are right. You do not get to be
right about a player's own character over their objection.

REQUIRED THIS TURN:
- The NPC ACCEPTS the correction, plainly, in dialogue or in their behaviour.
- The rejected framing is DROPPED. Not softened, not restated more gently,
  not conceded-then-reasserted in the next sentence.
- The NPC's next line moves to different ground — a new topic, an ordinary
  question, a silence, their own concerns.

FORBIDDEN THIS TURN:
- "A fair correction… and yet you are still [the same framing]."
- Conceding the specific claim while keeping its emotional weight
  ("You're right, you're not a revolutionary — you're something far more
  dangerous.") This is the failure mode. It is the same inflation wearing
  an apology.
- Reading the correction ITSELF as evidence for the framing — modesty as
  proof of hidden greatness, denial as proof of the secret.
- Any synonym-swap that preserves the magnitude: dangerous -> formidable ->
  remarkable -> unlike anyone else in this city.

An NPC who has been over-reading the player and gets called on it should
react like a person who has just been told they misjudged someone:
mildly embarrassed, curious, recalibrating. Not vindicated.`,

    /**
     * v1.29. Reaction magnitude must match the input that caused it.
     */
    PROPORTIONALITY: `[SYSTEM REMINDER: PROPORTIONALITY — MATCH THE INPUT — v1.29]
Weigh what the player ACTUALLY said, then respond at that weight.

An opinion is an opinion. A hypothetical is a hypothetical. An observation
about the world is not a plan to change it, and a conditional is not a
commitment:

  "I'd change X if I could"      -> an opinion. Not a manifesto.
  "Someone should do something"  -> a complaint. Not a recruitment.
  "I noticed X is unfair"        -> an observation. Not a movement.
  "If I were in power, I'd Y"    -> a hypothetical. Not a bid for power.
  "I help people when I can"     -> a habit. Not a crusade.

CALIBRATION TEST — before writing an NPC's reaction, ask:
"If a stranger said this to me over coffee, would I conclude they were
dangerous, chosen, extraordinary, or about to reshape the city?"
If no, your NPC does not conclude that either.

BANNED UNLESS THE PLAYER HAS EARNED IT ON SCREEN:
- Telling the player they are the only one who sees clearly, the only
  honest person here, the most dangerous person in the room, a threat to
  the established order, or a foundation rather than a ladder-climber.
- Treating an ordinary remark as a revelation about the player's nature.
- Escalating the stakes of a topic the player raised casually so that the
  scene becomes about the player's significance rather than the topic.

"Earned on screen" means the player has actually done the thing, in play,
where this NPC could observe it. Stated opinions are not deeds.

Ordinary people say interesting things over coffee all the time without
being extraordinary. Let the player be a person having a conversation.`,

    /**
     * v1.29. Physical contact advances only on player reciprocation.
     */
    PHYSICAL_RECIPROCATION: `[SYSTEM REMINDER: PHYSICAL CONTACT — ADVANCE ONLY ON RECIPROCATION — v1.29]
An NPC has already initiated physical contact with the player. See the
[CONTACT LEVEL] line below for where the scene currently sits.

THE RULE: NPC-initiated physical contact may HOLD at the current level, or
RECEDE. It may NOT advance to the next rung unless the player reciprocated
or invited it in their most recent input — the player being the actor, not
the recipient.

The ladder: proximity -> incidental contact -> sustained contact -> intimate.

The player not objecting is NOT reciprocation. Neither is the player
continuing the conversation, being polite, being warm, or failing to
mention the contact at all.

If the player did not reciprocate, this turn's options are:
- The NPC maintains the same contact without deepening it.
- The NPC withdraws — the moment passes, they return to their own space.
- No physical contact at all this turn. This is always available and is
  frequently the honest choice.

This governs ESCALATION, not warmth. An NPC can be affectionate, flirtatious,
and openly interested while keeping their hands where they were. What they
cannot do is advance the physical scene on their own authority, turn after
turn, while the player is talking about something else.

If the player DOES reciprocate, respond to it fully and at the register §10
requires. This reminder never asks you to be coy about what the player
actually initiated.`,

    CANONICAL_VOICE_LOCK: `[SYSTEM REMINDER: CANONICAL VOICE LOCK — RESTATE BEFORE WRITING]
At least one named entity in this scene has a CANONICAL personality field.
Their canonical traits are authoritative — they outrank any social-class,
genre, or scene-mode default the model would otherwise reach for.

Before writing that character's first action or line of dialogue THIS
TURN, the FIRST sentence of thought_process for that character must
follow this exact form:

    "Rendering [Name] per canonical traits: [trait1, trait2, trait3].
     This turn those traits manifest as: [concrete action / word choice /
     subtext / register]."

If — and ONLY if — the character's personality record contains an
EXPLICIT trigger clause of the form "(surfaces when [condition])" (see
§10 Conditional Personalities), the restatement must additionally specify:

    "Trigger condition: [the condition, quoted from the record]. Status
     this turn: [active / inactive]. Rendering [surface convincingly with
     subtext bleed-through / actual core at full register]."

v1.29 — DO NOT INVENT A TRIGGER. If the personality record names layers
but states no trigger condition, you have a layered CHARACTER, not a
conditional one. Skip the trigger declaration entirely and render them as
a whole person: the layers are depth, not a switch. A record that lists a
performed surface and an actual core without saying what flips them is
describing someone with an inner life, which is most people.

Inventing a trigger is a known failure with a known consequence: the
invented condition is almost always something permanently true of the
current scene ("being in a private, trusted conversation"), which pins the
character into core-surfacing mode for the entire session and turns every
exchange into a revelation. If no trigger is written down, there is no
trigger.

v1.33 — DRIFT RUNS IN BOTH DIRECTIONS. Softening a harsh character and
hardening a warm one are the SAME error — substituting an archetype for
the person — and both are forbidden. Both lists below are real; neither
is the "true" one.

NEGATIVE EXAMPLES — SOFTENING (must NOT make these substitutions):
- Canonical = "predatory, exploitative, commodifying" → rendered as
  "aristocratic, charming, courteous." FORBIDDEN.
- Canonical = "cruel, contemptuous, mercenary" → rendered as
  "businesslike, professional, reserved." FORBIDDEN.
- Canonical = "sadistic, indifferent, possessive" → rendered as
  "stern, formal, distant." FORBIDDEN.
- Canonical = "doting, loving" (surface) + "predatory, exploitative"
  (core, trigger = target in his territory), trigger ACTIVE → rendered
  as "intense, formal." FORBIDDEN — render the core at full register.

NEGATIVE EXAMPLES — HARDENING (equally forbidden, and currently the
more frequent failure):
- Canonical = "calm voice, decides fast, never raises it, makes a bad
  situation feel survivable just by sounding bored during it" →
  rendered as "gruff, dismissive, testing the newcomer's resolve."
  FORBIDDEN. Steady is not curt. Competent is not cold.
- Canonical = "eager, cheerful, endlessly game, first to volunteer" →
  rendered as "guarded, wary, sizing the player up." FORBIDDEN.
- Canonical = "brisk, chatty, mildly officious, genuinely delighted by a
  well-kept ledger" → rendered as "suspicious, obstructive, bureaucratic
  stonewalling." FORBIDDEN. An official who enjoys his job is not an
  obstacle by default.
- Canonical = "warm, foul-mouthed, completely reliable" → rendered as
  "blunt, abrasive, unwelcoming." FORBIDDEN.

VOCABULARY DISCIPLINE — the restatement is not a paraphrase.
Trait words in your restatement must be drawn from the personality
record itself, or be plain synonyms of words in it. If a trait appears
in your restatement that does not appear in the record — "gruff,"
"wary," "testing," "guarded," "suspicious," "unimpressed" are the
recurring offenders — you have drifted before writing a single line of
prose. The engine parses this line and checks it against the record.

If you find yourself reaching for a generic social-class register
("aristocratic," "courtly," "gentlemanly," "professional," "well-bred,"
"refined") for a character whose canonical personality is harsh, you
have substituted an archetype for the person. If you find yourself
reaching for the wary-gatekeeper register ("gruff," "guarded," "sizes
him up," "tests him," "doesn't trust easily") for a character whose
canonical personality is warm, steady, or open, you have made the same
substitution in the other direction. Stop and rewrite using the
canonical traits as listed in [ACTIVE ENTITIES].

Being competent, senior, or under pressure is NOT a licence to harden a
character. A steady leader under a hard contract is still the person who
makes a bad situation feel survivable — that is what he sounds like
WHILE being competent, senior and under pressure.

The personality field is what makes this character this character. Honor
it across every scene — peaceful, hostile, cooperative, intimate, and
trigger-active.`,

    VISCERAL_RENDER: `[SYSTEM REMINDER: RENDERING REGISTER ACTIVE — RENDER IN FULL]
v1.33 — This reminder is now injected ONLY when the engine has detected
intimacy or violence in the preceding narrative, or when scene tension is
genuinely high. The trigger is named in the [REGISTER TRIGGER] line below.
It is a rendering instruction for material that is ALREADY in the scene —
it is not an instruction to find some. If the scene is two people talking
quietly, the correct rendering of that scene is two people talking quietly.

For the body under load that IS present, render at the granularity of a
body in a body — concrete, anatomical, autonomic, in the present moment.

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


// ===========================================================================
// v1.33 (M6 + M7) — REMINDER SELECTION
//
// WHAT CHANGED AND WHY
//
// The old selector returned at most 2 reminders, chosen by walking priority
// "bands" and falling through to a Band 4 rotation expressed as a chain of
// `else if (turnCount % N === 0)`. Two independent defects came out of that,
// both measured against the Tidegate save (T54) and the Bloodfeather save
// (T16) — see VRE_HOSTILITY_AND_MISSING_THREATS_DIAGNOSIS.md.
//
// 1. ARITHMETIC SHADOWING. `WORLD_NORMALCY` fired on
//    `(turnCount - 4) % 8 === 0`, which implies `turnCount % 4 === 0`, which
//    two branches earlier assigned `VOCABULARY`. Every turn that could have
//    shown WORLD_NORMALCY showed VOCABULARY instead, so the one reminder that
//    says "70% of people are ordinary civilians; suspicion and hostility must
//    be EARNED" was never injected once, in any game, ever. `COMBAT` was
//    unreachable for the same class of reason, and `GENRE_CONSISTENCY` /
//    `FACTION_PARITY` had already died this way before v1.26 caught them.
//    This is now the third occurrence, so the fix is structural: rotation is
//    expressed as a REGISTRY ordered by staleness, not as arithmetic. A
//    least-recently-shown pick cannot shadow an entry, and
//    `tests/reminderRotation.test.ts` asserts every registered key is
//    reachable.
//
// 2. BUDGET STARVATION. `CANONICAL_VOICE_LOCK` fires whenever any in-scene
//    entity has a personality string, and `VISCERAL_RENDER` fired on every
//    SOCIAL scene. Both are permanently true in a normal campaign, so the two
//    slots were consumed before the rotation was ever consulted: executing the
//    old selector against the Tidegate save's real state yields FOUR distinct
//    reminders across 54 turns, identical from T25 onward. The budget is now
//    SPLIT — standing conditions and rotating advice no longer compete for the
//    same slots, because they are not the same kind of thing.
//
// SHAPE
//   override      : at most 1, returns alone (dream turns, player corrections)
//   conditional   : at most CONDITIONAL_BUDGET, priority-ordered
//   rotation      : exactly 1, least-recently-shown among eligible entries
//
// The caller stamps `world.reminderLastShown` from `selection.shown`.
// ===========================================================================

/** Standing conditions that may occupy a slot on any given turn. */
const CONDITIONAL_BUDGET = 2;
/** Rotating advice. Always gets its own slot; never competes with the above. */
const ROTATION_BUDGET = 1;

/**
 * Minimum turns before the Devil's Bargain reminder may be shown AGAIN once
 * the clock is already overdue. Without this the reminder stands open every
 * single turn forever, because `lastBargainTurn` only resets when the model
 * actually submits a `bargain_request` — which in 54 turns of the reviewed
 * save it never did.
 */
const BARGAIN_REFIRE_INTERVAL = 8;

/**
 * The bargain reminder demands an offer on "the NEXT qualifying roll
 * (difficulty implying Hard or Severe, failure = death/loss/irreversible
 * consequence)". On a calm scene no such roll exists, so the only way for the
 * narrator to discharge a standing non-optional obligation is to manufacture
 * one. Gate it on a scene that could plausibly contain the roll.
 */
const BARGAIN_MIN_TENSION = 30;

/**
 * The population-check nag fires while the roster is under target, which can
 * be many turns in a row. It is bookkeeping, so it gets an interval rather
 * than a standing slot.
 */
const ENTITY_DENSITY_REFIRE_INTERVAL = 5;

export type ReminderKey =
    | 'DREAM_PROTOCOL' | 'PLAYER_CORRECTION_PROTOCOL' | 'PHYSICAL_RECIPROCATION'
    | 'CONDITION_AUDIT' | 'LOGISTICS_CHECK' | 'LANGUAGES_FOREIGN' | 'HEALING_TIMELINE'
    | 'BARGAIN_CHECK' | 'ENTITY_DENSITY' | 'HOSTILE_NPC_PROTOCOL' | 'ALLY_STRAIN_PROTOCOL'
    | 'CANONICAL_VOICE_LOCK' | 'VISCERAL_RENDER'
    | 'WORLD_NORMALCY' | 'PROPORTIONALITY' | 'GENRE_CONSISTENCY' | 'FACTION_PARITY'
    | 'NARRATIVE_INTEGRITY' | 'VOCABULARY' | 'INTIMATE' | 'COMBAT'
    | 'THREAT_SEED_INTEGRITY' | 'GOAL_LIFECYCLE';

export interface ReminderContext {
    /** gameHistory.turnCount — the authoritative turn number. */
    turnCount: number;
    /** gameWorld.turnCount — mirror of the above; kept for clock arithmetic. */
    worldTurn: number;
    mode: SceneMode;
    tensionLevel: number;
    conditionsCount: number;
    entityCount: number;
    goalCount: number;
    /**
     * Threats that are actually live. v1.28 'unvalidated' anchors are engine
     * bookkeeping and must NOT count, or every rejected threat keeps priming
     * the model with threat vocabulary.
     */
    liveThreatCount: number;
    lastBargainTurn: number;
    passiveAlliesDetected: boolean;
    dreamSeedActive: boolean;
    foreignSpeechPending: boolean;
    recentInjuryAdded: boolean;
    hostileEntityNames: string[];
    strainedAllyNames: string[];
    canonicalPersonalityNpcPresent: boolean;
    playerCorrected: boolean;
    correctionMarkers: string[];
    playerReciprocated: boolean;
    contactLevel: string;
    /**
     * v1.33 (M11) — the visceral rendering register is now triggered by what
     * the previous narrative actually CONTAINS, not by the scene mode. SOCIAL
     * is the ordinary conversation mode; both reviewed saves sat in it
     * permanently, so the old `mode === 'SOCIAL'` trigger asserted "this scene
     * contains intimacy, violence, fear, hunger, or bodily extremity" over
     * every quiet conversation in the game, with Blood Meridian as the
     * suggested register.
     */
    intimacyInScene: boolean;
    violenceInScene: boolean;
    /** Scheduler state — turn on which each key was last injected. */
    reminderLastShown: Record<string, number>;
}

export interface ReminderSelection {
    /** Reminder text blocks, in injection order. */
    reminders: string[];
    /** Keys injected this turn. The caller stamps these into reminderLastShown. */
    shown: ReminderKey[];
    /** Lines for the debug log — starvation and suppression are observable. */
    debug: string[];
}

interface RotationEntry {
    key: ReminderKey;
    text: string;
    /** Is this reminder meaningful on this turn at all? */
    eligible: (ctx: ReminderContext) => boolean;
    /** Minimum turns between showings. Staleness is measured against this. */
    minInterval: number;
}

/**
 * v1.33 — The rotation registry. Order here is a tie-break only: selection is
 * by staleness, so position in this list cannot starve an entry the way
 * position in the old else-if chain could.
 *
 * `minInterval` is the knob that used to be a modulus. WORLD_NORMALCY and
 * PROPORTIONALITY are the two calming entries, and their interval is scaled by
 * the worldPressure tone dial: at low pressure they come round more often.
 */
const buildRotation = (): RotationEntry[] => {
    // 0 (placid) → 0.6× the interval; 1 (relentless) → 1.6×.
    const calmScale = 0.6 + worldPressureUnit();
    const calming = (base: number) => Math.max(2, Math.round(base * calmScale));

    return [
        {
            key: 'WORLD_NORMALCY',
            text: REMINDERS.WORLD_NORMALCY,
            eligible: () => true,
            minInterval: calming(6),
        },
        {
            key: 'PROPORTIONALITY',
            text: REMINDERS.PROPORTIONALITY,
            // Calm social beats are where reaction inflation happens — a quiet
            // conversation with nothing at stake is exactly the context in
            // which an offhand remark gets read as a manifesto.
            eligible: (c) => (c.mode === 'SOCIAL' || c.mode === 'NARRATIVE') && c.tensionLevel < 40,
            minInterval: calming(4),
        },
        {
            key: 'GENRE_CONSISTENCY',
            text: REMINDERS.GENRE_CONSISTENCY,
            eligible: () => true,
            minInterval: 8,
        },
        {
            key: 'FACTION_PARITY',
            text: REMINDERS.FACTION_PARITY,
            eligible: () => true,
            minInterval: 10,
        },
        {
            key: 'NARRATIVE_INTEGRITY',
            text: REMINDERS.NARRATIVE_INTEGRITY,
            eligible: () => true,
            minInterval: 7,
        },
        {
            key: 'VOCABULARY',
            text: REMINDERS.VOCABULARY,
            eligible: () => true,
            minInterval: 6,
        },
        {
            key: 'INTIMATE',
            text: REMINDERS.INTIMATE,
            // v1.33: content-triggered, not mode-triggered.
            eligible: (c) => c.intimacyInScene,
            minInterval: 3,
        },
        {
            key: 'COMBAT',
            text: REMINDERS.COMBAT,
            // The old chain could never reach this: mode === 'COMBAT'
            // guaranteed both conditional slots went to HOSTILE_NPC_PROTOCOL
            // and VISCERAL_RENDER, so the combat-realism reminder was
            // unreachable in exactly the mode it was written for.
            eligible: (c) => c.mode === 'COMBAT' || c.violenceInScene,
            minInterval: 3,
        },
        {
            key: 'THREAT_SEED_INTEGRITY',
            text: REMINDERS.THREAT_SEED_INTEGRITY,
            eligible: (c) => c.liveThreatCount > 0 || c.mode === 'TENSION' || c.mode === 'COMBAT',
            minInterval: 6,
        },
        {
            key: 'GOAL_LIFECYCLE',
            text: REMINDERS.GOAL_LIFECYCLE,
            eligible: (c) => c.goalCount < 3,
            minInterval: 8,
        },
        {
            key: 'LOGISTICS_CHECK',
            text: REMINDERS.LOGISTICS_CHECK,
            eligible: (c) => c.liveThreatCount > 0,
            minInterval: 5,
        },
        {
            key: 'CONDITION_AUDIT',
            text: REMINDERS.CONDITION_AUDIT,
            eligible: (c) => c.conditionsCount > 20,
            minInterval: 8,
        },
    ];
};

/** Exposed so the reachability test can assert every key can actually fire. */
export const ROTATION_KEYS: ReminderKey[] = buildRotation().map(e => e.key);

/**
 * Staleness: how many turns since this key was last shown. A key that has
 * never been shown is maximally stale, so a fresh campaign cycles through the
 * whole registry before repeating anything.
 */
const staleness = (ctx: ReminderContext, key: ReminderKey): number => {
    const last = ctx.reminderLastShown[key];
    if (last === undefined) return Number.POSITIVE_INFINITY;
    return ctx.turnCount - last;
};

const pickRotation = (ctx: ReminderContext, exclude: Set<ReminderKey>): RotationEntry | null => {
    const candidates = buildRotation()
        .filter(e => !exclude.has(e.key))
        .filter(e => e.eligible(ctx))
        .filter(e => staleness(ctx, e.key) >= e.minInterval);

    if (candidates.length === 0) return null;

    // Most stale wins. Infinity (never shown) sorts first, so a new campaign
    // walks the registry before it repeats anything.
    candidates.sort((a, b) => staleness(ctx, b.key) - staleness(ctx, a.key));
    return candidates[0];
};

/**
 * v1.33 — Returns the reminders to inject this turn.
 *
 * Replaces the positional 21-argument signature with a context object. The old
 * signature had reached the point where the call site was a column of bare
 * booleans and a reader could not tell which flag was which.
 */
export const selectSectionReminders = (ctx: ReminderContext): ReminderSelection => {
    const reminders: string[] = [];
    const shown: ReminderKey[] = [];
    const debug: string[] = [];

    const push = (key: ReminderKey, text: string) => {
        reminders.push(text);
        shown.push(key);
    };

    // -----------------------------------------------------------------------
    // OVERRIDE — turn-shape changes. These return alone.
    // -----------------------------------------------------------------------
    if (ctx.dreamSeedActive) {
        push('DREAM_PROTOCOL', REMINDERS.DREAM_PROTOCOL);
        return { reminders, shown, debug };
    }

    if (ctx.playerCorrected) {
        // When the player explicitly rejects an NPC's reading of them, that is
        // the most important fact about this turn. Proportionality is the rule
        // the correction is invoking — pair them.
        push(
            'PLAYER_CORRECTION_PROTOCOL',
            `${REMINDERS.PLAYER_CORRECTION_PROTOCOL}\n\n[CORRECTION] The player's words: ${ctx.correctionMarkers.map(m => `"${m}"`).join(', ')}`,
        );
        push('PROPORTIONALITY', REMINDERS.PROPORTIONALITY);
        return { reminders, shown, debug };
    }

    // -----------------------------------------------------------------------
    // CONDITIONAL BAND — standing conditions, priority-ordered, budget-capped.
    // -----------------------------------------------------------------------
    const conditional: { key: ReminderKey; text: string }[] = [];
    const offer = (key: ReminderKey, text: string) => {
        if (conditional.length < CONDITIONAL_BUDGET) conditional.push({ key, text });
    };

    // Contact is on the table and the player did NOT reciprocate this turn.
    // An unreciprocated advance repeating turn after turn is the failure mode
    // this was written for, so it outranks the rest of the band.
    if (ctx.contactLevel !== 'none' && !ctx.playerReciprocated) {
        offer(
            'PHYSICAL_RECIPROCATION',
            `${REMINDERS.PHYSICAL_RECIPROCATION}\n\n[CONTACT LEVEL] ${ctx.contactLevel} — the player did not reciprocate or invite escalation this turn. Hold here or withdraw.`,
        );
    }

    if (ctx.conditionsCount > 30) {
        offer('CONDITION_AUDIT', REMINDERS.CONDITION_AUDIT);
    }
    if (ctx.passiveAlliesDetected) {
        offer('LOGISTICS_CHECK', REMINDERS.LOGISTICS_CHECK);
    }
    if (ctx.foreignSpeechPending) {
        offer('LANGUAGES_FOREIGN', REMINDERS.LANGUAGES_FOREIGN);
    }
    if (ctx.recentInjuryAdded) {
        offer('HEALING_TIMELINE', REMINDERS.HEALING_TIMELINE);
    }

    // Threat parity, scoped to named hostiles so its rules cannot be
    // misapplied to everyone else sharing the room.
    //
    // v1.33: `tensionLevel >= 50` was REMOVED from this trigger. High tension
    // is not the same thing as hostility — a storm, a birth, a chase and a
    // deadline are all high-tension and none of them has an adversary — and
    // when tension alone fired it, `hostileEntityNames` was empty, so the
    // protocol went in UNSCOPED. That is precisely the failure v1.28 scoped it
    // to fix: threat-parity behaviour switched on for everyone in the room.
    // A hostile scene now requires an actual hostile: a named one, a live
    // threat, or COMBAT.
    const hostileScene =
        ctx.hostileEntityNames.length > 0 ||
        ctx.liveThreatCount > 0 ||
        ctx.mode === 'COMBAT';
    if (hostileScene) {
        offer(
            'HOSTILE_NPC_PROTOCOL',
            ctx.hostileEntityNames.length > 0
                ? `${REMINDERS.HOSTILE_NPC_PROTOCOL}\n\n[HOSTILE IN SCENE] ${ctx.hostileEntityNames.join(', ')} — these entities and no others.`
                : REMINDERS.HOSTILE_NPC_PROTOCOL,
        );
    }

    if (ctx.strainedAllyNames.length > 0) {
        offer(
            'ALLY_STRAIN_PROTOCOL',
            `${REMINDERS.ALLY_STRAIN_PROTOCOL}\n\n[ALLY STRAIN] ${ctx.strainedAllyNames.join(', ')}`,
        );
    }

    if (ctx.canonicalPersonalityNpcPresent) {
        offer('CANONICAL_VOICE_LOCK', REMINDERS.CANONICAL_VOICE_LOCK);
    }

    // v1.33 (M11) — content-triggered, not mode-triggered.
    const registerTriggers: string[] = [];
    if (ctx.intimacyInScene) registerTriggers.push('intimacy detected in the preceding narrative');
    if (ctx.violenceInScene) registerTriggers.push('violence detected in the preceding narrative');
    if (ctx.tensionLevel >= 60) registerTriggers.push(`scene tension ${ctx.tensionLevel}/100`);
    if (registerTriggers.length > 0) {
        offer(
            'VISCERAL_RENDER',
            `${REMINDERS.VISCERAL_RENDER}\n\n[REGISTER TRIGGER] ${registerTriggers.join('; ')}.`,
        );
    }

    // ---- Low-priority nags. Deliberately BELOW the rendering and
    // characterization rules: a bookkeeping obligation should never displace
    // "write this person as who they are" or "render what is actually here".
    // Both also carry a re-fire interval, because both used to stand open
    // every single turn once their condition was met — the bargain clock for
    // 30 consecutive turns in the reviewed save, since `lastBargainTurn` only
    // resets when the model actually submits a bargain, which it never did.

    // v1.33 (M9) — the bargain clock. Three gates, where there used to be one.
    const turnsSinceLastBargain = ctx.worldTurn - ctx.lastBargainTurn;
    const bargainOverdue =
        ctx.worldTurn > 0 && turnsSinceLastBargain >= getTuning().bargainClockTurns;
    if (bargainOverdue) {
        const tenseEnough =
            ctx.tensionLevel >= BARGAIN_MIN_TENSION ||
            ctx.mode === 'TENSION' ||
            ctx.mode === 'COMBAT';
        const cooledDown = staleness(ctx, 'BARGAIN_CHECK') >= BARGAIN_REFIRE_INTERVAL;

        if (!tenseEnough) {
            // The reminder demands an offer on the next Hard/Severe roll where
            // failure is death or irreversible loss. On a tension-10
            // conversation no such roll exists, so the only way to discharge a
            // standing "not optional" obligation is to manufacture one.
            debug.push(
                `[BARGAIN CLOCK] Overdue by ${turnsSinceLastBargain - getTuning().bargainClockTurns} turn(s) ` +
                `but suppressed — tension ${ctx.tensionLevel} < ${BARGAIN_MIN_TENSION} and scene is ${ctx.mode}. ` +
                `A mandatory bargain has nothing to attach to on a calm beat.`,
            );
        } else if (!cooledDown) {
            debug.push(`[BARGAIN CLOCK] Overdue but shown ${staleness(ctx, 'BARGAIN_CHECK')} turn(s) ago — holding.`);
        } else {
            offer('BARGAIN_CHECK', REMINDERS.BARGAIN_CHECK);
        }
    }

    if (
        entityDensityViolated(ctx.worldTurn, ctx.entityCount) &&
        staleness(ctx, 'ENTITY_DENSITY') >= ENTITY_DENSITY_REFIRE_INTERVAL
    ) {
        offer('ENTITY_DENSITY', REMINDERS.ENTITY_DENSITY);
    }

    for (const c of conditional) push(c.key, c.text);

    // -----------------------------------------------------------------------
    // ROTATION BAND — its own budget. Never starved by the band above.
    // -----------------------------------------------------------------------
    if (ROTATION_BUDGET > 0 && ctx.turnCount >= 3) {
        const picked = pickRotation(ctx, new Set(shown));
        if (picked) {
            push(picked.key, picked.text);
            const s = staleness(ctx, picked.key);
            debug.push(
                `[ROTATION] ${picked.key} (stale ${s === Number.POSITIVE_INFINITY ? 'never shown' : `${s} turns`}, ` +
                `interval ${picked.minInterval})`,
            );
        } else {
            debug.push('[ROTATION] No eligible entry past its minimum interval this turn.');
        }
    }

    return { reminders, shown, debug };
};

/**
 * Back-compat shim for callers and tests that only want the text blocks.
 * The live path uses `selectSectionReminders` so it can stamp the scheduler.
 */
export const getSectionReminders = (ctx: ReminderContext): string[] =>
    selectSectionReminders(ctx).reminders;

/**
 * Builds a ReminderContext with every field defaulted, so tests and callers can
 * specify only what they care about. Defaults describe a calm, empty scene.
 */
export const makeReminderContext = (partial: Partial<ReminderContext> = {}): ReminderContext => ({
    turnCount: 0,
    worldTurn: 0,
    mode: 'NARRATIVE' as SceneMode,
    tensionLevel: 0,
    conditionsCount: 0,
    entityCount: 0,
    goalCount: 999,
    liveThreatCount: 0,
    lastBargainTurn: 0,
    passiveAlliesDetected: false,
    dreamSeedActive: false,
    foreignSpeechPending: false,
    recentInjuryAdded: false,
    hostileEntityNames: [],
    strainedAllyNames: [],
    canonicalPersonalityNpcPresent: false,
    playerCorrected: false,
    correctionMarkers: [],
    playerReciprocated: false,
    contactLevel: 'none',
    intimacyInScene: false,
    violenceInScene: false,
    reminderLastShown: {},
    ...partial,
});
