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
import { detectPlayerFraming } from '../../engine/playerFraming';
import { RELATIONSHIP_LEVELS, type RelationshipLevel } from '../../../types';
import { RELATIONSHIP_MAX_STEPS_PER_TURN } from '../../../config/engineConfig';

/** v1.28: level a character-sheet-declared relationship enters the world at. */
const DECLARED_RELATIONSHIP_FLOOR: RelationshipLevel = 'WARM';

/** Declared relationships whose text reads adversarial are not auto-warmed. */
const HOSTILE_RELATIONSHIP_HINTS = /\b(estranged|hate[sd]?|rival|enem|feud|betray|disowned|nemesis|abusive|hostile|exiled|vendetta)\w*/i;

/**
 * v1.28: match an entity name against the free-text relationships on the
 * character sheet (e.g. "Anwen Drevast (twin sister)"). Returns the matching
 * declaration, or null.
 */
const declaredRelationshipFor = (
    entityName: string,
    relationships: string[],
): string | null => {
    const tokens = significantNameParts(entityName);
    if (tokens.length === 0) return null;

    for (const declaration of relationships) {
        if (!declaration || HOSTILE_RELATIONSHIP_HINTS.test(declaration)) continue;
        const declaredTokens = significantNameParts(declaration.replace(/\([^)]*\)/g, ''));
        // Require the given name plus one more token, or an exact single-token
        // match — same standard the dedup matcher uses, so "Anwen" alone will
        // not claim "Anwen Sarath".
        const shared = tokens.filter(t => declaredTokens.includes(t));
        if (shared.length >= 2 || (tokens.length === 1 && shared.length === 1)) {
            return declaration;
        }
    }
    return null;
};

/**
 * v1.28: relationship ratchet.
 *
 * relationship_level was entirely model-owned. The response schema requires the
 * field on every entity update, so the model re-declared it from scratch every
 * turn with nothing anchoring it to what the relationship had actually become.
 * The observed result in long campaigns was that firmly established allies —
 * family, protectors, love interests — silently reverted to NEUTRAL, which in
 * turn starved the world-pulse brief (it filters on relationship_level) and
 * removed any signal telling the narrator these people were allies at all.
 *
 * Movement is now capped at RELATIONSHIP_MAX_STEPS_PER_TURN steps along the
 * NEMESIS→DEVOTED ladder. A bond can still break — it just has to be walked
 * down a rung at a time in view of the player, rather than teleporting.
 */
const clampRelationshipMovement = (
    previous: RelationshipLevel | undefined,
    proposed: RelationshipLevel | undefined,
    entityName: string,
    debugLogs: { timestamp: string; message: string; type: string }[],
): RelationshipLevel | undefined => {
    if (!previous || !proposed || previous === proposed) return proposed ?? previous;

    const from = RELATIONSHIP_LEVELS.indexOf(previous);
    const to = RELATIONSHIP_LEVELS.indexOf(proposed);
    if (from < 0 || to < 0) return proposed;

    const distance = Math.abs(to - from);
    if (distance <= RELATIONSHIP_MAX_STEPS_PER_TURN) return proposed;

    const direction = to > from ? 1 : -1;
    const clamped = RELATIONSHIP_LEVELS[from + direction * RELATIONSHIP_MAX_STEPS_PER_TURN];
    debugLogs.push({
        timestamp: new Date().toISOString(),
        message: `[RELATIONSHIP RATCHET — v1.28] ${entityName}: model proposed ${previous} → ${proposed} ` +
            `(${distance} steps) in a single turn. Clamped to ${clamped}. Relationships move one rung per turn ` +
            `so long-established bonds cannot silently reset.`,
        type: 'warning',
    });
    return clamped;
};

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
 * v1.24: Code-side enforcement of the §10 "one-of-four cap". The model has a
 * known failure mode of default-filling NEW NPCs with threat-archetype traits
 * (predatory/cold/calculating/clinical + synonyms). The prompt asks it not
 * to; this enforces it. For a comma/semicolon-separated personality string,
 * segments containing an archetype trait beyond the FIRST archetype-bearing
 * segment are dropped. Non-list personalities (no separators) pass through
 * untouched — surgery on prose risks mangling dual-layer structures.
 */
