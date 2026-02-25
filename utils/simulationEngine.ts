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
    debugLogs: DebugLogEntry[]
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
    if (threat.dormantHookId) {
        const hook = dormantHooks.find(h => h.id === threat.dormantHookId);
        if (hook && hook.status !== 'resolved') {
            log(`[ORIGIN GATE ✓] "${desc}" — hook: ${hook.summary}`);
            return true;
        }
        log(`[ORIGIN GATE ✗] "${desc}" — dormantHookId "${threat.dormantHookId}" not found or resolved. BLOCKED.`);
        return false;
    }

    // Gate 2: Player action cause
    if (threat.playerActionCause && threat.playerActionCause.trim().length > 10) {
        log(`[ORIGIN GATE ✓] "${desc}" — player action: "${threat.playerActionCause}"`);
        return true;
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
 */
const processThreatSeeds = (
    incomingThreats: WorldTickEvent[],
    existingThreats: WorldTickEvent[],
    currentTurn: number,
    debugLogs: DebugLogEntry[],
    dormantHooks: DormantHook[] = [],       // v1.6: origin gate
    factionExposure: FactionExposure = {}   // v1.6: origin gate
): WorldTickEvent[] => {
    const log = (message: string, type: DebugLogEntry['type'] = 'warning') => {
        debugLogs.push({ timestamp: new Date().toISOString(), message, type });
    };

    // Step 1: Annotate incoming threats — assign IDs, enforce floors, track ETA ~1 streaks
    const processed: WorldTickEvent[] = incomingThreats.map(threat => {
        let existing = existingThreats.find(t => t.id && t.id === threat.id);

        // v1.5: Enhanced re-submission detection
        // If ID is missing, check for semantic duplicate in existing threats
        if (!threat.id && !existing) {
             existing = existingThreats.find(t => {
                const sim = jaccardSimilarity(
                    significantWords(threat.description),
                    significantWords(t.description)
                );
                return sim >= 0.60;
            });
        }

        // Assign ID if new
        const id = threat.id || existing?.id || generateThreatId();

        // Set creation turn if new
        const turnCreated = threat.turnCreated ?? existing?.turnCreated ?? currentTurn;

        // Raw ETA from AI
        let currentEta = threat.turns_until_impact ?? 0;

        // v1.4: Enforce ETA floors on newly created threats
        if (turnCreated === currentTurn) {
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
            id,
            turnCreated,
            consecutiveTurnsAtEtaOne,
            turns_until_impact: currentEta,
            status,
        };
    });

    // v1.6: Origin Gate — filter out causally invalid NEW threats before expiry/cap.
    // validateThreatCausality() auto-passes any threat with turnCreated < currentTurn,
    // so this only ever blocks seeds being proposed for the first time this turn.
    const causallyValid = processed.filter(threat =>
        validateThreatCausality(threat, dormantHooks, factionExposure, currentTurn, debugLogs)
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

        if (r.hidden_update) {
            newHiddenRegistry += `\n[${newTime.display}] ${r.hidden_update}`;
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

            const hiddenActions = r.world_tick.npc_actions.filter(a => !a.player_visible);
            for (const action of hiddenActions) {
                newHiddenRegistry += `\n[${newTime.display}] [WORLD-TICK] ${action.npc_name}: ${action.action}`;
            }

            const visibleActions = r.world_tick.npc_actions.filter(a => a.player_visible);
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

            // v1.6 / v1.4: Threat seed state machine with Origin Gate + ETA floors
            const processedThreats = processThreatSeeds(
                r.world_tick.emerging_threats,
                ((currentWorld as any).emergingThreats as WorldTickEvent[]) ?? [],
                currentTurn,
                debugLogs,
                ((currentWorld as any).dormantHooks as DormantHook[]) ?? [],
                updatedExposure
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

            // Write active threats to hidden registry for AI context
            for (const threat of processedThreats) {
                const eta = threat.turns_until_impact !== undefined
                    ? ` (ETA: ~${threat.turns_until_impact} turns)`
                    : '';
                newHiddenRegistry += `\n[${newTime.display}] [EMERGING] ${threat.description}${eta}`;
                debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: `[THREAT SEED] ${threat.description}${eta}`,
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
