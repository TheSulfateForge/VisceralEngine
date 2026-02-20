/**
 * simulationEngine.ts — v1.4
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
 */

import {
    ModelResponseSchema, GameWorld, DebugLogEntry, LoreItem,
    Character, MemoryItem, SceneMode, WorldTime, WorldTickEvent
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
    containsRenameMarker,
} from './contentValidation';

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
 */
const processThreatSeeds = (
    incomingThreats: WorldTickEvent[],
    existingThreats: WorldTickEvent[],
    currentTurn: number,
    debugLogs: DebugLogEntry[]
): WorldTickEvent[] => {
    const log = (message: string, type: DebugLogEntry['type'] = 'warning') => {
        debugLogs.push({ timestamp: new Date().toISOString(), message, type });
    };

    // Step 1: Annotate incoming threats — assign IDs, enforce floors, track ETA ~1 streaks
    const processed: WorldTickEvent[] = incomingThreats.map(threat => {
        const existing = existingThreats.find(t => t.id && t.id === threat.id);

        // Assign ID if new
        const id = threat.id || generateThreatId();

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

    // Step 2: Filter out expired seeds
    const active = processed.filter(t => t.status !== 'expired' && t.status !== 'triggered');

    // Step 3: Enforce cap of THREAT_SEED_CAP simultaneous seeds
    if (active.length > THREAT_SEED_CAP) {
        log(`[THREAT CAP] ${active.length} seeds present — cap is ${THREAT_SEED_CAP}. Oldest seeds trimmed.`, 'warning');
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
        // ===================================================================
        const { sanitisedResponse: response_sanitised, allViolations } = sanitiseAllFields(response);
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

            const { isDuplicate, isUpdate, existingIndex } = checkLoreDuplicate(
                keyword,
                content,
                currentWorld.lore
            );

            if (isDuplicate) {
                debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: `[LORE SEMANTIC DUPE] "${keyword}" is too similar to existing entry "${currentWorld.lore[existingIndex]?.keyword}" (Jaccard ≥ 0.60) — suppressed.`,
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
                    // Tag it so the approval modal can offer "Replace" as the primary action
                    (newItem as any).semanticUpdateOf = currentWorld.lore[existingIndex]?.id;
                }

                pendingLore.push(newItem);

                debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: `[LORE] Pending: "${keyword}"${isUpdate ? ' (semantic update of existing entry)' : ''}`,
                    type: 'info'
                });
            }
        }

        // --- Memory (with semantic deduplication and hard cap) ---
        let finalMemory = [...currentWorld.memory];

        if (r.new_memory) {
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

            // v1.3 / v1.4: Threat seed state machine with enforced ETA floors
            const processedThreats = processThreatSeeds(
                r.world_tick.emerging_threats,
                ((currentWorld as any).emergingThreats as WorldTickEvent[]) ?? [],
                currentTurn,
                debugLogs
            );

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
        bioResult.addedConditions.forEach(c => {
            if (!finalConditions.includes(c)) finalConditions.push(c);
        });

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

        // ===================================================================
        // 11. v1.3: sceneMode Auto-Transition
        //     If no active or emerging threats remain after this turn and the
        //     mode is COMBAT or TENSION, automatically transition to NARRATIVE
        //     and decay tension by 30 points (floored at 0, not snapped to 0).
        // ===================================================================
        const finalEmergingThreats = (currentWorld as any).__processedEmergingThreats ?? [];
        let finalSceneMode: SceneMode = r.scene_mode || 'NARRATIVE';
        let finalTensionLevel = tensionLevel;

        const noThreatsRemain = nextThreats.length === 0 && finalEmergingThreats.length === 0;
        if (noThreatsRemain && (finalSceneMode === 'COMBAT' || finalSceneMode === 'TENSION')) {
            finalSceneMode = 'NARRATIVE';
            finalTensionLevel = Math.max(0, tensionLevel - 30);
            debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[SCENE] Auto-transition: ${r.scene_mode} → NARRATIVE (no remaining threats). Tension: ${tensionLevel} → ${finalTensionLevel}`,
                type: 'success'
            });
        }

        // ===================================================================
        // 12. v1.3: Devil's Bargain tracking
        //     Update lastBargainTurn when the AI provides a bargain_request.
        // ===================================================================
        const lastBargainTurn = r.bargain_request
            ? currentTurn + 1  // currentTurn is the turn being processed
            : (currentWorld.lastBargainTurn ?? 0);

        if (r.bargain_request) {
            debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[BARGAIN] Devil's Bargain offered this turn. lastBargainTurn → ${lastBargainTurn}`,
                type: 'info'
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

        // ===================================================================
        // Return assembled state
        // ===================================================================
        return {
            worldUpdate: {
                ...currentWorld,
                time: newTime,
                lore: currentWorld.lore,
                memory: finalMemory,
                hiddenRegistry: trimHiddenRegistry(newHiddenRegistry),
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