const ARCHETYPE_TRAIT_RE = /\b(predator(?:y|ial)?|cold(?:ly)?|calculating|calculated|clinical|shrewd|detached|opportunistic|analytical|cunning|icy|glacial|surgical)\b/i;

const enforcePersonalityDiversity = (
    personality: string,
    entityName: string,
    debugLogs: TurnContext['debugLogs'],
): string => {
    // Dual-layer personalities are deliberate structures — never edit them.
    if (/performed surface|actual core/i.test(personality)) return personality;
    const segments = personality.split(/([,;])/); // keep separators
    const archetypeSegs = segments.filter(s => ARCHETYPE_TRAIT_RE.test(s));
    if (archetypeSegs.length < 2) return personality;
    if (!/[,;]/.test(personality)) return personality; // prose — leave alone

    let kept = 0;
    const out: string[] = [];
    for (const seg of segments) {
        if (seg === ',' || seg === ';') { out.push(seg); continue; }
        if (ARCHETYPE_TRAIT_RE.test(seg)) {
            kept++;
            if (kept > 1) continue; // drop archetype traits beyond the first
        }
        out.push(seg);
    }
    const result = out.join('')
        .replace(/[,;]\s*[,;]/g, ',')     // collapse doubled separators
        .replace(/^\s*[,;]\s*|\s*[,;]\s*$/g, '') // trim dangling separators
        .trim();
    if (result !== personality.trim()) {
        debugLogs.push({
            timestamp: new Date().toISOString(),
            message: `[PERSONALITY CAP — v1.24] "${entityName}" arrived with ${archetypeSegs.length} threat-archetype traits; §10 allows one. Trimmed to: "${result}"`,
            type: 'warning',
        });
    }
    return result || personality;
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
                    // v1.24 CRITICAL FIX: merge INTO the existing record instead
                    // of replacing it. The response schema doesn't carry
                    // personality/voice_sample/lifecycle fields, so the old
                    // `{ ...update, id }` replacement silently WIPED canonical
                    // personality every time the model updated an entity — a
                    // primary cause of NPC voice drift in long campaigns.
                    const merged = {
                        ...existingEntity,
                        ...update,
                        id: existingEntity.id,
                    };
                    // Engine-owned fields: an absent/blank update never clears them.
                    if (!merged.personality?.trim()) merged.personality = existingEntity.personality;
                    if (!merged.voice_sample?.trim()) merged.voice_sample = existingEntity.voice_sample;
                    // v1.28: relationship_level is now engine-anchored too. An
                    // omitted value keeps the established relationship instead
                    // of falling through to the schema default, and any value
                    // present is clamped to one rung of movement per turn.
                    merged.relationship_level = clampRelationshipMovement(
                        existingEntity.relationship_level,
                        update.relationship_level,
                        existingEntity.name,
                        ctx.debugLogs,
                    ) ?? existingEntity.relationship_level;
                    merged.status = existingEntity.status;
                    merged.lastSeenTurn = existingEntity.lastSeenTurn;
                    merged.firstSeenTurn = existingEntity.firstSeenTurn;
                    merged.statusChangedTurn = existingEntity.statusChangedTurn;
                    merged.exitReason = existingEntity.exitReason;
                    updatedKnownEntities[existingIdx] = merged;
                } else {
                    // v1.24: New entity — enforce the one-of-four archetype cap
                    // in code before the record enters the registry.
                    const newEntity = { ...update };

                    // v1.28: seed declared relationships. The character sheet
                    // already states who these people are ("Anwen Drevast (twin
                    // sister)"), but nothing carried that into the entity
                    // record, so the player's own family entered the world as
                    // NEUTRAL strangers and stayed there. Only ever raises, never
                    // lowers, and skips relationships described in hostile terms.
                    const declared = declaredRelationshipFor(
                        newEntity.name,
                        ctx.previousCharacter?.relationships ?? [],
                    );
                    if (
                        declared &&
                        RELATIONSHIP_LEVELS.indexOf(newEntity.relationship_level) <
                        RELATIONSHIP_LEVELS.indexOf(DECLARED_RELATIONSHIP_FLOOR)
                    ) {
                        ctx.debugLogs.push({
                            timestamp: new Date().toISOString(),
                            message: `[RELATIONSHIP SEEDED — v1.28] ${newEntity.name}: entered as ` +
                                `${newEntity.relationship_level}, raised to ${DECLARED_RELATIONSHIP_FLOOR} — ` +
                                `declared on the character sheet as "${declared}".`,
                            type: 'info',
                        });
                        newEntity.relationship_level = DECLARED_RELATIONSHIP_FLOOR;
                    }

                    if (newEntity.personality?.trim()) {
                        newEntity.personality = enforcePersonalityDiversity(
                            newEntity.personality,
                            newEntity.name,
                            ctx.debugLogs,
                        );
                    }
                    updatedKnownEntities.push(newEntity);
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
                    // v1.24: Before discarding the loser, rescue canonical
                    // fields the winner lacks. Previously a name-variant
                    // duplicate with a longer impression could win and take
                    // the seed personality down with the discarded record.
                    // Copy-on-write: entity objects are shared with the undo
                    // snapshot, so never mutate them in place.
                    const winnerIdx = keepCurrent ? i : dupKi;
                    const winner = updatedKnownEntities[winnerIdx];
                    const loser = keepCurrent ? other : entity;
                    const rescued = { ...winner };
                    let rescuedAny = false;
                    if (!rescued.personality?.trim() && loser.personality?.trim()) {
                        rescued.personality = loser.personality;
                        rescuedAny = true;
                    }
                    if (!rescued.voice_sample?.trim() && loser.voice_sample?.trim()) {
                        rescued.voice_sample = loser.voice_sample;
                        rescuedAny = true;
                    }
                    if ((rescued.ledger?.length ?? 0) === 0 && (loser.ledger?.length ?? 0) > 0) {
                        rescued.ledger = loser.ledger;
                        rescuedAny = true;
                    }
                    if (rescuedAny) {
                        updatedKnownEntities[winnerIdx] = rescued;
                    }
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

        // -------------------------------------------------------------------
        // v1.29: PLAYER CORRECTIONS BECOME STATE.
        //
        // When the player explicitly rejects how an NPC has been reading them,
        // that used to exist only as prose in the transcript — the model might
        // attend to it on the turn it was said, and nothing carried it forward.
        // In the reviewed save the player corrected the same NPC twice and that
        // NPC's ledger still read, after sixteen turns, ["Initiated a private
        // conversation with the PC."]. Each turn re-derived the same stance
        // from the same inputs and re-escalated.
        //
        // Writing the correction to the ledger puts it in the ACTIVE ENTITIES
        // block of every subsequent prompt, so the NPC has to carry it the way
        // a person carries having been told they misjudged someone.
        // -------------------------------------------------------------------
        const framing = detectPlayerFraming(ctx.playerInput);
        if (framing.corrected) {
            // Attribute to whoever is actually on stage — present/nearby
            // entities the player could plausibly be answering.
            const inScene = updatedKnownEntities.filter(
                e => !e.status || e.status === 'present' || e.status === 'nearby'
            );
            const targets = inScene.length > 0 ? inScene : [];
            const note =
                `T${ctx.currentTurn}: PC pushed back on this NPC's reading of him — ` +
                `"${framing.correctionMarkers[0]}". Do not re-assert that framing.`;

            for (const entity of targets) {
                const ledger = [...(entity.ledger ?? [])];
                // Don't stack near-identical entries turn after turn.
                const alreadyNoted = ledger.some(l => l.includes('pushed back on this NPC'));
                if (alreadyNoted) {
                    ledger[ledger.length - 1] = note;
                } else {
                    ledger.push(note);
                }
                const idx = updatedKnownEntities.findIndex(e => e.id === entity.id);
                if (idx >= 0) updatedKnownEntities[idx] = { ...entity, ledger };
            }

            ctx.debugLogs.push({
                timestamp: new Date().toISOString(),
                message: targets.length > 0
                    ? `[PLAYER CORRECTION — v1.29] Recorded to ledger for ${targets.map(t => t.name).join(', ')}: "${framing.correctionMarkers[0]}". The rejected framing must be dropped, not restated.`
                    : `[PLAYER CORRECTION — v1.29] Detected ("${framing.correctionMarkers[0]}") but no in-scene entity to attribute it to.`,
                type: 'info',
            });
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
