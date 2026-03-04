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
    DormantHook, FactionExposure, WorldTickAction, ThreatArcHistory, ThreatArcEntry, KnownEntity
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
    checkConditionDuplicateEnhanced,  // v1.12
    significantWords,
    jaccardSimilarity,
    bigramJaccardSimilarity,          // v1.12
    autoConsolidateMemory,            // v1.12
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

import {
    THREAT_SEED_CAP, MAX_CONSECUTIVE_ETA_ONE, LORE_MATURATION_TURNS,
    ESCALATION_BUDGET_MAX, ESCALATION_WINDOW_TURNS, INFO_PROPAGATION_MIN_TURNS,
    NPC_ATTRITION_CHANCE, CONSEQUENT_HOOKS_PER_CONSUMPTION,
    EXPOSURE_THRESHOLD_FOR_THREAT, EXPOSURE_DIRECT_OBSERVATION,
    EXPOSURE_PUBLIC_ACTION, EXPOSURE_DECAY_PER_TURN,
    MAX_REGISTRY_LINES, TIME_CAPS, MEMORY_CAP,
} from '../config/engineConfig';

import {
    updateTime, trimHiddenRegistry, calculateTimeDelta,
    updateFactionExposure_v112, decayFactionExposureOnArcConclusion,
    updateHookCooldowns, regenerateConsequentHooks,
    getEffectiveSceneMode, detectAlliedPassivity, validateNpcActionCoherence,
    validateHiddenUpdateCoherence, extractHostileFactionKeywords,
    validateNpcEntityRegistration, syncEntityLocationsFromWorldTick,
    applyNpcAttritionLayer, ENTITY_EXTRACTION_BLACKLIST,
    processThreatSeeds, extractEntityNamesFromDescription, extractBannedMechanismFromRejection,
    checkBannedMechanisms
} from './engine';
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

        // v1.12 FIX SE-5: Entity Location Sync from world_tick NPC actions
        if (r.world_tick?.npc_actions) {
            updatedKnownEntities = syncEntityLocationsFromWorldTick(
                updatedKnownEntities,
                r.world_tick.npc_actions,
                r.hidden_update ?? '',
                debugLogs
            );
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

            // v1.12 FIX SE-8: Check lore against banned mechanisms
            const bannedMechs = currentWorld.bannedMechanisms ?? [];
            if (checkBannedMechanisms(`${keyword} ${content}`, bannedMechs, debugLogs)) {
                debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: `[LORE BANNED — v1.12] "${keyword}" matches a player-rejected mechanism. Suppressed.`,
                    type: 'error'
                });
            } else {
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
                    expansionItem.semanticUpdateOf = exactMatch.id;
                    expansionItem.turnCreated = currentTurn;
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
                    newItem.turnCreated = currentTurn;

                    if (isUpdate) {
                        newItem.semanticUpdateOf = currentWorld.lore[existingIndex]?.id;
                    }

                    pendingLore.push(newItem);

                    debugLogs.push({
                        timestamp: new Date().toISOString(),
                        message: `[LORE] Pending: "${keyword}"${isUpdate ? ' (semantic update of existing entry)' : ''}`,
                        type: 'info'
                    });
                }
            } // end else (no exact keyword match)
            } // end else (not banned)
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
                // v1.12 FIX SE-3: Auto-consolidate before giving up
                const consolidated = autoConsolidateMemory(finalMemory, debugLogs);
                if (consolidated.length < MEMORY_CAP) {
                    // Consolidation freed space — try the write again
                    finalMemory = consolidated;
                    const { isDuplicate, isUpdate, existingIndex } = checkMemoryDuplicate(
                        r.new_memory.fact,
                        finalMemory
                    );

                    if (isDuplicate) {
                        debugLogs.push({
                            timestamp: new Date().toISOString(),
                            message: `[MEMORY] Post-consolidation duplicate suppressed: "${r.new_memory.fact.substring(0, 80)}"`,
                            type: 'info'
                        });
                    } else if (isUpdate) {
                        finalMemory[existingIndex] = {
                            id: finalMemory[existingIndex].id,
                            fact: r.new_memory.fact,
                            timestamp: new Date().toISOString()
                        };
                        debugLogs.push({
                            timestamp: new Date().toISOString(),
                            message: `[MEMORY] Post-consolidation update (supersedes #${existingIndex}): "${r.new_memory.fact.substring(0, 80)}"`,
                            type: 'success'
                        });
                    } else {
                        finalMemory = [...finalMemory, {
                            id: generateMemoryId(),
                            fact: r.new_memory.fact,
                            timestamp: new Date().toISOString()
                        }];
                        debugLogs.push({
                            timestamp: new Date().toISOString(),
                            message: `[MEMORY] Post-consolidation engram created: "${r.new_memory.fact.substring(0, 80)}"`,
                            type: 'success'
                        });
                    }
                } else {
                    debugLogs.push({
                        timestamp: new Date().toISOString(),
                        message: `[MEMORY] Cap reached (${MEMORY_CAP}) — consolidation unable to free slots. Fragment suppressed: "${r.new_memory.fact.substring(0, 60)}"`,
                        type: 'warning'
                    });
                }
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
            const existingEmergingForHiddenCheck = currentWorld.emergingThreats ?? [];
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
                r.world_tick = { npc_actions: [], environment_changes: [], emerging_threats: [] };
            }
        }

        let lastWorldTickTurn = currentWorld.lastWorldTickTurn ?? 0;
        let processedThreats: WorldTickEvent[] | undefined;
        let currentHooks: DormantHook[] | undefined;
        let currentFactionExposure: FactionExposure | undefined;
        let detectedPassiveAllies: string[] | undefined;
        let currentThreatArcHistory: ThreatArcHistory | undefined;

        if (r.world_tick) {
            const hasActivity =
                (r.world_tick.npc_actions && r.world_tick.npc_actions.length > 0) ||
                (r.world_tick.environment_changes && r.world_tick.environment_changes.length > 0) ||
                (r.world_tick.emerging_threats && r.world_tick.emerging_threats.length > 0);

            if (hasActivity) lastWorldTickTurn = currentTurn;

            // v1.7 + v1.9: Validate NPC actions against emerging threat ETAs before logging.
            // This prevents the AI from using npc_actions to teleport distant threats.
            // v1.9: Scene-mode awareness — COMBAT skips coherence entirely.
            const existingEmergingForCoherence = currentWorld.emergingThreats ?? [];
            const validatedNpcActions = validateNpcActionCoherence(
                r.world_tick.npc_actions,
                existingEmergingForCoherence,
                currentTurn,
                debugLogs,
                currentSceneMode  // v1.9
            );
            // Overwrite so downstream processing (exposure scoring, etc.) uses validated set
            r.world_tick.npc_actions = validatedNpcActions;

            // v1.11 FIX 4: Phantom Entity Detection — block NPC actions from
            // unregistered entities whose names contain hostile faction keywords.
            const hostileFactionKws = extractHostileFactionKeywords(
                (currentWorld.knownEntities ?? []).map(e => ({
                    name: e.name,
                    role: e.role,
                    relationship_level: e.relationship_level
                }))
            );
            const knownEntityNames = (currentWorld.knownEntities ?? []).map(e => e.name);
            r.world_tick.npc_actions = validateNpcEntityRegistration(
                r.world_tick.npc_actions,
                knownEntityNames,
                currentWorld.emergingThreats ?? [],
                hostileFactionKws,
                debugLogs,
                currentSceneMode
            );

            // v1.12 FIX SE-9: NPC Attrition Layer — hostile NPCs traversing hazardous areas
            r.world_tick.npc_actions = applyNpcAttritionLayer(
                r.world_tick.npc_actions,
                currentWorld.emergingThreats ?? [],
                r.world_tick.environment_changes,
                (currentWorld.knownEntities ?? []).map(e => ({
                    name: e.name, relationship_level: e.relationship_level
                })),
                debugLogs
            );

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

            // v1.10: Allied NPC passivity detection — flag when bonded/companion NPCs
            // are passive while hostile combat actions are occurring.
            const passiveAllies = detectAlliedPassivity(
                r.world_tick.npc_actions,
                (currentWorld.knownEntities ?? []).map(e => ({
                    name: e.name,
                    role: e.role,
                    relationship_level: e.relationship_level
                })),
                currentSceneMode,
                debugLogs
            );
            // Store for sectionReminders to fire the ALLIED_PROACTIVITY reminder
            detectedPassiveAllies = [];
            if (passiveAllies.length > 0) {
                detectedPassiveAllies = passiveAllies;
            }

            // v1.6: Exposure scoring runs before threat validation so same-turn exposure counts
            currentFactionExposure = currentWorld.factionExposure ?? {};
            currentFactionExposure = updateFactionExposure_v112(
                currentFactionExposure,
                r.world_tick.npc_actions,
                currentTurn,
                debugLogs,
                currentWorld.knownEntities || [],
                r.world_tick.emerging_threats || []
            );

            // v1.6 / v1.4 / v1.8 / v1.9 / v1.11: Threat seed state machine with Origin Gate + ETA floors + entity continuity + scene awareness + re-seed detection
            processedThreats = processThreatSeeds(
                r.world_tick.emerging_threats,
                currentWorld.emergingThreats ?? [],
                currentTurn,
                debugLogs,
                currentWorld.dormantHooks ?? [],
                currentFactionExposure,
                knownEntityNames,
                character.name,
                currentSceneMode,
                currentWorld.threatArcHistory ?? {},
                // v1.12: New parameters
                currentWorld.lore ?? [],                                    // FIX SE-6
                currentWorld.bannedMechanisms ?? [], // FIX SE-8
                (currentWorld.knownEntities ?? []).map(e => ({              // FIX SE-7
                    name: e.name, location: e.location, relationship_level: e.relationship_level
                })),
                currentWorld.location ?? ''                                 // FIX SE-7
            );

            // v1.6: Activate dormant hooks referenced by processed threats
            currentHooks = currentWorld.dormantHooks ?? [];
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

            // v1.11 FIX 2 + FIX 5: Hook Cooldown + Threat Arc History
            // Use the snapshot taken before processing for comparison
            const previousEmergingThreats = existingEmergingForCoherence;
            const { updatedHooks: cooldownHooks, updatedArcHistory } = updateHookCooldowns(
                currentHooks,
                previousEmergingThreats,
                processedThreats,
                currentTurn,
                currentWorld.threatArcHistory ?? {},
                debugLogs
            );
            currentHooks = cooldownHooks;

            // v1.12 FIX SE-4: Consequent Hook Regeneration
            const regeneratedHooks = regenerateConsequentHooks(
                cooldownHooks,
                previousEmergingThreats.filter(t =>
                    !processedThreats.some(pt => pt.id === t.id)
                ), // threats that just expired
                currentTurn,
                debugLogs,
                currentWorld.lore ?? []
            );
            currentHooks = regeneratedHooks;

            currentThreatArcHistory = updatedArcHistory;

            // v1.11 FIX 7: Aggressive exposure decay when faction threat arcs conclude
            currentFactionExposure = decayFactionExposureOnArcConclusion(
                currentFactionExposure,
                previousEmergingThreats,
                processedThreats,
                currentTurn,
                debugLogs
            );

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
                // v1.11 FIX 6: Tag registry entries with threat ID for tracking
                const tag = threat.id ? `[THREAT:${threat.id}] ` : '';
                newHiddenRegistry += `\n[${newTime.display}] ${tag}[NEW THREAT] ${threat.description}${eta}`;
                debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: `[NEW THREAT SEED] ${threat.description}${eta}`,
                    type: 'warning'
                });
            }

            // v1.11 FIX 6: Write expiry markers for threats that just disappeared.
            // This tells the AI (and future context) that the threat is over.
            const previousThreatIds = new Set(
                (previousEmergingThreats ?? []).map(t => t.id).filter(Boolean)
            );
            const currentThreatIds = new Set(
                processedThreats.map(t => t.id).filter(Boolean)
            );
            for (const prev of (previousEmergingThreats ?? [])) {
                if (prev.id && !currentThreatIds.has(prev.id)) {
                    const reason = prev.status === 'expired' ? 'auto-expired (ETA ~1 timeout)'
                        : prev.status === 'triggered' ? 'triggered (became active scene)'
                        : 'blocked/removed by engine validation';
                    const tag = `[THREAT:${prev.id}] `;
                    newHiddenRegistry += `\n[${newTime.display}] ${tag}[THREAT EXPIRED] ` +
                        `"${prev.description.substring(0, 60)}" — ${reason}. ` +
                        `Prior registry entries for this threat are HISTORICAL ONLY.`;
                }
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
                const { isDuplicate, existingIndex } = checkConditionDuplicateEnhanced(c, finalConditions);
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
            (typeof processedThreats !== 'undefined' ? processedThreats : currentWorld.emergingThreats) ?? [];

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
                dormantHooks: typeof currentHooks !== 'undefined' ? currentHooks : (currentWorld.dormantHooks ?? []),
                factionExposure: typeof currentFactionExposure !== 'undefined' ? currentFactionExposure : (currentWorld.factionExposure ?? {}),
                bannedNameMap: nameMap,
                emergingThreats: finalEmergingThreats,
                // v1.10: Flag for sectionReminders to fire allied proactivity every turn
                passiveAlliesDetected: typeof detectedPassiveAllies !== 'undefined' ? detectedPassiveAllies.length > 0 : (currentWorld.passiveAlliesDetected ?? false),
                // v1.11: Threat arc history for re-seed detection
                threatArcHistory: typeof currentThreatArcHistory !== 'undefined' ? currentThreatArcHistory : (currentWorld.threatArcHistory ?? {}),
                bannedMechanisms: currentWorld.bannedMechanisms ?? [],
            },
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