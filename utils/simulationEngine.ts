/**
 * simulationEngine.ts — v1.10
 *
 * v1.3 changes:
 *   - turnCount now increments on every successful turn and is written to GameWorld.
 *   - sanitiseAllFields() replaces the old validateResponse() call, covering ALL
 *     string fields in the AI response (conditions, memory, lore, NPC names, etc.).
 *   - Memory cap: hard limit of 40 entries. No new engrams when cap is reached.
 *   - sceneMode auto-transitions to NARRATIVE when both threat arrays are empty.
 *   - Threat seed state machine: ETA floor logging, ETA ~1 auto-expiry after 3 turns,
 *     hard cap of 3 simultaneous seeds.
 *   - lastBargainTurn is written to world state when a bargain_request is present.
 *   - factionIntelligence and legalStatus are initialised and preserved in world state.
 *   - BioEngine.tick() now receives sceneMode for accelerated post-combat decay.
 *
 * v1.4 changes:
 *   - ETA floors are now ENFORCED (not just logged): faction-level threats below
 *     ETA_FLOOR_FACTION are automatically bumped up to the floor value.
 *   - Lore semantic deduplication: new_lore is checked with checkLoreDuplicate()
 *     before being pushed to pendingLore. Near-duplicates are suppressed with a
 *     debug log. Semantic expansions are marked for the approval modal.
 *   - Updated imports to include checkLoreDuplicate and containsRenameMarker.
 *
 * v1.6 changes:
 *   - Origin Gate: validateThreatCausality() blocks threat seeds that cannot cite
 *     a dormant hook, a player action this session, or a faction with exposure >= 20.
 *   - updateFactionExposure(): runs each turn before threat processing. Observation
 *     verbs in world_tick NPC actions earn +15 exposure; scores decay -2/turn.
 *   - extractDormantHooks() added to CharacterService for session-start hook extraction.
 *   - processThreatSeeds() updated: new signature accepts dormantHooks + factionExposure,
 *     Origin Gate filter applied before ETA floor enforcement.
 *   - dormantHooks and factionExposure persisted in worldUpdate return value.
 *
 * v1.10 changes:
 *   - DE FACTO COMBAT DETECTION: getEffectiveSceneMode() examines NPC actions for
 *     combat verbs. If scene is TENSION but NPCs are shooting/charging/slashing,
 *     upgrades to effective COMBAT for Origin Gate/ETA/coherence purposes.
 *   - MESSENGER ENTITY SUPPRESSION: isMessengerThreat() + full entity suppression
 *     in validateNpcActionCoherence(). ALL NPC actions by a messenger entity are
 *     blocked until the messenger threat's ETA <= 2.
 *   - ALLIED NPC PASSIVITY DETECTION: detectAlliedPassivity() flags when bonded/
 *     companion NPCs are passive while hostile combat actions occur. Triggers
 *     LOGISTICS_CHECK reminder every turn via passiveAlliesDetected flag.
 *
 */

import {
    ModelResponseSchema, GameWorld, DebugLogEntry, LoreItem,
    Character, MemoryItem, SceneMode, WorldTime, WorldTickEvent,
    DormantHook, FactionExposure, WorldTickAction
} from '../types';
import { ReproductionSystem } from './reproductionSystem';
import { BioEngine } from './bioEngine';
import { generateLoreId, generateMemoryId } from '../idUtils';
import {
    sanitiseAllFields,
    decayBioModifiers,
    applyCeilings,
    findExpiredConditions,
    checkMemoryDuplicate,
    checkLoreDuplicate,
    findExistingLore,
    containsRenameMarker,
    checkConditionDuplicate,
    significantWords,
    jaccardSimilarity,
} from './contentValidation';
import { resolveAllBannedNames } from './nameResolver';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

interface SimulationResult {
    worldUpdate: GameWorld;
    characterUpdate: Character;
    debugLogs: DebugLogEntry[];
    pendingLore: LoreItem[];
}

const MAX_REGISTRY_LINES = 60;
const TIME_CAPS = { AWAKE_MAX: 120, SLEEP_MAX: 540, COMBAT_MAX: 30 };
const MEMORY_CAP = 40;
const THREAT_SEED_CAP = 3;
const MAX_CONSECUTIVE_ETA_ONE = 3; // turns before auto-expiry

// Minimum ETA floors by faction type
// v1.4: These are now ENFORCED in processThreatSeeds(), not just logged.
const ETA_FLOOR_FACTION = 15;
const ETA_FLOOR_INDIVIDUAL_NEUTRAL = 5;
const ETA_FLOOR_INDIVIDUAL_HOME = 3;
const ETA_FLOOR_ENVIRONMENTAL = 2;

// v1.9: Scene-mode-aware ETA floors — combat threats escalate in seconds, not turns
const ETA_FLOOR_COMBAT_INDIVIDUAL = 1;
const ETA_FLOOR_COMBAT_FACTION = 3;
const ETA_FLOOR_TENSION_INDIVIDUAL = 2;
const ETA_FLOOR_TENSION_FACTION = 5;

// v1.8: Anti-replacement-loop and plan-pivot constants
const PIVOT_DELAY_TURNS = 2;             // Extra turns added when AI rewrites a threat's plan
const ENTITY_NAME_MATCH_THRESHOLD = 1;   // Minimum shared entity names to consider continuity
const PIVOT_JACCARD_THRESHOLD = 0.35;    // Below this = plan pivot detected (description changed too much)

// v1.10: De facto combat detection — verbs in NPC actions that indicate actual combat
// regardless of the AI's stated scene_mode. If the scene contains these, it IS combat.
const COMBAT_ACTION_VERBS = new Set([
    'attack', 'attacks', 'attacked', 'attacking',
    'shoot', 'shoots', 'shot', 'shooting',
    'fire', 'fires', 'fired', 'firing',
    'charge', 'charges', 'charged', 'charging',
    'strike', 'strikes', 'struck', 'striking',
    'slash', 'slashes', 'slashed', 'slashing',
    'stab', 'stabs', 'stabbed', 'stabbing',
    'volley', 'volleys',
    'trample', 'tramples', 'trampled', 'trampling',
    'lance', 'lances', 'lanced', 'lancing',
    'cleave', 'cleaves', 'cleaved', 'cleaving',
    'kill', 'kills', 'killed', 'killing',
    'execute', 'executes', 'executed', 'executing',
    'impale', 'impales', 'impaled', 'impaling',
    'decapitate', 'decapitates', 'decapitated',
    'disembowel', 'disembowels', 'disemboweled',
    'crushes', 'crushed', 'crushing',
    'smash', 'smashes', 'smashed', 'smashing',
]);

// Broader patterns that indicate combat context (multi-word or participial)
const COMBAT_ACTION_PATTERNS = [
    /\b(?:draws?\s+(?:sword|weapon|bow|blade|knife|dagger|crossbow|lance|mace))/i,
    /\b(?:fire[sd]?\s+(?:arrow|bolt|volley|crossbow))/i,
    /\b(?:cavalry\s+charge)/i,
    /\b(?:heavy\s+cavalry)/i,
    /\b(?:prepare[sd]?\s+(?:to\s+)?(?:fire|attack|charge|strike|execute))/i,
    /\b(?:aim|aims|aimed|aiming)\s+(?:at|toward)/i,
    /\b(?:lunge[sd]?|leaps?|lunges?)\s+(?:at|toward|into)/i,
    /\b(?:arrows?\s+(?:hit|strike|land|lodge|sprout|pierce))/i,
    /\b(?:incendiary|fire-?arrow|alchemical\s+fire)/i,
    /\b(?:shred|shredding|rend|rending|tear|tearing|rip|ripping)\s/i,
    /\b(?:crossbow|longbow|shortbow|ballista|catapult|trebuchet)/i,
];

// v1.10: Messenger threat patterns — threats where an entity is traveling away
// to deliver information. These require full entity suppression until ETA <= 2.
const MESSENGER_PATTERNS = [
    /\bfleeing\s+toward/i,
    /\bheading\s+toward/i,
    /\btraveling\s+to/i,
    /\brunning\s+to/i,
    /\briding\s+to/i,
    /\bsprinting\s+toward/i,
    /\bfleeing\s+to/i,
    /\bescaping\s+to/i,
    /\breporting\s+to/i,
    /\bmaking\s+(?:his|her|their|its)\s+way\s+to/i,
    /\bheading\s+(?:for|to)\b/i,
    /\bwith\s+news\s+of/i,
];

// ---------------------------------------------------------------------------
// v1.8: Entity Name Extraction — prevents the AI from replacing threats by
// rewriting descriptions until Jaccard similarity drops below 0.60
// ---------------------------------------------------------------------------

// Common capitalized words that are NOT entity names.
// These appear at sentence starts or in titles and must not trigger matching.
const ENTITY_EXTRACTION_BLACKLIST = new Set([
    'the', 'this', 'that', 'these', 'those', 'there',
    'inspector', 'captain', 'magistrate', 'registrar', 'guild', 'city',
    'safety', 'guard', 'guards', 'crew', 'gang', 'squad', 'patrol',
    'council', 'court', 'office', 'hall', 'tavern', 'district',
    'north', 'south', 'east', 'west', 'upper', 'lower',
    'sector', 'level', 'floor', 'chamber', 'gate', 'wall',
    'day', 'night', 'morning', 'evening', 'turn',
    'warrant', 'arrest', 'inquiry', 'complaint', 'charges',
    'missing', 'person', 'fugitive', 'antagonist',
    'preparing', 'mobilizing', 'approaching', 'searching', 'tracking',
    'dungeon', 'sewer', 'undercity', 'docks', 'market',
]);

/**
 * Extracts probable entity/NPC names from a threat description.
 *
 * v1.8 REWRITE: Only matches against the REGISTERED entity names from
 * knownEntities. No longer extracts arbitrary capitalized words — that
 * approach caused catastrophic false positives (e.g., "Moira", "The",
 * "Guild" were treated as entity names, collapsing all threats into one).
 *
 * v1.9: Dynamic setting-word detection — words that appear across 3+ entity
 * names (e.g., "Tharnic" in "Tharnic Captain", "Tharnic Cinder-Guard",
 * "Tharnic Sergeant") are setting adjectives, not identifiers. Matching
 * requires at least one NON-setting significant part to hit.
 *
 * The player character's name is explicitly excluded since it appears
 * in virtually every threat and provides zero signal.
 *
 * Returns lowercase names for matching.
 */
