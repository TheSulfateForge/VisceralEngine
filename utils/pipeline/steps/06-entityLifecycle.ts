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
 * v1.23: Significant name parts — parens stripped, lowercased, short/blacklisted
 * tokens (incl. honorifics like "Lord"/"Countess") dropped. The FIRST entry is
 * treated as the given name.
 */
const significantNameParts = (name: string): string[] =>
    name
        .replace(/\([^)]*\)/g, '')
        .split(/\s+/)
        .map(p => p.toLowerCase().trim())
        .filter(p => p.length >= 3 && !ENTITY_EXTRACTION_BLACKLIST.has(p));

/**
 * v1.23: Two entity records describe the SAME person only when they share a
 * given name (first significant token) AND at least one other token (typically
 * the surname) — or, for single-token names, an exact token match.
 *
 * This is the core fix for the "33 seed NPCs collapse to ~18" bug: the old
 * dedup treated ANY shared name part as a duplicate, so same-surname family
 * members ("Aster/Lyrelle/Cassian/... Verancourt") were merged into one
 * record. Requiring a given-name match keeps relatives distinct while still
 * merging title/format variants of one individual
 * ("Halric Vance" ⇄ "Guildmaster Halric Vance").
 */
const isSamePerson = (nameA: string, nameB: string): boolean => {
    const a = significantNameParts(nameA);
    const b = significantNameParts(nameB);
    if (a.length === 0 || b.length === 0) return false;
    if (a.length === 1 || b.length === 1) return a.some(p => b.includes(p));
    return a[0] === b[0] && a.slice(1).some(p => b.includes(p));
};

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
                    // v1.23: Person-identity match — requires a given-name match,
                    // not just a shared surname (see isSamePerson).
                    const updateNameParts = significantNameParts(update.name);

                    if (updateNameParts.length > 0) {
                        existingIdx = updatedKnownEntities.findIndex(e => {
                            if (!isSamePerson(update.name, e.name)) return false;

                            const existingParts = significantNameParts(e.name);
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

        // v1.23: Post-processing dedup pass — person-identity based.
        // Compares each entity against already-kept entities via isSamePerson
        // so same-surname relatives are preserved. (Previously keyed on any
        // shared name part, which collapsed entire noble houses into one NPC.)
        {
            const keptIdx: number[] = [];
            const toRemove = new Set<number>();

            for (let i = 0; i < updatedKnownEntities.length; i++) {
                const entity = updatedKnownEntities[i];
                let dupKi = -1;

                for (const ki of keptIdx) {
                    const other = updatedKnownEntities[ki];
                    if (!isSamePerson(entity.name, other.name)) continue;

                    // Distinct people renamed onto the same banned replacement
                    // name but holding clearly different roles are NOT duplicates.
                    const sharedParts = significantNameParts(entity.name)
                        .filter(p => significantNameParts(other.name).includes(p));
                    const isBannedCollision = sharedParts.some(p => bannedReplacementNames.has(p));
                    if (isBannedCollision) {
                        const roleWords = (role: string) => new Set(
                            (role ?? '').toLowerCase().split(/[\s/,()]+/).filter(w => w.length >= 3)
                        );
                        const entityRoleWords = roleWords(entity.role);
                        const otherRoleWords = roleWords(other.role);
                        const sharedRoleWords = [...entityRoleWords].filter(w => otherRoleWords.has(w));
                        if (entityRoleWords.size >= 1 && otherRoleWords.size >= 1 && sharedRoleWords.length === 0) {
                            continue;
                        }
                    }

                    dupKi = ki;
                    break;
                }

                if (dupKi >= 0) {
                    const other = updatedKnownEntities[dupKi];
                    const keepCurrent = (entity.impression ?? '').length > (other.impression ?? '').length;
                    if (keepCurrent) {
                        toRemove.add(dupKi);
                        keptIdx[keptIdx.indexOf(dupKi)] = i;
                    } else {
                        toRemove.add(i);
                    }
                    ctx.debugLogs.push({
                        timestamp: new Date().toISOString(),
                        message: `[ENTITY DEDUP — v1.23 POST-PROCESS] "${entity.name}" and "${other.name}" resolved to the same person. Keeping the more detailed record.`,
                        type: 'warning'
                    });
                } else {
                    keptIdx.push(i);
                }
            }

            if (toRemove.size > 0) {
                updatedKnownEntities = updatedKnownEntities.filter((_, i) => !toRemove.has(i));
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
