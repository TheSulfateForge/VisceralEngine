import { FactionExposure, WorldTickAction, DebugLogEntry, WorldTickEvent } from '../../types';
import { EXPOSURE_DECAY_PER_TURN, EXPOSURE_DIRECT_OBSERVATION, EXPOSURE_THRESHOLD_FOR_THREAT, EXPOSURE_PUBLIC_ACTION } from '../../config/engineConfig';

/**
 * Updates the faction exposure registry each turn based on world_tick NPC actions.
 * Called BEFORE processThreatSeeds so same-turn exposure is available for validation.
 */
export const updateFactionExposure_v112 = (
    currentExposure: FactionExposure,
    npcActions: WorldTickAction[],
    currentTurn: number,
    debugLogs: DebugLogEntry[],
    // v1.12: New parameters for hostile faction tracking
    knownEntities: { name: string; role: string; relationship_level: string }[] = [],
    emergingThreats: WorldTickEvent[] = []
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

    // -----------------------------------------------------------------------
    // v1.12 FIX SE-2: Auto-grant exposure to hostile factions engaged in combat
    // -----------------------------------------------------------------------
    // When the player fights entities belonging to a hostile faction, that faction
    // gains exposure through the combat itself (the player is demonstrating
    // capabilities in front of faction members). This closes the gap where
    // factionExposure stayed empty despite extensive conflict.

    // Build a map of hostile faction keywords from knownEntities
    const hostileFactions: Map<string, string> = new Map(); // keyword → faction display name
    for (const entity of knownEntities) {
        if (['HOSTILE', 'NEMESIS'].includes(entity.relationship_level)) {
            const roleLower = entity.role.toLowerCase();
            // Extract faction-like keywords from the role
            const factionKeywords = ['syndicate', 'vanguard', 'dominion', 'tharnic',
                'guild', 'order', 'company', 'circle', 'cartel', 'brotherhood',
                'sisterhood', 'clan', 'house', 'cult', 'legion', 'cabal'];
            for (const kw of factionKeywords) {
                if (roleLower.includes(kw) || entity.name.toLowerCase().includes(kw)) {
                    // Use the keyword as the faction identifier
                    const factionName = entity.name.split('(')[0].trim();
                    hostileFactions.set(kw, factionName);
                }
            }
        }
    }

    // Check if any threat descriptions or NPC actions reference hostile factions
    for (const threat of emergingThreats) {
        if (threat.factionSource) {
            // Ensure the factionSource has an exposure entry
            if (!updated[threat.factionSource]) {
                updated[threat.factionSource] = {
                    exposureScore: 0,
                    lastObservedAction: null,
                    lastObservedTurn: 0,
                    observedCapabilities: []
                };
            }
        }
        // Auto-grant exposure when a threat from this faction is actively building
        const descLower = threat.description.toLowerCase();
        for (const [kw, factionName] of hostileFactions) {
            if (descLower.includes(kw)) {
                const key = threat.factionSource || factionName;
                const existing = updated[key] ?? {
                    exposureScore: 0,
                    lastObservedAction: null,
                    lastObservedTurn: 0,
                    observedCapabilities: []
                };
                // Only auto-grant if below threshold — don't keep inflating
                if (existing.exposureScore < EXPOSURE_THRESHOLD_FOR_THREAT) {
                    const grant = EXPOSURE_PUBLIC_ACTION;
                    const newScore = Math.min(100, existing.exposureScore + grant);
                    updated[key] = {
                        ...existing,
                        exposureScore: newScore,
                        lastObservedAction: `Hostile faction active: ${threat.description.substring(0, 60)}`,
                        lastObservedTurn: currentTurn
                    };
                    debugLogs.push({
                        timestamp: new Date().toISOString(),
                        message: `[EXPOSURE — v1.12] ${key}: +${grant} → ${newScore} (hostile faction active in threats)`,
                        type: 'info'
                    });
                }
            }
        }
    }

    // Also grant exposure from hostile NPC actions (hidden or visible) that
    // describe intelligence gathering, reporting, or tracking
    const INTEL_VERBS = ['track', 'report', 'scout', 'surveil', 'dispatch', 'alert',
        'signal', 'inform', 'relay', 'mark', 'log', 'document', 'photograph'];
    for (const action of npcActions) {
        const actionLower = action.action.toLowerCase();
        const npcNameLower = action.npc_name.toLowerCase();

        // Check if this NPC belongs to a known hostile faction
        for (const [kw, factionName] of hostileFactions) {
            if (npcNameLower.includes(kw) || actionLower.includes(kw)) {
                const hasIntelVerb = INTEL_VERBS.some(v => actionLower.includes(v));
                if (hasIntelVerb) {
                    const key = factionName;
                    const existing = updated[key] ?? {
                        exposureScore: 0,
                        lastObservedAction: null,
                        lastObservedTurn: 0,
                        observedCapabilities: []
                    };
                    const grant = 5; // Smaller than direct observation
                    const newScore = Math.min(100, existing.exposureScore + grant);
                    updated[key] = {
                        ...existing,
                        exposureScore: newScore,
                        lastObservedAction: action.action,
                        lastObservedTurn: currentTurn
                    };
                    debugLogs.push({
                        timestamp: new Date().toISOString(),
                        message: `[EXPOSURE — v1.12] ${key}: +${grant} → ${newScore} (hostile NPC intel action: ${action.npc_name})`,
                        type: 'info'
                    });
                }
            }
        }
    }

    return updated;
};

/**
 * v1.11 FIX 7: When ALL threats from a faction expire and no threat entities
 * from that faction remain active, aggressively decay faction exposure.
 */
export const decayFactionExposureOnArcConclusion = (
    factionExposure: FactionExposure,
    previousThreats: WorldTickEvent[],
    currentThreats: WorldTickEvent[],
    currentTurn: number,
    debugLogs: DebugLogEntry[]
): FactionExposure => {
    const updated = { ...factionExposure };

    const currentFactions = new Set(
        currentThreats.map(t => t.factionSource).filter(Boolean)
    );
    const expiredFactions = new Set(
        previousThreats
            .filter(t => t.factionSource && !currentFactions.has(t.factionSource))
            .map(t => t.factionSource!)
    );

    for (const faction of expiredFactions) {
        const stillActive = currentThreats.some(t =>
            t.description.toLowerCase().includes(faction.toLowerCase())
        );
        if (stillActive) continue;

        const entry = updated[faction];
        if (!entry || entry.exposureScore <= 5) continue;

        const newScore = Math.min(entry.exposureScore, 10);
        debugLogs.push({
            timestamp: new Date().toISOString(),
            message: `[EXPOSURE DECAY — v1.11] ${faction}: ${entry.exposureScore} → ${newScore} ` +
                `(all threats from this faction have expired — aggressive decay below threshold)`,
            type: 'info'
        });

        updated[faction] = { ...entry, exposureScore: newScore };
    }

    return updated;
};