const extractEntityNamesFromDescription = (
    description: string,
    knownEntityNames: string[] = [],
    playerCharacterName: string = ''
): string[] => {
    const names: Set<string> = new Set();
    const descLower = description.toLowerCase();

    // Extract player name parts for exclusion
    const playerNameParts = new Set(
        playerCharacterName.toLowerCase().split(/\s+/).filter(p => p.length >= 3)
    );

    // v1.9: Compute setting words — significant name parts appearing in 3+ entities.
    // These are culture/faction adjectives (e.g., "tharnic", "zhentarim") that describe
    // the setting, not specific actors. Using them alone for matching causes false
    // continuity (every "Tharnic X" threat collapses into one).
    const partFrequency: Map<string, number> = new Map();
    for (const entityName of knownEntityNames) {
        const primary = entityName.split('(')[0].trim().toLowerCase();
        const parts = primary.split(/\s+/).filter(p => p.length >= 3 && !ENTITY_EXTRACTION_BLACKLIST.has(p));
        // Deduplicate per-entity so one entity can't inflate its own parts
        const uniqueParts = new Set(parts);
        for (const part of uniqueParts) {
            partFrequency.set(part, (partFrequency.get(part) ?? 0) + 1);
        }
    }
    const settingWords = new Set(
        [...partFrequency.entries()]
            .filter(([_, count]) => count >= 3)
            .map(([word]) => word)
    );

    // ONLY match against registered entity names from knownEntities.
    // This ensures we only track THREAT ACTORS, not common nouns.
    for (const entityName of knownEntityNames) {
        // Extract the primary name (before parenthetical like "Kavar (Zhentarim)")
        const primary = entityName.split('(')[0].trim().toLowerCase();
        if (primary.length < 3) continue;

        const primaryParts = primary.split(/\s+/);

        // Skip if this is the player character themselves.
        // Only check the FIRST significant name part (given name) — family names
        // like "Mercer" are shared with relatives (e.g., "Nesta Mercer" is the
        // player's mother and should NOT be excluded).
        const firstSignificantPart = primaryParts.find(p => p.length >= 3 && !ENTITY_EXTRACTION_BLACKLIST.has(p));
        const isPlayerName = firstSignificantPart !== undefined && playerNameParts.has(firstSignificantPart);
        if (isPlayerName) continue;

        // Skip blacklisted common words
        if (primaryParts.every(part => ENTITY_EXTRACTION_BLACKLIST.has(part))) continue;

        // v1.9: Identify which parts are setting words vs identity words.
        // A match requires at least one NON-setting significant part to appear.
        const significantParts = primaryParts.filter(part =>
            part.length >= 3 && !ENTITY_EXTRACTION_BLACKLIST.has(part)
        );
        const identityParts = significantParts.filter(part => !settingWords.has(part));
        const settingOnlyParts = significantParts.filter(part => settingWords.has(part));

        if (significantParts.length === 0) continue;

        if (identityParts.length > 0) {
            // Has identity parts — require at least one identity part to match
            if (identityParts.some(part => descLower.includes(part))) {
                names.add(primary);
            }
        } else if (settingOnlyParts.length > 0) {
            // ALL significant parts are setting words (e.g., "Tharnic Patrol").
            // Only match if the FULL multi-word name appears as a phrase.
            const fullPhrase = significantParts.join(' ');
            if (fullPhrase.length >= 6 && descLower.includes(fullPhrase)) {
                names.add(primary);
            }
        }
    }

    // Also extract quoted or apostrophe-bounded faction names like 'The Rusty Hook'
    // or 'Broken Hand' — these are named entities even if not in the registry yet.
    const quotedNames = description.match(/['']([A-Z][^'']{2,30})['']|"([A-Z][^"]{2,30})"/g);
    if (quotedNames) {
        for (const match of quotedNames) {
            const cleaned = match.replace(/[''""]/g, '').trim().toLowerCase();
            // Skip if all words are blacklisted
            const parts = cleaned.split(/\s+/);
            if (!parts.every(p => ENTITY_EXTRACTION_BLACKLIST.has(p))) {
                names.add(cleaned);
            }
        }
    }

    return Array.from(names);
};

// ---------------------------------------------------------------------------
// Pure Helper Functions
// ---------------------------------------------------------------------------

