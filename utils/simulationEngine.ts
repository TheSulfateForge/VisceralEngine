/**
 * simulationEngine.ts — v1.6
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

// v1.8: Anti-replacement-loop and plan-pivot constants
const PIVOT_DELAY_TURNS = 2;             // Extra turns added when AI rewrites a threat's plan
const ENTITY_NAME_MATCH_THRESHOLD = 1;   // Minimum shared entity names to consider continuity
const PIVOT_JACCARD_THRESHOLD = 0.35;    // Below this = plan pivot detected (description changed too much)

// ---------------------------------------------------------------------------
// v1.8: Entity Name Extraction — prevents the AI from replacing threats by
// rewriting descriptions until Jaccard similarity drops below 0.60
// ---------------------------------------------------------------------------

/**
 * Extracts probable entity/NPC names from a threat description.
 * Uses capitalized multi-word sequences and known entity names.
 * Returns lowercase names for matching.
 */
const extractEntityNamesFromDescription = (
    description: string,
    knownEntityNames: string[] = []
): string[] => {
    const names: Set<string> = new Set();

    // Match capitalized proper nouns (2+ chars, not sentence starters after periods)
    // This catches "Kavar", "Zhentarim", "Black Network", etc.
    const properNouns = description.match(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*/g);
    if (properNouns) {
        for (const noun of properNouns) {
            names.add(noun.toLowerCase());
        }
    }

    // Also check against known entity names (case-insensitive substring match)
    const descLower = description.toLowerCase();
    for (const entityName of knownEntityNames) {
        // Extract the primary name (before parenthetical like "Kavar (Zhentarim)")
        const primary = entityName.split('(')[0].trim().toLowerCase();
        if (primary.length >= 3 && descLower.includes(primary)) {
            names.add(primary);
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
    knownEntityNames: string[] = []    // v1.8: for validating observer entities
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
        // (e.g., "Camilla cast a loud spell on an open road" — the action itself is the cause)
        // These must use language indicating the action was publicly observable.
        const selfEvidentPatterns = [
            /player|camilla|character/i,     // Names the player
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
 * an emerging threat whose ETA is still > 3, and blocks those actions.
 */
const validateNpcActionCoherence = (
    npcActions: WorldTickAction[],
    emergingThreats: WorldTickEvent[],
    currentTurn: number,
    debugLogs: DebugLogEntry[]
): WorldTickAction[] => {
    const log = (msg: string, type: DebugLogEntry['type'] = 'warning') => {
        debugLogs.push({ timestamp: new Date().toISOString(), message: msg, type });
    };

    // Build significant keywords from threats with ETA > 3
    const distantThreatTerms: Map<string, number> = new Map();
    for (const threat of emergingThreats) {
        const eta = threat.turns_until_impact ?? 0;
        if (eta <= 3) continue; // Imminent threats can appear in NPC actions

        const words = threat.description.toLowerCase()
            .split(/[\s,.:;!?()"']+/)
            .filter(w => w.length > 4);
        for (const word of words) {
            const existing = distantThreatTerms.get(word) ?? 0;
            if (eta > existing) distantThreatTerms.set(word, eta);
        }
    }

    if (distantThreatTerms.size === 0) return npcActions; // No distant threats — skip validation

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
    ];

    return npcActions.filter(action => {
        // Only validate hidden (off-screen) actions — visible ones are already narrated
        if (action.player_visible) return true;

        const actionLower = action.action.toLowerCase();

        // Check for threat keyword + arrival indicator overlap
        for (const [keyword, eta] of distantThreatTerms.entries()) {
            if (!actionLower.includes(keyword)) continue;

            const hasArrivalIndicator = ARRIVAL_INDICATORS.some(v => actionLower.includes(v));
            if (hasArrivalIndicator) {
                log(
                    `[NPC ACTION BLOCKED — v1.7 COHERENCE] "${action.npc_name}: ` +
                    `${action.action.substring(0, 100)}" — implies local presence of ` +
                    `entity from threat with ETA ${eta}. Actions cannot advance threats ` +
                    `faster than their ETA countdown.`,
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
 * narrate threat progress (e.g., "Kavar has tracked Camilla to the shop") even
 * when NPC actions would be blocked by the coherence check.
 *
 * Returns the sanitised hidden_update string with violating lines stripped.
 */
const validateHiddenUpdateCoherence = (
    hiddenUpdate: string,
    emergingThreats: WorldTickEvent[],
    debugLogs: DebugLogEntry[]
): string => {
    if (!hiddenUpdate || hiddenUpdate.trim().length === 0) return hiddenUpdate;

    // Build entity names from distant threats (ETA > 3)
    const distantThreatEntityNames: Map<string, number> = new Map();
    for (const threat of emergingThreats) {
        const eta = threat.turns_until_impact ?? 0;
        if (eta <= 3) continue;

        // Use stored entity names if available, otherwise extract
        const names = threat.entitySourceNames ??
            extractEntityNamesFromDescription(threat.description);
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
 */
const processThreatSeeds = (
    incomingThreats: WorldTickEvent[],
    existingThreats: WorldTickEvent[],
    currentTurn: number,
    debugLogs: DebugLogEntry[],
    dormantHooks: DormantHook[] = [],       // v1.6: origin gate
    factionExposure: FactionExposure = {},  // v1.6: origin gate
    knownEntityNames: string[] = []         // v1.8: entity-name continuity
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
                threat.description, knownEntityNames
            );

            if (incomingNames.length > 0) {
                for (const existingThreat of existingThreats) {
                    const existingNames = existingThreat.entitySourceNames ??
                        extractEntityNamesFromDescription(
                            existingThreat.description, knownEntityNames
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
            extractEntityNamesFromDescription(threat.description, knownEntityNames);

        // Raw ETA from AI
        let currentEta = threat.turns_until_impact ?? 0;

        // v1.4: Enforce ETA floors on newly created threats
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

            const floor = isFactionThreat ? ETA_FLOOR_FACTION : ETA_FLOOR_INDIVIDUAL_NEUTRAL;

            if (currentEta < floor) {
                log(
                    `[THREAT ETA ENFORCED] "${threat.description.substring(0, 60)}" bumped ETA ${currentEta} → ${floor} (floor for ${isFactionThreat ? 'faction' : 'individual'} threat)`,
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

        // v1.8: DESCRIPTION LOCK — The AI's primary retcon vector is rewriting
        // the threat description every turn to inject new info the threat entity
        // couldn't know (e.g., "even if her hair changed" when the player changed
        // hair in a private room). When a continuation is detected (entity match
        // or Jaccard match), the EXISTING description is preserved.
        //
        // Additionally, plan pivot detection: if the AI's new description has
        // very low similarity, it's trying to change the threat's entire plan,
        // which requires a reaction delay.
        let lockedDescription = threat.description; // default: use AI's new desc
        if (existing && turnCreated !== currentTurn) {
            const descSimilarity = jaccardSimilarity(
                significantWords(threat.description),
                significantWords(existing.description)
            );

            if (entityMatchUsed) {
                // Entity-matched continuation: ALWAYS lock description.
                // The AI matched via shared entity names, meaning the descriptions
                // diverged enough to defeat Jaccard. The new description is almost
                // certainly a retcon/info-leak attempt. Keep the original.
                lockedDescription = existing.description;
                log(
                    `[DESCRIPTION LOCKED — v1.8] "${threat.description.substring(0, 60)}" → ` +
                    `keeping existing: "${existing.description.substring(0, 60)}" ` +
                    `(entity-matched continuation, similarity ${descSimilarity.toFixed(2)})`,
                    'warning'
                );
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
            const alreadyPenalized = existing.pivotPenaltyApplied === currentTurn ||
                (existing.pivotPenaltyApplied !== undefined &&
                 currentTurn - existing.pivotPenaltyApplied < PIVOT_DELAY_TURNS);

            if (descSimilarity < PIVOT_JACCARD_THRESHOLD && !alreadyPenalized) {
                const pivotEta = Math.max(currentEta, currentEta + PIVOT_DELAY_TURNS);
                log(
                    `[THREAT PIVOT DETECTED — v1.8] AI attempted: "${threat.description.substring(0, 60)}" — ` +
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
            consecutiveTurnsAtEtaOne,
            turns_until_impact: currentEta,
            status,
        };
    });

    // v1.6: Origin Gate — filter out causally invalid NEW threats before expiry/cap.
    // validateThreatCausality() auto-passes any threat with turnCreated < currentTurn,
    // so this only ever blocks seeds being proposed for the first time this turn.
    const causallyValid = processed.filter(threat =>
        validateThreatCausality(threat, dormantHooks, factionExposure, currentTurn, debugLogs, knownEntityNames)
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
        // 6. Entity Pipeline
        // ===================================================================
        let updatedKnownEntities = [...(currentWorld.knownEntities || [])];
        if (r.known_entity_updates) {
            for (const update of r.known_entity_updates) {
                const existingIdx = updatedKnownEntities.findIndex(e => e.id === update.id || e.name === update.name);
                if (existingIdx >= 0) {
                    updatedKnownEntities[existingIdx] = update;
                } else {
                    updatedKnownEntities.push(update);
                }
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

        // v1.8: Validate hidden_update against threat ETAs before writing.
        // This closes the bypass where the AI uses hidden_update to narrate
        // threat entities as locally present despite their ETA being > 3.
        if (r.hidden_update) {
            const existingEmergingForHiddenCheck =
                ((currentWorld as any).emergingThreats as WorldTickEvent[]) ?? [];
            const validatedHiddenUpdate = validateHiddenUpdateCoherence(
                r.hidden_update,
                existingEmergingForHiddenCheck,
                debugLogs
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

            // v1.7: Validate NPC actions against emerging threat ETAs before logging.
            // This prevents the AI from using npc_actions to teleport distant threats.
            const existingEmergingForCoherence =
                ((currentWorld as any).emergingThreats as WorldTickEvent[]) ?? [];
            const validatedNpcActions = validateNpcActionCoherence(
                r.world_tick.npc_actions,
                existingEmergingForCoherence,
                currentTurn,
                debugLogs
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

            // v1.6: Exposure scoring runs before threat validation so same-turn exposure counts
            const updatedExposure = updateFactionExposure(
                ((currentWorld as any).factionExposure as FactionExposure) ?? {},
                r.world_tick.npc_actions,
                currentTurn,
                debugLogs
            );
            (currentWorld as any).factionExposure = updatedExposure;

            // v1.6 / v1.4 / v1.8: Threat seed state machine with Origin Gate + ETA floors + entity continuity
            const knownEntityNames = (currentWorld.knownEntities ?? []).map(e => e.name);
            const processedThreats = processThreatSeeds(
                r.world_tick.emerging_threats,
                ((currentWorld as any).emergingThreats as WorldTickEvent[]) ?? [],
                currentTurn,
                debugLogs,
                ((currentWorld as any).dormantHooks as DormantHook[]) ?? [],
                updatedExposure,
                knownEntityNames
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

        let finalSceneMode: SceneMode = r.scene_mode || 'NARRATIVE';
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