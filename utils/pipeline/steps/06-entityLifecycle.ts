import type { PipelineStep, TurnContext } from '../types';
import {
    syncEntityLocationsFromWorldTick,
    updateEntityPresence,
    applyStatusTransitions,
    detectEntityDeaths,
    detectLoreDeaths,
    processLocationUpdate,
    inferPlayerLocation,
    deduplicateLocationGraph,
    ENTITY_EXTRACTION_BLACKLIST
} from '../../engine';
import { checkNameCollision, registerEntityName } from '../../nameResolver';

/**
 * Step 6: Entity Pipeline — v1.8: Enhanced dedup with fuzzy name matching
 *
 * Processes known entity updates, deduplicates, handles name collisions,
 * updates entity presence/status based on narrative and world_tick,
 * and processes location updates.
 */
export const entityLifecycleStep: PipelineStep = {
    name: '06-entityLifecycle',
    execute: (ctx: TurnContext): TurnContext => {
        const r = ctx.sanitisedResponse;

        // Collect banned-name replacement values so we know which names might be
        // artificial collisions (two different NPCs renamed to the same name).
        const bannedReplacementNames = new Set(
            Object.values(ctx.nameMap).map(v => v.toLowerCase())
        );

        let updatedKnownEntities = [...(ctx.previousWorld.knownEntities || [])];

        // Multi-strategy entity dedup with fuzzy name matching
        if (r.known_entity_updates) {
            for (const update of r.known_entity_updates) {
                let existingIdx = updatedKnownEntities.findIndex(e => e.id === update.id);

                if (existingIdx < 0) {
                    existingIdx = updatedKnownEntities.findIndex(e => e.name === update.name);
                }

                if (existingIdx < 0) {
                    // Fuzzy first-name match: extract significant name words and check overlap
                    const updateNameParts = update.name
                        .replace(/\([^)]*\)/g, '')
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

                            const matchedParts = existingParts.filter(ep => updateNameParts.includes(ep));
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

                                if (updateRoleWords.size >= 1 && existingRoleWords.size >= 1 && sharedRoleWords.length === 0) {
                                    return false;
                                }
                            }

                            return true;
                        });

                        if (existingIdx >= 0) {
                            ctx.debugLogs.push({
                                timestamp: new Date().toISOString(),
                                message: `[ENTITY DEDUP — v1.8 FUZZY MATCH] "${update.name}" (${update.id}) matched existing "${updatedKnownEntities[existingIdx].name}" (${updatedKnownEntities[existingIdx].id}) via first-name overlap. Updating in place.`,
                                type: 'warning'
                            });
                        }
                    }
                }

                if (existingIdx >= 0) {
                    const existingEntity = updatedKnownEntities[existingIdx];
                    updatedKnownEntities[existingIdx] = {
                        ...update,
                        id: existingEntity.id,
                    };
                } else {
                    updatedKnownEntities.push(update);
                }
            }
        }

        // v1.15: Register all entity names and block collisions
        if (r.known_entity_updates) {
            const existingNames = updatedKnownEntities.map(e => e.name);
            for (const update of r.known_entity_updates) {
                const collision = checkNameCollision(
                    update.name,
                    ctx.usedNames,
                    existingNames
                );
                if (collision) {
                    ctx.debugLogs.push({
                        timestamp: new Date().toISOString(),
                        message: `[NAME COLLISION — v1.15] "${update.name}" contains name part "${collision}" already used by another character in this story. New entity BLOCKED.`,
                        type: 'error'
                    });
                    const colIdx = updatedKnownEntities.findIndex(e => e.name === update.name);
                    if (colIdx >= 0 && !existingNames.includes(update.name)) {
                        updatedKnownEntities.splice(colIdx, 1);
                    }
                }
            }
        }

        // v1.15: Register all current entity names
        for (const entity of updatedKnownEntities) {
            const updatedRegistry = registerEntityName(entity.name, ctx.usedNames);
            if (updatedRegistry !== ctx.usedNames) {
                ctx.usedNames.length = 0;
                ctx.usedNames.push(...updatedRegistry);
            }
        }

        // v1.8: Post-processing dedup pass
        {
            const seen = new Map<string, number>();
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

                        const isBannedCollision = bannedReplacementNames.has(part);
                        if (isBannedCollision) {
                            const roleWords = (role: string) => new Set(
                                (role ?? '').toLowerCase().split(/[\s/,()]+/).filter(w => w.length >= 3)
                            );
                            const entityRoleWords = roleWords(entity.role);
                            const existingRoleWords = roleWords(existingEntity.role);
                            const sharedRoleWords = [...entityRoleWords].filter(w => existingRoleWords.has(w));

                            if (entityRoleWords.size >= 1 && existingRoleWords.size >= 1 && sharedRoleWords.length === 0) {
                                continue;
                            }
                        }

                        const existingLen = (existingEntity.impression ?? '').length;
                        const currentLen = (entity.impression ?? '').length;
                        if (currentLen > existingLen) {
                            toRemove.push(existingIdx);
                            seen.set(part, i);
                        } else {
                            toRemove.push(i);
                        }
                        isDuplicate = true;
                        ctx.debugLogs.push({
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
                ctx.debugLogs
            );
        }

        // v1.14: Entity Status Lifecycle
        let newPlayerLocation = ctx.previousWorld.location ?? '';
        updatedKnownEntities = updateEntityPresence(
            updatedKnownEntities,
            r.narrative,
            r.world_tick?.npc_actions ?? [],
            r.npc_interaction,
            ctx.currentTurn,
            newPlayerLocation,
            ctx.debugLogs
        );

        updatedKnownEntities = applyStatusTransitions(
            updatedKnownEntities,
            ctx.currentTurn,
            newPlayerLocation,
            ctx.previousWorld.location ?? '',
            ctx.previousWorld.emergingThreats ?? [],
            ctx.debugLogs
        );

        updatedKnownEntities = detectEntityDeaths(
            updatedKnownEntities,
            r.known_entity_updates,
            r.narrative,
            ctx.debugLogs
        );

        updatedKnownEntities = detectLoreDeaths(
            updatedKnownEntities,
            ctx.previousWorld.lore ?? [],
            ctx.debugLogs
        );

        // v1.14: Location Proximity Graph
        let updatedLocationGraph = ctx.previousWorld.locationGraph ?? {
            nodes: {},
            edges: [],
            playerLocationId: ''
        };

        updatedLocationGraph = deduplicateLocationGraph(updatedLocationGraph, ctx.debugLogs);

        if (r.location_update) {
            updatedLocationGraph = processLocationUpdate(
                updatedLocationGraph,
                r.location_update,
                ctx.currentTurn,
                ctx.debugLogs
            );
            newPlayerLocation = r.location_update.location_name;
        } else {
            const inferred = inferPlayerLocation(updatedLocationGraph, r.narrative, newPlayerLocation);
            if (inferred !== newPlayerLocation) {
                newPlayerLocation = inferred;
            }
        }

        // Update context
        ctx.updatedKnownEntities = updatedKnownEntities;
        ctx.newPlayerLocation = newPlayerLocation;
        ctx.worldUpdate = {
            ...ctx.worldUpdate,
            knownEntities: updatedKnownEntities,
            location: newPlayerLocation,
            locationGraph: updatedLocationGraph
        };

        return ctx;
    }
};