const updateTime = (currentMinutes: number, delta: number): WorldTime => {
    const totalMinutes = currentMinutes + delta;
    const day = Math.floor(totalMinutes / 1440) + 1;
    const hour = Math.floor((totalMinutes % 1440) / 60);
    const minute = totalMinutes % 60;
    const display = `Day ${day}, ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    return { totalMinutes, day, hour, minute, display };
};

const trimHiddenRegistry = (registry: string): string => {
    if (!registry) return "";
    const lines = registry.split('\n').filter(l => l.trim());
    if (lines.length <= MAX_REGISTRY_LINES) return registry;
    return lines.slice(-MAX_REGISTRY_LINES).join('\n');
};

const calculateTimeDelta = (
    requestedMinutes: number | undefined,
    hasSleep: boolean,
    isCombat: boolean
): { delta: number, log?: string } => {
    const rawDelta = requestedMinutes ?? 0;

    let maxAllowed: number;
    if (hasSleep) maxAllowed = TIME_CAPS.SLEEP_MAX;
    else if (isCombat) maxAllowed = TIME_CAPS.COMBAT_MAX;
    else maxAllowed = TIME_CAPS.AWAKE_MAX;

    const delta = Math.min(Math.max(0, rawDelta), maxAllowed);

    if (rawDelta > maxAllowed) {
        return {
            delta,
            log: `[TIME-CLAMP] AI requested +${rawDelta}m, clamped to +${delta}m (cap: ${maxAllowed})`
        };
    }
    return { delta };
};

/**
 * Generates a simple unique ID for threat seeds.
 */
const generateThreatId = (): string =>
    `threat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// ---------------------------------------------------------------------------
// v1.10: De Facto Combat Detection
// ---------------------------------------------------------------------------

/**
 * Examines NPC actions for combat verbs and patterns. If actual combat is
 * happening (arrows firing, cavalry charging, melee fighting), returns 'COMBAT'
 * regardless of the AI's stated scene_mode. This closes the critical gap where
 * the AI labels active combat as TENSION, preventing the engine's COMBAT
 * bypasses from activating.
 *
 * Only UPGRADES scene mode (TENSION → COMBAT). Never downgrades COMBAT → TENSION.
 */
const getEffectiveSceneMode = (
    statedMode: string,
    npcActions: WorldTickAction[],
    debugLogs: DebugLogEntry[]
): string => {
    // If already COMBAT, no override needed
    if (statedMode === 'COMBAT') return 'COMBAT';

    // Only upgrade TENSION → COMBAT (not NARRATIVE/SOCIAL)
    if (statedMode !== 'TENSION') return statedMode;

    // Check NPC actions for combat activity
    let combatActionCount = 0;
    for (const action of npcActions) {
        const actionLower = action.action.toLowerCase();
        const words = actionLower.split(/\s+/);

        // Check individual combat verbs
        if (words.some(w => COMBAT_ACTION_VERBS.has(w))) {
            combatActionCount++;
            continue;
        }

        // Check multi-word combat patterns
        if (COMBAT_ACTION_PATTERNS.some(p => p.test(action.action))) {
            combatActionCount++;
        }
    }

    // Require at least 2 combat actions to confirm de facto combat
    // (a single "draws sword" might be a threat display, not active combat)
    if (combatActionCount >= 2) {
        debugLogs.push({
            timestamp: new Date().toISOString(),
            message: `[SCENE OVERRIDE — v1.10] De facto COMBAT detected: ${combatActionCount} NPC actions ` +
                `contain combat verbs. Overriding stated "${statedMode}" → "COMBAT" for ` +
                `Origin Gate, ETA floors, and coherence checks.`,
            type: 'warning'
        });
        return 'COMBAT';
    }

    return statedMode;
};

/**
 * Checks if a threat is a "messenger threat" — one where the primary entity
 * is traveling away from the scene to deliver information elsewhere.
 * These threats need special handling: the messenger's NPC actions should be
 * suppressed entirely (not just arrival actions) until the threat's ETA is
 * low enough for them to plausibly have arrived.
 */
const isMessengerThreat = (threat: WorldTickEvent): boolean => {
    return MESSENGER_PATTERNS.some(p => p.test(threat.description));
};

/**
 * v1.10: Detects when allied NPCs are passive during hostile combat actions.
 * Returns a list of passive allies that should be acting.
 */
const detectAlliedPassivity = (
    npcActions: WorldTickAction[],
    knownEntities: { name: string; role: string; relationship_level: string }[],
    debugLogs: DebugLogEntry[]
): string[] => {
    // Identify allied entities (bonded, loyal, companion-type)
    const ALLIED_ROLES = /protector|companion|mate|familiar|bonded|guardian|pet|mount|summon|allied|loyal/i;
    const ALLIED_RELATIONSHIPS = new Set(['bonded', 'loyal', 'devoted', 'friendly']);

    const alliedEntities = knownEntities.filter(e =>
        ALLIED_ROLES.test(e.role) || ALLIED_RELATIONSHIPS.has(e.relationship_level)
    );
    if (alliedEntities.length === 0) return [];

    // Check if hostile combat actions are happening
    let hostileCombatActions = 0;
    for (const action of npcActions) {
        const actionLower = action.action.toLowerCase();
        const words = actionLower.split(/\s+/);
        const isCombat = words.some(w => COMBAT_ACTION_VERBS.has(w)) ||
            COMBAT_ACTION_PATTERNS.some(p => p.test(action.action));

        // Is this from a non-allied NPC?
        const isAllyAction = alliedEntities.some(a => {
            const primaryName = a.name.split('(')[0].trim().toLowerCase();
            return action.npc_name.toLowerCase().includes(primaryName) ||
                primaryName.includes(action.npc_name.toLowerCase());
        });

        if (isCombat && !isAllyAction) {
            hostileCombatActions++;
        }
    }

    if (hostileCombatActions === 0) return [];

    // Check what allied NPCs are doing — flag passive ones
    const PASSIVE_INDICATORS = [
        /\bgrowl/i, /\bsnarl/i, /\bcircl/i, /\bgroom/i,
        /\bwatch/i, /\bsniff/i, /\bnudge/i, /\blick/i,
        /\brest/i, /\bsleep/i, /\bwait/i, /\bstand/i,
        /\bguard/i, /\bvigil/i, /\bmark/i, /\bscent/i,
        /\bnuzzl/i, /\brasp/i, /\bpurr/i, /\bhover/i,
        /\bpace[sd]?\b/i, /\bperch/i,
    ];

    const passiveAllies: string[] = [];
    for (const ally of alliedEntities) {
        const allyNameLower = ally.name.split('(')[0].trim().toLowerCase();
        const allyActions = npcActions.filter(a =>
            a.npc_name.toLowerCase().includes(allyNameLower) ||
            allyNameLower.includes(a.npc_name.toLowerCase())
        );

        if (allyActions.length === 0) {
            // Ally has NO actions this turn while hostiles are fighting
            passiveAllies.push(ally.name);
            continue;
        }

        // Check if all of this ally's actions are passive
        const allPassive = allyActions.every(a =>
            PASSIVE_INDICATORS.some(p => p.test(a.action)) &&
            !COMBAT_ACTION_VERBS.has(a.action.toLowerCase().split(/\s+/)[0]) &&
            !COMBAT_ACTION_PATTERNS.some(p => p.test(a.action))
        );

        if (allPassive) {
            passiveAllies.push(ally.name);
        }
    }

    if (passiveAllies.length > 0) {
        debugLogs.push({
            timestamp: new Date().toISOString(),
            message: `[ALLIED PASSIVITY — v1.10] ${hostileCombatActions} hostile combat actions this turn, ` +
                `but allied NPC(s) [${passiveAllies.join(', ')}] are PASSIVE. ` +
                `Allied NPCs with standing combat orders should be actively fighting.`,
            type: 'error'
        });
    }

    return passiveAllies;
};

// ---------------------------------------------------------------------------
// v1.6: Exposure scoring constants
// ---------------------------------------------------------------------------

/** Minimum exposure score before a threat can be seeded from that source. */
const EXPOSURE_THRESHOLD_FOR_THREAT = 20;
/** Exposure earned when a faction NPC directly observes the player. */
const EXPOSURE_DIRECT_OBSERVATION = 15;
/** Exposure earned when the player takes a notable public action. */
const EXPOSURE_PUBLIC_ACTION = 10;
/** Exposure decay per turn when no new observations occur. */
const EXPOSURE_DECAY_PER_TURN = 2;

// ---------------------------------------------------------------------------
// v1.6: updateFactionExposure
// ---------------------------------------------------------------------------

/**
 * Updates the faction exposure registry each turn based on world_tick NPC actions.
 * Called BEFORE processThreatSeeds so same-turn exposure is available for validation.
 */
const updateFactionExposure = (
    currentExposure: FactionExposure,
    npcActions: WorldTickAction[],
    currentTurn: number,
    debugLogs: DebugLogEntry[]
): FactionExposure => {
    const updated: FactionExposure = { ...currentExposure };

    // Decay all existing scores
    for (const key of Object.keys(updated)) {
        const entry = { ...updated[key] };
        entry.exposureScore = Math.max(0, entry.exposureScore - EXPOSURE_DECAY_PER_TURN);
        updated[key] = entry;
    }

    // Award exposure for NPC actions that involve observing the player
    for (const action of npcActions) {
        if (!action.player_visible) continue;

        const actionLower = action.action.toLowerCase();
        const isObservingPlayer =
            actionLower.includes('watches') ||
            actionLower.includes('observes') ||
            actionLower.includes('notices') ||
            actionLower.includes('follows') ||
            actionLower.includes('reports') ||
            actionLower.includes('describes') ||
            actionLower.includes('identifies') ||
            actionLower.includes('spots');

        if (isObservingPlayer) {
            const key = action.npc_name;
            const existing = updated[key] ?? {
                exposureScore: 0,
                lastObservedAction: null,
                lastObservedTurn: 0,
                observedCapabilities: []
            };
            const newScore = Math.min(100, existing.exposureScore + EXPOSURE_DIRECT_OBSERVATION);
            updated[key] = {
                ...existing,
                exposureScore: newScore,
                lastObservedAction: action.action,
                lastObservedTurn: currentTurn
            };
            debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[EXPOSURE] ${key}: +${EXPOSURE_DIRECT_OBSERVATION} → ${newScore} (direct observation)`,
                type: 'info'
            });
        }
    }

    return updated;
};

// ---------------------------------------------------------------------------
// v1.6: validateThreatCausality — the Origin Gate
// ---------------------------------------------------------------------------

/**
 * Every new threat seed must pass ONE of three origin tests:
 *   1. It cites a DormantHook.id that exists and isn't resolved.
 *   2. It cites a specific player action this session (playerActionCause).
 *   3. The factionSource has accumulated exposure >= EXPOSURE_THRESHOLD_FOR_THREAT.
 *
 * Existing threats (turnCreated < currentTurn) are not re-validated.
 */
const validateThreatCausality = (
    threat: WorldTickEvent,
    dormantHooks: DormantHook[],
    factionExposure: FactionExposure,
    currentTurn: number,
    debugLogs: DebugLogEntry[],
    knownEntityNames: string[] = [],    // v1.8: for validating observer entities
    playerCharacterName: string = ''    // v1.8: for self-evident action matching
): boolean => {
    const log = (msg: string) => debugLogs.push({
        timestamp: new Date().toISOString(),
        message: msg,
        type: 'warning'
    });

    // Only validate new seeds created this turn
    if (threat.turnCreated !== undefined && threat.turnCreated < currentTurn) {
        return true;
    }

    const desc = threat.description.substring(0, 80);

    // Gate 1: Dormant Hook reference
    // v1.8: The hook's summary must have semantic overlap with the threat description.
    // This prevents citing "wealth target" hook for a "magic tracking" threat.
    if (threat.dormantHookId) {
        const hook = dormantHooks.find(h => h.id === threat.dormantHookId);
        if (hook && hook.status !== 'resolved') {
            // v1.8: Semantic overlap check — at least 2 significant words must overlap
            const hookWords = significantWords(hook.summary);
            const threatWords = significantWords(threat.description);
            const overlap = [...hookWords].filter(w => threatWords.has(w));
            if (overlap.length >= 2) {
                log(`[ORIGIN GATE ✓] "${desc}" — hook: ${hook.summary} (overlap: [${overlap.join(', ')}])`);
                return true;
            }
            log(
                `[ORIGIN GATE ✗ — v1.8 SEMANTIC MISMATCH] "${desc}" — ` +
                `hook "${hook.id}" summary has insufficient overlap with threat description ` +
                `(${overlap.length} shared words: [${overlap.join(', ')}]). ` +
                `The hook topic doesn't match the threat topic. BLOCKED.`
            );
            return false;
        }
        log(`[ORIGIN GATE ✗] "${desc}" — dormantHookId "${threat.dormantHookId}" not found or resolved. BLOCKED.`);
        return false;
    }

    // Gate 2: Player action cause
    // v1.8: The cause must reference a SPECIFIC, REGISTERED observer entity.
    // Generic causes like "witnesses reported" or "the magical residue attracted attention"
    // are insufficient — they create phantom observers. The AI must name an NPC
    // who was physically present and is already in the entity registry.
    if (threat.playerActionCause && threat.playerActionCause.trim().length > 10) {
        const causeLower = threat.playerActionCause.toLowerCase();
        const entityNamesLower = knownEntityNames.map(n => n.toLowerCase());

        // Check if any registered entity name appears in the cause string
        const observerFound = entityNamesLower.some(name => {
            // Match full name or first significant word (handles "Kavar" from "Kavar (Zhentarim)")
            const firstName = name.split(/[\s(]/)[0].trim();
            return firstName.length >= 3 && causeLower.includes(firstName);
        });

        if (observerFound) {
            log(`[ORIGIN GATE ✓] "${desc}" — player action: "${threat.playerActionCause}"`);
            return true;
        }

        // Allow causes that describe self-evident player actions without a specific observer
        // (e.g., "Moira cast a loud spell on an open road" — the action itself is the cause)
        // These must use language indicating the action was publicly observable.
        const playerNameParts = playerCharacterName.toLowerCase().split(/\s+/).filter(p => p.length >= 3);
        const playerNamePattern = playerNameParts.length > 0
            ? new RegExp(`player|character|${playerNameParts.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}`, 'i')
            : /player|character/i;
        const selfEvidentPatterns = [
            playerNamePattern,     // Names the player (dynamic)
        ];
        const publicityPatterns = [
            /open road|public|trade way|street|market|gate|crowd/i,  // Public location
            /loud|visible|flashy|bright|explosion|blast/i,            // Conspicuous action
        ];
        const hasSelfEvident = selfEvidentPatterns.some(p => p.test(threat.playerActionCause));
        const hasPublicity = publicityPatterns.some(p => p.test(threat.playerActionCause));

        if (hasSelfEvident && hasPublicity) {
            log(`[ORIGIN GATE ✓] "${desc}" — player action (self-evident public): "${threat.playerActionCause}"`);
            return true;
        }

        log(
            `[ORIGIN GATE ✗ — v1.8 NO REGISTERED OBSERVER] "${desc}" — ` +
            `playerActionCause "${threat.playerActionCause.substring(0, 80)}" does not reference ` +
            `a registered entity from knownEntities. The observer must be an established NPC. BLOCKED.`
        );
        return false;
    }

    // Gate 3: Faction exposure
    if (threat.factionSource) {
        const exposure = factionExposure[threat.factionSource];
        if (exposure && exposure.exposureScore >= EXPOSURE_THRESHOLD_FOR_THREAT) {
            log(`[ORIGIN GATE ✓] "${desc}" — ${threat.factionSource} exposure: ${exposure.exposureScore}`);
            return true;
        }
        const score = exposure?.exposureScore ?? 0;
        log(`[ORIGIN GATE ✗] "${desc}" — ${threat.factionSource} exposure ${score} < ${EXPOSURE_THRESHOLD_FOR_THREAT}. BLOCKED.`);
        return false;
    }

    // No gate passed
    log(`[ORIGIN GATE ✗] "${desc}" — no dormantHookId, no playerActionCause, no factionSource with exposure. BLOCKED.`);
    return false;
};

// ---------------------------------------------------------------------------
// v1.3 / v1.4: Threat Seed State Machine
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// v1.7: NPC Action Coherence — prevents world_tick from bypassing threat ETAs
// ---------------------------------------------------------------------------

/**
 * Validates that world_tick NPC actions don't contradict emerging threat ETAs.
 *
 * The AI's primary bypass vector is: set an emerging_threat with ETA 15, then
 * use npc_actions to show the threat already arriving/acting locally. This
 * validator detects when a hidden NPC action references terms/entities from
 * an emerging threat whose ETA is still > coherence threshold, and blocks those actions.
 *
 * v1.9: Scene-mode awareness.
 *   COMBAT: Skip coherence entirely — all NPCs are in-scene.
 *   TENSION: Check only hidden actions with threshold ETA > 1.
 *   NARRATIVE/SOCIAL: Check BOTH visible and hidden actions for entities
 *     linked to distant threats. This closes the vector where the AI marks
 *     a messenger's arrival as player_visible to bypass the check.
 *     Threshold: ETA > 1 for arrival actions.
 */
const validateNpcActionCoherence = (
    npcActions: WorldTickAction[],
    emergingThreats: WorldTickEvent[],
    currentTurn: number,
    debugLogs: DebugLogEntry[],
    sceneMode: string = 'NARRATIVE'   // v1.9
): WorldTickAction[] => {
    const log = (msg: string, type: DebugLogEntry['type'] = 'warning') => {
        debugLogs.push({ timestamp: new Date().toISOString(), message: msg, type });
    };

    // v1.9: During active COMBAT, all NPCs are physically present in the scene.
    // Coherence checking would block legitimate combat actions (archers shooting,
    // cavalry charging, etc.) whose ETA floors just got bumped by the engine.
    if (sceneMode === 'COMBAT') return npcActions;

    // Build entity names from threats with ETA > 1
    // v1.9: Use entity-name matching instead of keyword extraction to prevent
    // false positives from common words in threat descriptions.
    const distantThreatEntities: Map<string, { eta: number; originalEta: number }> = new Map();
    // v1.10: Track messenger threat entities separately — these get FULL suppression
    const messengerEntities: Map<string, { eta: number }> = new Map();
    for (const threat of emergingThreats) {
        const eta = threat.turns_until_impact ?? 0;
        if (eta <= 1) continue; // Imminent threats — NPC can appear freely

        const entityNames = threat.entitySourceNames ?? [];

        // v1.10: Messenger threats get full entity suppression until ETA <= 2.
        // When Garek is "fleeing toward a battalion" (ETA 5), ANY action by Garek
        // is invalid — he's not here. Not just "arrival" actions.
        const isMessenger = isMessengerThreat(threat) && eta > 2;
        if (isMessenger) {
            for (const name of entityNames) {
                const nameLower = name.toLowerCase();
                const parts = nameLower.split(/\s+/).filter(p =>
                    p.length >= 3 && !ENTITY_EXTRACTION_BLACKLIST.has(p)
                );
                for (const part of parts) {
                    const existing = messengerEntities.get(part);
                    if (!existing || eta > existing.eta) {
                        messengerEntities.set(part, { eta });
                    }
                }
            }
        }

        for (const name of entityNames) {
            const nameLower = name.toLowerCase();
            // Extract the identity part (skip setting words / blacklisted)
            const parts = nameLower.split(/\s+/).filter(p =>
                p.length >= 3 && !ENTITY_EXTRACTION_BLACKLIST.has(p)
            );
            for (const part of parts) {
                const existing = distantThreatEntities.get(part);
                if (!existing || eta > existing.eta) {
                    distantThreatEntities.set(part, {
                        eta,
                        originalEta: threat.originalEta ?? eta
                    });
                }
            }
        }
    }

    if (distantThreatEntities.size === 0 && messengerEntities.size === 0) return npcActions;

    // Verbs indicating physical presence / arrival at a location
    const ARRIVAL_INDICATORS = [
        'arrived', 'arriving', 'reached', 'reaching',
        'approaching', 'entered', 'entering',
        'dismounting', 'dismounted',
        'surrounding', 'surrounded',
        'position', 'positioned', 'in position',
        'slaughter', 'slaughtering',
        'moving through', 'fan out', 'fanned out', 'fanout',
        'pincer', 'encircle', 'encircling',
        'back alleys', 'perimeter',
        'outskirts', 'edge of town', 'edge of the town',
        'north gate', 'south gate', 'east gate', 'west gate',
        'town square', 'town center',
        'three-mile', 'one-mile', 'half-mile',
        // v1.9: Additional arrival verbs observed in save data
        'collapses inside', 'collapses in front', 'collapses at',
        'leads the', 'leading the',   // "Leads the patrol to the site"
        'signals', 'signaling',        // "Signals the riders" (implies present with group)
        'within sight', 'in sight of',
        'draws', 'drawing in the dust', // "Drawing a wolf in the dust to explain"
        'waving his arms', 'waving her arms',
        'breaches the', 'breaks through',
        'crawls into', 'stumbles into',
    ];

    return npcActions.filter(action => {
        // v1.9: During TENSION, only check hidden actions (visible NPCs are in-scene)
        // During NARRATIVE/SOCIAL, check ALL actions — the AI bypasses by marking
        // distant messenger arrivals as player_visible.
        if (sceneMode === 'TENSION' && action.player_visible) return true;

        const actionLower = action.action.toLowerCase();
        const npcNameLower = action.npc_name.toLowerCase();

        // v1.10: MESSENGER ENTITY FULL SUPPRESSION
        // If this NPC is the primary entity of a messenger threat (ETA > 2),
        // ALL actions by them are blocked — not just arrival actions.
        // The messenger is physically elsewhere (traveling to report).
        for (const [entityPart, { eta }] of messengerEntities.entries()) {
            if (npcNameLower.includes(entityPart)) {
                log(
                    `[NPC ACTION BLOCKED — v1.10 MESSENGER] "${action.npc_name}: ` +
                    `${action.action.substring(0, 100)}" — entity "${entityPart}" is ` +
                    `the subject of a messenger threat with ETA ${eta} (> 2). ` +
                    `Messenger NPCs cannot appear locally while traveling to their destination.`,
                    'error'
                );
                return false;
            }
        }

        // Check if this NPC's name matches a distant threat entity
        for (const [entityPart, { eta, originalEta }] of distantThreatEntities.entries()) {
            // Check both the NPC name and the action text for the entity name
            const entityInAction = npcNameLower.includes(entityPart) || actionLower.includes(entityPart);
            if (!entityInAction) continue;

            const hasArrivalIndicator = ARRIVAL_INDICATORS.some(v => actionLower.includes(v));
            if (hasArrivalIndicator) {
                log(
                    `[NPC ACTION BLOCKED — v1.9 COHERENCE] "${action.npc_name}: ` +
                    `${action.action.substring(0, 100)}" — implies local presence of ` +
                    `entity "${entityPart}" from threat with ETA ${eta} (original: ${originalEta}). ` +
                    `Actions cannot advance threats faster than their ETA countdown.`,
                    'error'
                );
                return false;
            }
        }

        return true;
    });
};

// ---------------------------------------------------------------------------
// v1.8: Hidden Update Coherence — closes the hidden_update bypass vector
// ---------------------------------------------------------------------------

/**
 * Validates that hidden_update text doesn't describe threat entities as locally
 * present when their threat ETA is still > 3. The AI uses hidden_update to
 * narrate threat progress (e.g., "Kavar has tracked the player to the shop") even
 * when NPC actions would be blocked by the coherence check.
 *
 * Returns the sanitised hidden_update string with violating lines stripped.
 */
const validateHiddenUpdateCoherence = (
    hiddenUpdate: string,
    emergingThreats: WorldTickEvent[],
    debugLogs: DebugLogEntry[],
    playerCharacterName: string = '',
    sceneMode: string = 'NARRATIVE'   // v1.9
): string => {
    if (!hiddenUpdate || hiddenUpdate.trim().length === 0) return hiddenUpdate;

    // v1.9: During COMBAT, all entities are in-scene — skip coherence
    if (sceneMode === 'COMBAT') return hiddenUpdate;

    // Build entity names from distant threats (ETA > 3)
    const distantThreatEntityNames: Map<string, number> = new Map();
    for (const threat of emergingThreats) {
        const eta = threat.turns_until_impact ?? 0;
        if (eta <= 3) continue;

        // Use stored entity names if available, otherwise extract
        const names = threat.entitySourceNames ??
            extractEntityNamesFromDescription(threat.description, [], playerCharacterName);
        for (const name of names) {
            const existing = distantThreatEntityNames.get(name) ?? 0;
            if (eta > existing) distantThreatEntityNames.set(name, eta);
        }
    }

    if (distantThreatEntityNames.size === 0) return hiddenUpdate;

    // Arrival/presence indicators that suggest the entity is at the player's location
    const PRESENCE_INDICATORS = [
        'tracked', 'found', 'located', 'spotted', 'identified',
        'arrived', 'reached', 'entered', 'barged', 'searched',
        'questioning', 'interrogat', 'demanding', 'confronting',
        'surrounding', 'watching the', 'outside the shop',
        'one curtain away', 'at the door', 'at the front',
        'in the shop', 'in the tavern', 'in the building',
        'currently question', 'currently search',
    ];

    // Split into lines and filter
    const lines = hiddenUpdate.split('\n');
    const filtered = lines.filter(line => {
        const lineLower = line.toLowerCase();

        for (const [entityName, eta] of distantThreatEntityNames.entries()) {
            if (!lineLower.includes(entityName)) continue;

            const hasPresence = PRESENCE_INDICATORS.some(p => lineLower.includes(p));
            if (hasPresence) {
                debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: `[HIDDEN UPDATE BLOCKED — v1.8 COHERENCE] "${line.substring(0, 100)}" — ` +
                        `describes "${entityName}" as locally present, but threat ETA is ${eta}. ` +
                        `Hidden updates cannot bypass threat ETAs.`,
                    type: 'error'
                });
                return false;
            }
        }
        return true;
    });

    return filtered.join('\n');
};

