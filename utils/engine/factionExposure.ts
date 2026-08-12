import { FactionExposure, FactionExposureEntry, WorldTickAction, DebugLogEntry, WorldTickEvent } from '../../types';
import {
    EXPOSURE_DECAY_PER_TURN, EXPOSURE_DIRECT_OBSERVATION, EXPOSURE_THRESHOLD_FOR_THREAT, EXPOSURE_PUBLIC_ACTION,
    EXPOSURE_WEIGHT_HOSTILE, EXPOSURE_WEIGHT_COLD, EXPOSURE_WEIGHT_NEUTRAL, EXPOSURE_WEIGHT_ALLIED,
} from '../../config/engineConfig';

/**
 * v1.28: Words that carry no identifying force when matching a threat's
 * `factionSource` against the exposure registry. "House Blackmoor" and
 * "the Blackmoor family" must both resolve to the Blackmoor exposure entry.
 */
const FACTION_STOPWORDS = new Set([
    'house', 'the', 'of', 'and', 'clan', 'family', 'faction', 'order',
    'guild', 'company', 'lord', 'lady', 'duke', 'duchess', 'count',
    'countess', 'king', 'queen', 'prince', 'princess', 'sir', 'dame',
    'baron', 'baroness', 'inquisitor', 'captain', 'guildmaster', 'master',
]);

/** Significant, identity-bearing tokens from a faction or NPC label. */
const factionTokens = (label: string): string[] =>
    label
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 4 && !FACTION_STOPWORDS.has(w));

/**
 * v1.28 FIX — Origin Gate Test C key mismatch.
 *
 * Exposure accrues keyed by the NPC name the world_tick reported
 * ("Lord Veyric Blackmoor"), but the model writes threats with
 * `factionSource: "House Blackmoor"`. Test C did a plain
 * `factionExposure[threat.factionSource]` lookup, so it queried a key that
 * could not exist and Test C never passed for anyone, ever.
 *
 * Resolution order: exact key, then best token-overlap match across the
 * registry (a faction inherits the highest exposure any of its members has
 * earned — one well-observed lieutenant is enough to make the house a
 * credible actor).
 */
export const resolveExposureEntry = (
    factionExposure: FactionExposure,
    factionSource: string,
): { key: string; entry: FactionExposureEntry } | null => {
    if (!factionSource) return null;

    const exact = factionExposure[factionSource];
    if (exact) return { key: factionSource, entry: exact };

    const wanted = factionTokens(factionSource);
    if (wanted.length === 0) return null;

    let best: { key: string; entry: FactionExposureEntry } | null = null;
    for (const [key, entry] of Object.entries(factionExposure)) {
        const shared = factionTokens(key).filter(t => wanted.includes(t));
        if (shared.length === 0) continue;
        if (!best || entry.exposureScore > best.entry.exposureScore) {
            best = { key, entry };
        }
    }
    return best;
};

/**
 * v1.28: how much of a direct observation actually counts as intelligence,
 * given the observer's stance toward the player.
 */
export const exposureWeightFor = (relationshipLevel: string | undefined): number => {
    switch (relationshipLevel) {
        case 'NEMESIS':
        case 'HOSTILE':
            return EXPOSURE_WEIGHT_HOSTILE;
        case 'COLD':
            return EXPOSURE_WEIGHT_COLD;
        case 'WARM':
        case 'ALLIED':
        case 'DEVOTED':
            return EXPOSURE_WEIGHT_ALLIED;
        default:
            return EXPOSURE_WEIGHT_NEUTRAL;
    }
};

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

    // v1.28: relationship lookup for disposition-weighted accrual.
    const relationshipByName = new Map<string, string>();
    for (const e of knownEntities) {
        relationshipByName.set(e.name.toLowerCase(), e.relationship_level);
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

            // v1.28 FIX: weight by the observer's stance. An ally watching the
            // player protectively is not building a dossier on them, and
            // scoring it as if it were is what promoted the player's own
            // family above every antagonist in the world.
            const relationship = relationshipByName.get(key.toLowerCase());
            const weight = exposureWeightFor(relationship);
            const grant = Math.round(EXPOSURE_DIRECT_OBSERVATION * weight);

            if (grant <= 0) {
                debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: `[EXPOSURE SKIPPED — v1.28] ${key} (${relationship ?? 'unknown'}): allied observation earns no exposure — attention is not surveillance.`,
                    type: 'info'
                });
                continue;
            }

            const existing = updated[key] ?? {
                exposureScore: 0,
                lastObservedAction: null,
                lastObservedTurn: 0,
                observedCapabilities: []
            };
            const newScore = Math.min(100, existing.exposureScore + grant);
            updated[key] = {
                ...existing,
                exposureScore: newScore,
                lastObservedAction: action.action,
                lastObservedTurn: currentTurn
            };
            debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[EXPOSURE] ${key}: +${grant} → ${newScore} (direct observation, ${relationship ?? 'unknown'} ×${weight})`,
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
            // v1.20: Expanded keyword list — added common fantasy faction types
            // that were missing (raider, bandit, mercenary, etc.)
            const factionKeywords = ['syndicate', 'vanguard', 'dominion', 'tharnic',
                'guild', 'order', 'company', 'circle', 'cartel', 'brotherhood',
                'sisterhood', 'clan', 'house', 'cult', 'legion', 'cabal',
                'raider', 'raiders', 'bandit', 'bandits', 'mercenary', 'mercenaries',
                'pirate', 'pirates', 'gang', 'horde', 'warband', 'militia',
                'inquisition', 'enclave', 'covenant', 'conclave', 'chapter',
                'pack', 'brood', 'coven', 'consortium', 'alliance', 'faction'];
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

    // v1.28: 'unvalidated' threats still count as an active arc for decay
    // purposes. Before unvalidated threats were retained at all, every
    // gate-rejected threat looked like an arc that had just concluded, so this
    // routine clamped the responsible faction back down to 10 — below
    // EXPOSURE_THRESHOLD_FOR_THREAT — on virtually every turn. Antagonists
    // were being actively pushed out of threat eligibility by the same code
    // meant to stop stale factions lingering.
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