/**
 * Processes the emerging_threats array from the AI response:
 *   1. Assigns IDs and creation turns to new seeds.
 *   2. Tracks consecutive turns at ETA ~1.
 *   3. Auto-expires seeds that have been at ~1 for MAX_CONSECUTIVE_ETA_ONE turns.
 *   4. Enforces a hard cap of THREAT_SEED_CAP simultaneous seeds.
 *   5. v1.4: ENFORCES ETA floors — faction threats below ETA_FLOOR_FACTION are
 *      bumped up automatically, not just logged.
 *   6. v1.6: Origin Gate filter applied after Step 1 — new seeds blocked if they
 *      cannot cite a dormant hook, a player action, or sufficient faction exposure.
 *   7. v1.8: Entity-name-based continuity matching — prevents the AI from resetting
 *      threat ETAs by rewriting descriptions. Plan-pivot delay enforced when the AI
 *      substantially changes a threat's plan mid-countdown.
 *   8. v1.9: Scene-mode awareness — COMBAT uses lower ETA floors (1/3 instead of
 *      5/15) and bypasses Origin Gate entirely. Description lock relaxed when
 *      ETA is counting down normally (progression, not retcon).
 */
const processThreatSeeds = (
    incomingThreats: WorldTickEvent[],
    existingThreats: WorldTickEvent[],
    currentTurn: number,
    debugLogs: DebugLogEntry[],
    dormantHooks: DormantHook[] = [],       // v1.6: origin gate
    factionExposure: FactionExposure = {},  // v1.6: origin gate
    knownEntityNames: string[] = [],        // v1.8: entity-name continuity
    playerCharacterName: string = '',       // v1.8: exclude player name from entity matching
    sceneMode: string = 'NARRATIVE'         // v1.9: scene-aware floors + origin gate bypass
): WorldTickEvent[] => {
    const log = (message: string, type: DebugLogEntry['type'] = 'warning') => {
        debugLogs.push({ timestamp: new Date().toISOString(), message, type });
    };

    // Step 1: Annotate incoming threats — assign IDs, enforce floors, track ETA ~1 streaks
    const processed: WorldTickEvent[] = incomingThreats.map(threat => {
        let existing = existingThreats.find(t => t.id && t.id === threat.id);

        // v1.5: Enhanced re-submission detection — Jaccard similarity
        if (!threat.id && !existing) {
             existing = existingThreats.find(t => {
                const sim = jaccardSimilarity(
                    significantWords(threat.description),
                    significantWords(t.description)
                );
                return sim >= 0.60;
            });
        }

        // v1.8: Entity-name-based continuity matching
        // If Jaccard didn't match, check if the threat mentions the same NPC/faction
        // names as an existing threat. This catches the "description rewrite" bypass
        // where the AI changes the plan details but keeps the same threat actor.
        let entityMatchUsed = false;
        if (!existing) {
            const incomingNames = extractEntityNamesFromDescription(
                threat.description, knownEntityNames, playerCharacterName
            );

            if (incomingNames.length > 0) {
                for (const existingThreat of existingThreats) {
                    const existingNames = existingThreat.entitySourceNames ??
                        extractEntityNamesFromDescription(
                            existingThreat.description, knownEntityNames, playerCharacterName
                        );

                    const sharedNames = incomingNames.filter(n => existingNames.includes(n));
                    if (sharedNames.length >= ENTITY_NAME_MATCH_THRESHOLD) {
                        existing = existingThreat;
                        entityMatchUsed = true;
                        log(
                            `[THREAT CONTINUITY — v1.8 ENTITY MATCH] "${threat.description.substring(0, 60)}" ` +
                            `matched existing threat via shared entity name(s): [${sharedNames.join(', ')}]. ` +
                            `Inheriting ID and turnCreated from existing threat (created T${existingThreat.turnCreated}).`,
                            'warning'
                        );
                        break;
                    }
                }
            }
        }

        // Assign ID if new
        const id = threat.id || existing?.id || generateThreatId();

        // Set creation turn if new — v1.8: entity-matched threats ALWAYS inherit
        const turnCreated = existing?.turnCreated ?? threat.turnCreated ?? currentTurn;

        // v1.8: Extract and store entity names for future continuity matching
        const entitySourceNames = existing?.entitySourceNames ??
            extractEntityNamesFromDescription(threat.description, knownEntityNames, playerCharacterName);

        // Raw ETA from AI
        let currentEta = threat.turns_until_impact ?? 0;

        // v1.4 + v1.9: Enforce ETA floors on newly created threats (scene-mode-aware)
        if (turnCreated === currentTurn && !existing) {
            const descLower = threat.description.toLowerCase();
            const isFactionThreat =
                descLower.includes('circle') ||
                descLower.includes('guild') ||
                descLower.includes('chapter') ||
                descLower.includes('order') ||
                descLower.includes('house') ||
                descLower.includes('hegemony') ||
                descLower.includes('company') ||
                descLower.includes('faction') ||
                descLower.includes('organization') ||
                // Fallback: any threat with a high initial ETA is likely faction-scale
                currentEta >= 10;

            // v1.9: Scene-mode-aware floors. During COMBAT, threats escalate in
            // seconds (lance charge, arrow volley) — floor of 1. During TENSION,
            // threats are nearby but not yet in action — floor of 2.
            let floor: number;
            if (sceneMode === 'COMBAT') {
                floor = isFactionThreat ? ETA_FLOOR_COMBAT_FACTION : ETA_FLOOR_COMBAT_INDIVIDUAL;
            } else if (sceneMode === 'TENSION') {
                floor = isFactionThreat ? ETA_FLOOR_TENSION_FACTION : ETA_FLOOR_TENSION_INDIVIDUAL;
            } else {
                floor = isFactionThreat ? ETA_FLOOR_FACTION : ETA_FLOOR_INDIVIDUAL_NEUTRAL;
            }

            if (currentEta < floor) {
                log(
                    `[THREAT ETA ENFORCED] "${threat.description.substring(0, 60)}" bumped ETA ${currentEta} → ${floor} (floor for ${isFactionThreat ? 'faction' : 'individual'} threat, scene: ${sceneMode})`,
                    'warning'
                );
                currentEta = floor;
            }
        }

        // v1.7: Enforce ETA countdown for existing threats.
        // If a threat existed last turn, its ETA must decrease by at least 1.
        if (existing && existing.turns_until_impact !== undefined && turnCreated !== currentTurn) {
            const previousEta = existing.turns_until_impact;
            const expectedMaxEta = Math.max(0, previousEta - 1);
            if (currentEta > expectedMaxEta) {
                log(
                    `[THREAT ETA COUNTDOWN ENFORCED] "${threat.description.substring(0, 60)}" — ` +
                    `AI submitted ETA ${currentEta}, previous was ${previousEta}. ` +
                    `Forced to ${expectedMaxEta}.`,
                    'warning'
                );
                currentEta = expectedMaxEta;
            }
        }

        // v1.8 + v1.9: DESCRIPTION LOCK — prevents retcon/info-leak via description rewrites.
        //
        // v1.9 RELAXATION: The original v1.8 lock was too aggressive for messenger/
        // escalation threats where description evolution IS the threat progressing
        // (e.g., "Garek fleeing" → "Garek arrives" → "patrol dispatched"). The lock
        // now considers whether the ETA has been counting down normally:
        //
        // - ETA STALLING (same or higher): LOCK — this is a retcon/info-leak attempt
        // - ETA COUNTING DOWN (decreased by ≥1): ALLOW evolution if similarity ≥ 0.15
        //   (the threat is progressing naturally, not being retconned)
        // - ETA COUNTING DOWN but similarity < 0.15: LOCK + pivot penalty
        //   (complete topic change, not progression)
        let lockedDescription = threat.description; // default: use AI's new desc
        if (existing && turnCreated !== currentTurn) {
            const descSimilarity = jaccardSimilarity(
                significantWords(threat.description),
                significantWords(existing.description)
            );

            const previousEta = existing.turns_until_impact ?? 999;
            const etaDecreased = currentEta < previousEta; // ETA counting down normally

            if (entityMatchUsed) {
                if (etaDecreased && descSimilarity >= 0.15) {
                    // v1.9: ETA is counting down AND descriptions share some DNA.
                    // This is natural progression — allow the evolution.
                    lockedDescription = threat.description;
                    log(
                        `[DESCRIPTION EVOLVED — v1.9] "${threat.description.substring(0, 60)}" ` +
                        `allowed (entity-matched, ETA ${previousEta}→${currentEta}, similarity ${descSimilarity.toFixed(2)} ≥ 0.15)`,
                        'warning'
                    );
                } else {
                    // ETA stalling/resetting OR complete topic change: LOCK
                    lockedDescription = existing.description;
                    log(
                        `[DESCRIPTION LOCKED — v1.9] "${threat.description.substring(0, 60)}" → ` +
                        `keeping existing: "${existing.description.substring(0, 60)}" ` +
                        `(entity-matched, ETA ${previousEta}→${currentEta}, ` +
                        `similarity ${descSimilarity.toFixed(2)}${!etaDecreased ? ', ETA NOT decreasing' : ', similarity < 0.15'})`,
                        'warning'
                    );
                }
            } else if (descSimilarity >= 0.60) {
                // Jaccard-matched continuation with high similarity: allow minor
                // natural evolution of the description (e.g., "patrol spotted smoke"
                // → "patrol is approaching the smoke"). But only if similarity is high
                // enough that no substantial new information was injected.
                lockedDescription = threat.description;
            } else {
                // Shouldn't reach here (existing was found by Jaccard >= 0.60 or entity),
                // but defensive: lock description.
                lockedDescription = existing.description;
            }

            // Plan pivot detection: if the AI tried to substantially rewrite the
            // description (even though we're locking it), apply a reaction delay
            // to the ETA to punish the pivot attempt.
            // v1.9: Only apply pivot penalty when description is LOCKED (not when evolved)
            const descriptionWasLocked = lockedDescription === existing.description;
            const alreadyPenalized = existing.pivotPenaltyApplied === currentTurn ||
                (existing.pivotPenaltyApplied !== undefined &&
                 currentTurn - existing.pivotPenaltyApplied < PIVOT_DELAY_TURNS);

            if (descriptionWasLocked && descSimilarity < PIVOT_JACCARD_THRESHOLD && !alreadyPenalized) {
                const pivotEta = Math.max(currentEta, currentEta + PIVOT_DELAY_TURNS);
                log(
                    `[THREAT PIVOT DETECTED — v1.9] AI attempted: "${threat.description.substring(0, 60)}" — ` +
                    `similarity ${descSimilarity.toFixed(2)} < ${PIVOT_JACCARD_THRESHOLD}. ` +
                    `Description locked + adding ${PIVOT_DELAY_TURNS}-turn reaction delay: ` +
                    `ETA ${currentEta} → ${pivotEta}.`,
                    'warning'
                );
                currentEta = pivotEta;
                (threat as any).pivotPenaltyApplied = currentTurn;
            }
        }

        // Track consecutive turns at ETA ~1
        let consecutiveTurnsAtEtaOne = 0;
        if (currentEta <= 1) {
            consecutiveTurnsAtEtaOne = (existing?.consecutiveTurnsAtEtaOne ?? 0) + 1;
        }
        // Reset counter if ETA climbed back above 1
        if (currentEta > 1) {
            consecutiveTurnsAtEtaOne = 0;
        }

        // Determine status
        let status = threat.status ?? 'building';
        if (currentEta <= 1) status = 'imminent';
        if (currentEta === 0) status = 'triggered';

        // Auto-expire if stuck at ~1 for too long
        if (consecutiveTurnsAtEtaOne >= MAX_CONSECUTIVE_ETA_ONE) {
            log(`[THREAT EXPIRED] "${threat.description.substring(0, 60)}" — stuck at ETA ~1 for ${consecutiveTurnsAtEtaOne} consecutive turns. Auto-expired.`, 'warning');
            status = 'expired';
        }

        return {
            ...threat,
            description: lockedDescription,  // v1.8: Use locked description, not AI's rewrite
            id,
            turnCreated,
            entitySourceNames,
            pivotPenaltyApplied: (threat as any).pivotPenaltyApplied ?? existing?.pivotPenaltyApplied,
            originalEta: existing?.originalEta ?? currentEta,  // v1.9: Track initial ETA at creation
            consecutiveTurnsAtEtaOne,
            turns_until_impact: currentEta,
            status,
        };
    });

    // v1.6 + v1.9: Origin Gate — filter out causally invalid NEW threats before expiry/cap.
    // validateThreatCausality() auto-passes any threat with turnCreated < currentTurn,
    // so this only ever blocks seeds being proposed for the first time this turn.
    //
    // v1.9: During COMBAT, Origin Gate is BYPASSED entirely. The gate's purpose is
    // to prevent phantom distant threats — but during active combat, threats come from
    // entities physically present in the scene (archers shooting, cavalry charging,
    // environmental hazards). Requiring a dormant hook or observer for "the lance is
    // about to hit you" is nonsensical. ETA floors (now scene-aware) handle timing.
    const causallyValid = sceneMode === 'COMBAT'
        ? processed
        : processed.filter(threat =>
            validateThreatCausality(threat, dormantHooks, factionExposure, currentTurn, debugLogs, knownEntityNames, playerCharacterName)
        );

    // Step 2: Filter out expired seeds (operates on gate-passed threats only)
    const active = causallyValid.filter(t => t.status !== 'expired' && t.status !== 'triggered');

    // Step 3: Enforce cap of THREAT_SEED_CAP simultaneous seeds
    if (active.length > THREAT_SEED_CAP) {
        log(`[THREAT CAP] ${active.length} seeds (after origin gate) — cap is ${THREAT_SEED_CAP}. Oldest seeds trimmed.`, 'warning');
        // Sort by creation turn ascending (oldest first) and trim from the front
        active.sort((a, b) => (a.turnCreated ?? 0) - (b.turnCreated ?? 0));
        active.splice(0, active.length - THREAT_SEED_CAP);
    }

    return active;
};

// ---------------------------------------------------------------------------
// Pipeline Orchestrator
// ---------------------------------------------------------------------------

export const SimulationEngine = {
    processTurn: (
        response: ModelResponseSchema,
        currentWorld: GameWorld,
        character: Character,
        currentTurn: number,
        playerRemovedConditions: string[] = []
    ): SimulationResult => {
        const debugLogs: DebugLogEntry[] = [];

        // ===================================================================
        // 0. v1.3: Full-response field sanitisation
        //    Replaces the old validateResponse() call which only scanned narrative.
        //    All string fields — conditions, memory, lore, NPC names — are now
        //    scanned and sanitised before any state is written.
        //    v1.4: Also filters out lore with [RENAME:X] markers and entity updates
        //    with unresolved names before they reach state.
        //    v1.7: Uses nameMap for immediate resolution.
        // ===================================================================
        const nameMap = { ...currentWorld.bannedNameMap };
        const { sanitisedResponse: response_sanitised, allViolations } = sanitiseAllFields(response, nameMap);
        const r = response_sanitised; // Use sanitised copy for all subsequent processing

        if (allViolations.length > 0) {
            debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[⚠ BANNED NAME VIOLATION] AI used forbidden name(s): ${allViolations.join(', ')} — all fields sanitised`,
                type: 'warning'
            });
        }

        // ===================================================================
        // 1. Time Pipeline
        // ===================================================================
        const hasSleep = (r.biological_inputs?.sleep_hours ?? 0) > 0;
        const isCombat = r.scene_mode === 'COMBAT';
        const { delta, log: timeLog } = calculateTimeDelta(r.time_passed_minutes, hasSleep, isCombat);

        if (timeLog) {
            debugLogs.push({ timestamp: new Date().toISOString(), message: timeLog, type: 'info' });
        }

        const newTime = updateTime(currentWorld.time?.totalMinutes ?? 0, delta);

        if (delta > 0) {
            debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `Time Advancement: +${delta}m -> ${newTime.display}`,
                type: 'info'
            });
        } else {
            debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[BIO] No time passed.`,
                type: 'info'
            });
        }

        // ===================================================================
        // 2. Bio Pipeline
        // ===================================================================
        const tensionLevel = r.tension_level ?? currentWorld.tensionLevel ?? 10;

        const bioResult = BioEngine.tick(
            character,
            delta,
            tensionLevel,
            r.biological_inputs,
            playerRemovedConditions,
            r.scene_mode ?? 'NARRATIVE' // v1.3: pass scene mode for accelerated decay
        );

        bioResult.logs.forEach(log => {
            debugLogs.push({ timestamp: new Date().toISOString(), message: `[BIO] ${log}`, type: 'info' });
        });

        // ===================================================================
        // 3. Reproduction Pipeline
        // ===================================================================
        let currentPregnancies = [...(currentWorld.pregnancies ?? [])];
        if (r.biological_event && delta > 0) {
            const conceptionRoll = Math.random();
            if (conceptionRoll < 0.3) {
                debugLogs.push({ timestamp: new Date().toISOString(), message: `[CONCEPTION] Biological event triggered. Roll: ${conceptionRoll.toFixed(3)} — Conception occurred.`, type: 'warning' });
            } else {
                debugLogs.push({ timestamp: new Date().toISOString(), message: `[CONCEPTION] Biological event triggered. Roll: ${conceptionRoll.toFixed(3)} — Conception failed (RNG).`, type: 'info' });
            }
        }

        // ===================================================================
        // 4. Thought Process Log
        // ===================================================================
        if (r.thought_process) {
            debugLogs.unshift({ timestamp: new Date().toISOString(), message: `[AI THOUGHT]: ${r.thought_process}`, type: 'info' });
        }

        // ===================================================================
        // 5. Context Pipeline (Combat & Threats)
        // ===================================================================
        let nextThreats = currentWorld.activeThreats;
        let nextEnv = currentWorld.environment;

        if (r.combat_context) {
            nextThreats = r.combat_context.active_threats;
            nextEnv = r.combat_context.environment;
        } else if (r.scene_mode === 'SOCIAL' || r.scene_mode === 'NARRATIVE') {
            nextThreats = [];
        }

        // ===================================================================
        // 6. Entity Pipeline — v1.8: Enhanced dedup with fuzzy name matching
        // ===================================================================
        // Collect banned-name replacement values so we know which names might be
        // artificial collisions (two different NPCs renamed to the same name).
        const bannedReplacementNames = new Set(
            Object.values(nameMap).map(v => v.toLowerCase())
        );
        let updatedKnownEntities = [...(currentWorld.knownEntities || [])];
        if (r.known_entity_updates) {
            for (const update of r.known_entity_updates) {
                // v1.8: Multi-strategy dedup:
                // 1. Exact ID match
                // 2. Exact name match
                // 3. First-name fuzzy match (catches "Halloway" vs "Magistrate Clerk Halloway")
                let existingIdx = updatedKnownEntities.findIndex(e => e.id === update.id);

                if (existingIdx < 0) {
                    existingIdx = updatedKnownEntities.findIndex(e => e.name === update.name);
                }

                if (existingIdx < 0) {
                    // Fuzzy first-name match: extract significant name words and check overlap
                    const updateNameParts = update.name
                        .replace(/\([^)]*\)/g, '')  // Remove parentheticals
                        .split(/\s+/)
                        .map(p => p.toLowerCase().trim())
                        .filter(p => p.length >= 3 && !ENTITY_EXTRACTION_BLACKLIST.has(p));

                    if (updateNameParts.length > 0) {
                        existingIdx = updatedKnownEntities.findIndex(e => {
                            const existingParts = e.name
                                .replace(/\([^)]*\)/g, '')
                                .split(/\s+/)
                                .map(p => p.toLowerCase().trim())
                                .filter(p => p.length >= 3 && !ENTITY_EXTRACTION_BLACKLIST.has(p));

                            const nameMatch = existingParts.some(ep => updateNameParts.includes(ep));
                            if (!nameMatch) return false;

                            // Find the shared name part(s)
                            const matchedParts = existingParts.filter(ep => updateNameParts.includes(ep));

                            // v1.8: Role similarity guard — ONLY applies when the shared name
                            // is a banned-name replacement value (e.g., "Tegwen" from the map
                            // {"Kaelen": "Tegwen"}). For organic names (like "Halloway"),
                            // merge freely — it's the same person with different role labels.
                            const isBannedNameCollision = matchedParts.some(p => bannedReplacementNames.has(p));

                            if (isBannedNameCollision) {
                                const updateRole = (update.role ?? '').toLowerCase();
                                const existingRole = (e.role ?? '').toLowerCase();
                                const roleWords = (role: string) => new Set(
                                    role.split(/[\s/,()]+/).filter(w => w.length >= 3)
                                );
                                const updateRoleWords = roleWords(updateRole);
                                const existingRoleWords = roleWords(existingRole);
                                const sharedRoleWords = [...updateRoleWords].filter(w => existingRoleWords.has(w));

                                // If roles share zero words AND both have meaningful roles,
                                // these are likely different characters with the same banned-name replacement.
                                if (updateRoleWords.size >= 1 && existingRoleWords.size >= 1 && sharedRoleWords.length === 0) {
                                    return false; // Don't merge — different characters
                                }
                            }

                            return true;
                        });

                        if (existingIdx >= 0) {
                            debugLogs.push({
                                timestamp: new Date().toISOString(),
                                message: `[ENTITY DEDUP — v1.8 FUZZY MATCH] "${update.name}" (${update.id}) matched existing "${updatedKnownEntities[existingIdx].name}" (${updatedKnownEntities[existingIdx].id}) via first-name overlap. Updating in place.`,
                                type: 'warning'
                            });
                        }
                    }
                }

                if (existingIdx >= 0) {
                    // Merge: keep the newer data but preserve the existing ID if it's older
                    // (prevents ID fragmentation)
                    const existingEntity = updatedKnownEntities[existingIdx];
                    updatedKnownEntities[existingIdx] = {
                        ...update,
                        id: existingEntity.id,  // Preserve canonical ID
                    };
                } else {
                    updatedKnownEntities.push(update);
                }
            }
        }

        // v1.8: Post-processing dedup pass — catch any pre-existing duplicates
        // that slipped in before this fix was deployed.
        {
            const seen = new Map<string, number>(); // lowercase first-name → index
            const toRemove: number[] = [];
            for (let i = 0; i < updatedKnownEntities.length; i++) {
                const entity = updatedKnownEntities[i];
                const nameParts = entity.name
                    .replace(/\([^)]*\)/g, '')
                    .split(/\s+/)
                    .map(p => p.toLowerCase().trim())
                    .filter(p => p.length >= 3 && !ENTITY_EXTRACTION_BLACKLIST.has(p));

                let isDuplicate = false;
                for (const part of nameParts) {
                    if (seen.has(part)) {
                        const existingIdx = seen.get(part)!;
                        const existingEntity = updatedKnownEntities[existingIdx];

                        // Role similarity guard: ONLY apply for banned-name replacements.
                        // For organic names (like "Halloway"), merge freely — same person.
                        const isBannedCollision = bannedReplacementNames.has(part);
                        if (isBannedCollision) {
                            const roleWords = (role: string) => new Set(
                                (role ?? '').toLowerCase().split(/[\s/,()]+/).filter(w => w.length >= 3)
                            );
                            const entityRoleWords = roleWords(entity.role);
                            const existingRoleWords = roleWords(existingEntity.role);
                            const sharedRoleWords = [...entityRoleWords].filter(w => existingRoleWords.has(w));

                            if (entityRoleWords.size >= 1 && existingRoleWords.size >= 1 && sharedRoleWords.length === 0) {
                                // Different roles + banned-name collision → different characters
                                continue;
                            }
                        }

                        // Same or similar roles — genuine duplicate. Keep the more detailed one.
                        const existingLen = (existingEntity.impression ?? '').length;
                        const currentLen = (entity.impression ?? '').length;
                        if (currentLen > existingLen) {
                            toRemove.push(existingIdx);
                            seen.set(part, i);
                        } else {
                            toRemove.push(i);
                        }
                        isDuplicate = true;
                        debugLogs.push({
                            timestamp: new Date().toISOString(),
                            message: `[ENTITY DEDUP — v1.8 POST-PROCESS] Duplicate detected: "${entity.name}" shares name part "${part}" with "${existingEntity.name}". Keeping more detailed entry.`,
                            type: 'warning'
                        });
                        break;
                    }
                }
                if (!isDuplicate) {
                    for (const part of nameParts) {
                        seen.set(part, i);
                    }
                }
            }
            if (toRemove.length > 0) {
                const removeSet = new Set(toRemove);
                updatedKnownEntities = updatedKnownEntities.filter((_, i) => !removeSet.has(i));
            }
        }

        // ===================================================================
        // 7. Lore & Memory Pipeline
        // ===================================================================

        // --- Lore ---
        // v1.4: Semantic duplicate check before queuing. Near-duplicates (Jaccard ≥ 0.60)
        // are suppressed. Semantic expansions (new entry ≥25% longer) are marked for
        // the approval modal so the user can choose to replace the old entry.
const pendingLore: LoreItem[] = [];

        if (r.new_lore) {
            const { keyword, content } = r.new_lore;

            // FIX 7: Exact-keyword check runs BEFORE semantic Jaccard check.
            // Two entries with the same keyword are always a conflict regardless of
            // content similarity — catches contradictory entries like duplicate
            // "Tharnic Ledger Secrets" that slip past the similarity threshold.
            const exactMatch = findExistingLore(keyword, currentWorld.lore);

            if (exactMatch) {
                const isLonger = content.length > exactMatch.content.length;
                debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: `[LORE-EXACT-DUPLICATE] Keyword "${keyword}" already exists in canonical lore. ${isLonger ? 'Content is longer — flagging as expansion candidate.' : 'Content is shorter/equal — suppressing.'}`,
                    type: 'warning'
                });

                if (isLonger) {
                    const expansionItem: LoreItem = {
                        id: generateLoreId(),
                        keyword,
                        content,
                        timestamp: new Date().toISOString(),
                    };
                    (expansionItem as any).semanticUpdateOf = exactMatch.id;
                    pendingLore.push(expansionItem);
                }
                // Shorter or equal — suppress entirely, no push.

            } else {
                // No exact keyword match — run semantic Jaccard dedup.
                const { isDuplicate, isUpdate, existingIndex } = checkLoreDuplicate(
                    keyword,
                    content,
                    currentWorld.lore
                );

                if (isDuplicate) {
                    debugLogs.push({
                        timestamp: new Date().toISOString(),
                        message: `[LORE SEMANTIC DUPE] "${keyword}" is too similar to existing entry "${currentWorld.lore[existingIndex]?.keyword}" (Jaccard ≥ threshold) — suppressed.`,
                        type: 'warning'
                    });
                } else {
                    const newItem: LoreItem = {
                        id: generateLoreId(),
                        keyword,
                        content,
                        timestamp: new Date().toISOString()
                    };

                    if (isUpdate) {
                        (newItem as any).semanticUpdateOf = currentWorld.lore[existingIndex]?.id;
                    }

                    pendingLore.push(newItem);

                    debugLogs.push({
                        timestamp: new Date().toISOString(),
                        message: `[LORE] Pending: "${keyword}"${isUpdate ? ' (semantic update of existing entry)' : ''}`,
                        type: 'info'
                    });
                }
            } // end else (no exact keyword match)
        } // end if (r.new_lore)

        // --- Memory (with semantic deduplication and hard cap) ---
        let finalMemory = [...currentWorld.memory];

        if (r.new_memory) {
            // FIX 5: Diagnostic log — confirms the memory pipeline is reached.
            // If this log never appears in the debug panel, the AI is not providing
            // new_memory in its responses, not a write path bug.
            debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[MEMORY-WRITE-ATTEMPT] AI provided new_memory: "${r.new_memory.fact?.substring(0, 80) ?? '(empty fact)'}"`,
                type: 'info'
            });

            // v1.3: Hard cap — refuse new engrams when at MEMORY_CAP
            if (finalMemory.length >= MEMORY_CAP) {
                debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: `[MEMORY] Cap reached (${MEMORY_CAP}) — consolidation required before new engrams can be written. Fragment suppressed: "${r.new_memory.fact.substring(0, 60)}"`,
                    type: 'warning'
                });
            } else {
                const { isDuplicate, isUpdate, existingIndex } = checkMemoryDuplicate(
                    r.new_memory.fact,
                    currentWorld.memory
                );

                if (isDuplicate) {
                    debugLogs.push({
                        timestamp: new Date().toISOString(),
                        message: `[MEMORY] Duplicate fragment suppressed (matches fragment #${existingIndex}): "${r.new_memory.fact.substring(0, 80)}"`,
                        type: 'info'
                    });
                } else if (isUpdate) {
                    const updated = [...currentWorld.memory];
                    updated[existingIndex] = {
                        id: updated[existingIndex].id,
                        fact: r.new_memory.fact,
                        timestamp: new Date().toISOString()
                    };
                    finalMemory = updated;
                    debugLogs.push({
                        timestamp: new Date().toISOString(),
                        message: `[MEMORY] Fragment updated (supersedes #${existingIndex}): "${r.new_memory.fact.substring(0, 80)}"`,
                        type: 'success'
                    });
                } else {
                    finalMemory = [...currentWorld.memory, {
                        id: generateMemoryId(),
                        fact: r.new_memory.fact,
                        timestamp: new Date().toISOString()
                    }];
                    debugLogs.push({
                        timestamp: new Date().toISOString(),
                        message: `[MEMORY] Engram Created: "${r.new_memory.fact.substring(0, 80)}"`,
                        type: 'success'
                    });
                }
            }
        }

        // ===================================================================
        // 8. Hidden Registry
        // ===================================================================
        let newHiddenRegistry = currentWorld.hiddenRegistry || '';

        // v1.9 + v1.10: Compute scene mode early so all downstream validators can use it.
        // v1.10: getEffectiveSceneMode() detects de facto combat from NPC actions.
        // If the AI labels the scene TENSION but NPCs are shooting arrows and charging
        // cavalry, the effective mode is upgraded to COMBAT. This ensures Origin Gate
        // bypass and reduced ETA floors apply during actual combat.
        const statedSceneMode = r.scene_mode ?? currentWorld.sceneMode ?? 'NARRATIVE';
        const currentSceneMode = getEffectiveSceneMode(
            statedSceneMode,
            r.world_tick?.npc_actions ?? [],
            debugLogs
        );

        // v1.8: Validate hidden_update against threat ETAs before writing.
        // This closes the bypass where the AI uses hidden_update to narrate
        // threat entities as locally present despite their ETA being > 3.
        if (r.hidden_update) {
            const existingEmergingForHiddenCheck =
                ((currentWorld as any).emergingThreats as WorldTickEvent[]) ?? [];
            const validatedHiddenUpdate = validateHiddenUpdateCoherence(
                r.hidden_update,
                existingEmergingForHiddenCheck,
                debugLogs,
                character.name,
                currentSceneMode  // v1.9
            );
            if (validatedHiddenUpdate.trim().length > 0) {
                newHiddenRegistry += `\n[${newTime.display}] ${validatedHiddenUpdate}`;
            }
        }

        // ===================================================================
        // 9. World Tick Pipeline
        // ===================================================================

        // FIX 9: World tick mandatory validation.
        // An empty or absent world_tick.npc_actions violates the WORLD TICK IS MANDATORY rule.
        // Log it as an error so it surfaces clearly in the debug panel.
        if (!r.world_tick?.npc_actions || r.world_tick.npc_actions.length === 0) {
            debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[WORLD-TICK-VIOLATION] AI response has no world_tick.npc_actions. WORLD TICK IS MANDATORY. The WORLD_PULSE reminder should be firing to correct this.`,
                type: 'error'
            });
            // Ensure world_tick has a valid structure so downstream processing doesn't throw.
            if (!r.world_tick) {
                (r as any).world_tick = { npc_actions: [], environment_changes: [], emerging_threats: [] };
            }
        }

        let lastWorldTickTurn = currentWorld.lastWorldTickTurn ?? 0;

        if (r.world_tick) {
            const hasActivity =
                (r.world_tick.npc_actions && r.world_tick.npc_actions.length > 0) ||
                (r.world_tick.environment_changes && r.world_tick.environment_changes.length > 0) ||
                (r.world_tick.emerging_threats && r.world_tick.emerging_threats.length > 0);

            if (hasActivity) lastWorldTickTurn = currentTurn;

            // v1.7 + v1.9: Validate NPC actions against emerging threat ETAs before logging.
            // This prevents the AI from using npc_actions to teleport distant threats.
            // v1.9: Scene-mode awareness — COMBAT skips coherence entirely.
            const existingEmergingForCoherence =
                ((currentWorld as any).emergingThreats as WorldTickEvent[]) ?? [];
            const validatedNpcActions = validateNpcActionCoherence(
                r.world_tick.npc_actions,
                existingEmergingForCoherence,
                currentTurn,
                debugLogs,
                currentSceneMode  // v1.9
            );
            // Overwrite so downstream processing (exposure scoring, etc.) uses validated set
            r.world_tick.npc_actions = validatedNpcActions;

            const hiddenActions = validatedNpcActions.filter(a => !a.player_visible);
            for (const action of hiddenActions) {
                newHiddenRegistry += `\n[${newTime.display}] [WORLD-TICK] ${action.npc_name}: ${action.action}`;
            }

            const visibleActions = validatedNpcActions.filter(a => a.player_visible);
            for (const action of visibleActions) {
                debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: `[WORLD] ${action.npc_name}: ${action.action}`,
                    type: 'info'
                });
            }
            if (hiddenActions.length > 0) {
                debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: `[WORLD] ${hiddenActions.length} hidden NPC action(s) logged to registry.`,
                    type: 'info'
                });
            }

            for (const change of r.world_tick.environment_changes) {
                debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: `[ENV] ${change}`,
                    type: 'info'
                });
            }

            // v1.10: Allied NPC passivity detection — flag when bonded/companion NPCs
            // are passive while hostile combat actions are occurring.
            const passiveAllies = detectAlliedPassivity(
                validatedNpcActions,
                (currentWorld.knownEntities ?? []).map(e => ({
                    name: e.name,
                    role: e.role,
                    relationship_level: e.relationship_level
                })),
                debugLogs
            );
            // Store for sectionReminders to fire the ALLIED_PROACTIVITY reminder
            if (passiveAllies.length > 0) {
                (currentWorld as any).__passiveAllies = passiveAllies;
            }

            // v1.6: Exposure scoring runs before threat validation so same-turn exposure counts
            const updatedExposure = updateFactionExposure(
                ((currentWorld as any).factionExposure as FactionExposure) ?? {},
                r.world_tick.npc_actions,
                currentTurn,
                debugLogs
            );
            (currentWorld as any).factionExposure = updatedExposure;

            // v1.6 / v1.4 / v1.8 / v1.9: Threat seed state machine with Origin Gate + ETA floors + entity continuity + scene awareness
            const knownEntityNames = (currentWorld.knownEntities ?? []).map(e => e.name);
            const processedThreats = processThreatSeeds(
                r.world_tick.emerging_threats,
                ((currentWorld as any).emergingThreats as WorldTickEvent[]) ?? [],
                currentTurn,
                debugLogs,
                ((currentWorld as any).dormantHooks as DormantHook[]) ?? [],
                updatedExposure,
                knownEntityNames,
                character.name,
                currentSceneMode  // v1.9
            );

            // v1.6: Activate dormant hooks referenced by processed threats
            let currentHooks: DormantHook[] = ((currentWorld as any).dormantHooks as DormantHook[]) ?? [];
            for (const threat of processedThreats) {
                if (threat.dormantHookId) {
                    currentHooks = currentHooks.map(h =>
                        h.id === threat.dormantHookId && h.status === 'dormant'
                            ? { ...h, status: 'activated' as const, activatedTurn: currentTurn }
                            : h
                    );
                    debugLogs.push({
                        timestamp: new Date().toISOString(),
                        message: `[DORMANT HOOK] "${threat.dormantHookId}" activated on turn ${currentTurn}`,
                        type: 'info'
                    });
                }
            }
            (currentWorld as any).dormantHooks = currentHooks;

            // v1.7: Only write NEW threats to hidden registry. Existing threats
            // get a single consolidated status line. This prevents the feedback
            // loop where 30+ [EMERGING] entries cause the AI to escalate faster.
            const brandNewThreats = processedThreats.filter(
                t => t.turnCreated === currentTurn
            );
            const continuingThreats = processedThreats.filter(
                t => t.turnCreated !== currentTurn
            );

            for (const threat of brandNewThreats) {
                const eta = threat.turns_until_impact !== undefined
                    ? ` (ETA: ~${threat.turns_until_impact} turns)`
                    : '';
                newHiddenRegistry += `\n[${newTime.display}] [NEW THREAT] ${threat.description}${eta}`;
                debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: `[NEW THREAT SEED] ${threat.description}${eta}`,
                    type: 'warning'
                });
            }

            // Single consolidated line for continuing threats — no per-threat spam
            if (continuingThreats.length > 0) {
                const statusSummaries = continuingThreats.map(t => {
                    const desc = t.description.substring(0, 60);
                    return `"${desc}…" ETA:${t.turns_until_impact ?? '?'} [${t.status}]`;
                });
                newHiddenRegistry += `\n[${newTime.display}] [THREAT STATUS] ${statusSummaries.join(' | ')}`;
            }

            // Always log all threats to debug panel for developer visibility
            for (const threat of processedThreats) {
                debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: `[THREAT SEED] ${threat.description.substring(0, 80)} ` +
                        `(ETA: ~${threat.turns_until_impact}, status: ${threat.status}, ` +
                        `created: T${threat.turnCreated})`,
                    type: 'warning'
                });
            }

            // Store processed threats back on the world
            (currentWorld as any).__processedEmergingThreats = processedThreats;
        }

        // ===================================================================
        // 10. Final State Assembly
        // ===================================================================

        // --- Condition Pipeline ---
        let finalConditions = [...character.conditions];
        if (bioResult.removedConditions.length > 0) {
            finalConditions = finalConditions.filter(c => !bioResult.removedConditions.includes(c));
            bioResult.removedConditions.forEach(c => debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[BIO-RECOVERY] Condition Cleared: ${c}`,
                type: 'success'
            }));
        }

        // v1.5: Hard Condition Cap
        const MAX_CONDITIONS = 40;
        if (finalConditions.length >= MAX_CONDITIONS && bioResult.addedConditions.length > 0) {
            debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[CONDITION CAP] ${finalConditions.length}/${MAX_CONDITIONS} — new conditions BLOCKED until pruning occurs.`,
                type: 'warning'
            });
            // Skip addedConditions entirely this turn
        } else {
            // v1.5: Semantic Deduplication for Added Conditions
            bioResult.addedConditions.forEach(c => {
                // Exact match check
                if (finalConditions.includes(c)) return;

                // Semantic match check
                const { isDuplicate, existingIndex } = checkConditionDuplicate(c, finalConditions);
                if (isDuplicate) {
                    debugLogs.push({
                        timestamp: new Date().toISOString(),
                        message: `[CONDITION DUPE] "${c}" suppressed (matches "${finalConditions[existingIndex]}")`,
                        type: 'info'
                    });
                } else {
                    finalConditions.push(c);
                }
            });
        }

        // --- Timed Condition Expiry ---
        const updatedTimestamps: Record<string, number> = { ...(character.conditionTimestamps ?? {}) };
        for (const c of bioResult.addedConditions) {
            if (!(c in updatedTimestamps)) updatedTimestamps[c] = newTime.totalMinutes;
        }
        for (const c of finalConditions) {
            if (!(c in updatedTimestamps)) updatedTimestamps[c] = newTime.totalMinutes;
        }
        const expiredConditions = findExpiredConditions(finalConditions, updatedTimestamps, newTime.totalMinutes);
        if (expiredConditions.length > 0) {
            finalConditions = finalConditions.filter(c => !expiredConditions.includes(c));
            expiredConditions.forEach(c => {
                delete updatedTimestamps[c];
                debugLogs.push({ timestamp: new Date().toISOString(), message: `[TIMED-EXPIRY] Condition Elapsed: ${c}`, type: 'success' });
            });
        }
        for (const key of Object.keys(updatedTimestamps)) {
            if (!finalConditions.includes(key)) delete updatedTimestamps[key];
        }

        // --- Bio Modifier Passive Decay ---
        // v1.3: accelerated flag is now handled inside BioEngine.tick() via sceneMode.
        // decayBioModifiers here handles any residual modifiers not caught by the engine.
        const decayedModifiers = decayBioModifiers(bioResult.bio.modifiers);
        const modifiersChanged = JSON.stringify(decayedModifiers) !== JSON.stringify(bioResult.bio.modifiers);
        if (modifiersChanged) {
            debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[BIO-DECAY] Modifiers decaying toward baseline: cal×${decayedModifiers.calories.toFixed(2)} hyd×${decayedModifiers.hydration.toFixed(2)} sta×${decayedModifiers.stamina.toFixed(2)}`,
                type: 'info'
            });
        }

        const finalTrauma = Math.min(100, Math.max(0, (character.trauma || 0) + bioResult.traumaDelta));

        // FIX 4: Use post-processing emerging threats. The __processedEmergingThreats
        // property is only set during section 9 if the AI provided world_tick data.
        // Fall back to currentWorld.emergingThreats (the saved state from the prior turn)
        // so the check is never undefined when world_tick is empty.
        const finalEmergingThreats: WorldTickEvent[] =
            (currentWorld as any).__processedEmergingThreats
            ?? (currentWorld as any).emergingThreats
            ?? [];

        // v1.10: Use effective scene mode for persistence. If de facto combat was
        // detected, persist COMBAT so the AI sees it in context next turn.
        let finalSceneMode: SceneMode = (currentSceneMode as SceneMode) || 'NARRATIVE';
        let finalTensionLevel = tensionLevel;

        const noThreatsRemain = nextThreats.length === 0 && finalEmergingThreats.length === 0;
        if (noThreatsRemain && (finalSceneMode === 'COMBAT' || finalSceneMode === 'TENSION')) {
            finalSceneMode = 'NARRATIVE';
            finalTensionLevel = Math.max(0, tensionLevel - 30);
            debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[SCENE] Auto-transition: ${r.scene_mode} → NARRATIVE (no remaining threats). activeThreats=${nextThreats.length}, emergingThreats=${finalEmergingThreats.length}. Tension: ${tensionLevel} → ${finalTensionLevel}`,
                type: 'success'
            });
        }

        // ===================================================================
        // 12. v1.3 / v1.5: Devil's Bargain tracking
        //     Update lastBargainTurn when the AI provides a bargain_request.
        //     v1.5 FIX 2: Use r.bargain_request?.offer (non-empty string) as the
        //     detection signal rather than truthy object check. The AI sometimes
        //     returns an empty bargain_request object without populating .offer,
        //     which was resetting the clock without actually offering a bargain.
        //     Also added a warning log when the clock is overdue and no bargain
        //     was provided, for visibility in the debug panel.
        // ===================================================================
        const bargainProvided = !!(r.bargain_request?.description?.trim());
        const lastBargainTurn = bargainProvided
            ? currentTurn + 1  // currentTurn is the turn being processed
            : (currentWorld.lastBargainTurn ?? 0);

        if (bargainProvided) {
            debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[BARGAIN-ACCEPTED] Devil's Bargain offered this turn. lastBargainTurn → ${lastBargainTurn}. Description: "${r.bargain_request!.description.substring(0, 80)}"`,
                type: 'info'
            });
        }

        // FIX 2: Warn when clock is overdue and no bargain was provided this turn.
        const turnsSinceLastBargain = currentTurn - (currentWorld.lastBargainTurn ?? 0);
        if (turnsSinceLastBargain >= 25 && !bargainProvided) {
            debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[BARGAIN-OVERDUE] Clock at ${turnsSinceLastBargain} turns since last offer (threshold: 25). AI did not include bargain_request.offer this turn. BARGAIN_CHECK reminder should be firing.`,
                type: 'warning'
            });
        }

        // ===================================================================
        // 13. v1.3: turnCount increment
        //     The authoritative turn counter lives on GameWorld and increments
        //     every time processTurn completes successfully.
        // ===================================================================
        const newTurnCount = (currentWorld.turnCount ?? 0) + 1;

        debugLogs.push({
            timestamp: new Date().toISOString(),
            message: `Turn ${newTurnCount} complete.`,
            type: 'info'
        });

        // v1.5: Staleness Warnings
        if (newTurnCount > 15 && newTurnCount % 10 === 0) {
            if (!currentWorld.factionIntelligence || Object.keys(currentWorld.factionIntelligence).length === 0) {
                debugLogs.push({ timestamp: new Date().toISOString(), message: '[FACTION INTEL] factionIntelligence is empty after turn 15 — AI is not tracking faction awareness.', type: 'warning' });
            }
            if (!currentWorld.legalStatus?.knownClaims?.length && !currentWorld.legalStatus?.playerDocuments?.length) {
                debugLogs.push({ timestamp: new Date().toISOString(), message: '[LEGAL STATUS] legalStatus is empty — AI is not recording claims or documents.', type: 'warning' });
            }
        }

        // FIX 6: Entity density violation — log as 'error' so it stands out in the debug panel.
        // Mirrors the ENTITY_DENSITY_REQUIREMENTS table in sectionReminders.ts.
        const entityDensityRequirements: [number, number][] = [[10, 5], [30, 10], [60, 15]];
        const currentEntityCount = updatedKnownEntities.length;
        for (const [turnThreshold, entityMin] of entityDensityRequirements) {
            if (newTurnCount >= turnThreshold && currentEntityCount < entityMin) {
                debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: `[ENTITY-DENSITY-VIOLATION] Turn ${newTurnCount}: ${currentEntityCount}/${entityMin} required entities (threshold at turn ${turnThreshold}). Obligation has been unmet since turn ${turnThreshold}.`,
                    type: 'error'
                });
            }
        }

        // ===================================================================
        // Return assembled state
        // ===================================================================
        return {
            worldUpdate: {
                ...currentWorld,
                time: newTime,
                lore: currentWorld.lore,
                memory: finalMemory,
                hiddenRegistry: resolveAllBannedNames(trimHiddenRegistry(newHiddenRegistry), nameMap),
                pregnancies: currentPregnancies,
                activeThreats: nextThreats,
                environment: nextEnv,
                knownEntities: updatedKnownEntities,
                sceneMode: finalSceneMode,
                tensionLevel: finalTensionLevel,
                lastWorldTickTurn,
                // v1.3 fields
                turnCount: newTurnCount,
                lastBargainTurn,
                factionIntelligence: currentWorld.factionIntelligence ?? {},
                legalStatus: currentWorld.legalStatus ?? { knownClaims: [], playerDocuments: [] },
                // v1.6 fields
                dormantHooks: ((currentWorld as any).dormantHooks as DormantHook[]) ?? [],
                factionExposure: ((currentWorld as any).factionExposure as FactionExposure) ?? {},
                bannedNameMap: nameMap,
                emergingThreats: finalEmergingThreats,
                // v1.10: Flag for sectionReminders to fire allied proactivity every turn
                passiveAlliesDetected: ((currentWorld as any).__passiveAllies ?? []).length > 0,
            } as GameWorld & { emergingThreats: WorldTickEvent[] },
            characterUpdate: {
                ...character,
                bio: {
                    ...bioResult.bio,
                    modifiers: decayedModifiers,
                },
                conditions: finalConditions,
                conditionTimestamps: updatedTimestamps,
                trauma: finalTrauma
            },
            debugLogs,
            pendingLore
        };
    }
};