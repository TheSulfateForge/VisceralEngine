import { WorldTickEvent, DebugLogEntry, DormantHook, FactionExposure, ThreatArcHistory, LoreItem } from '../../types';
import { jaccardSimilarity, significantWords } from '../contentValidation';
import {
    THREAT_SEED_CAP, MAX_CONSECUTIVE_ETA_ONE, LORE_MATURATION_TURNS,
    ESCALATION_BUDGET_MAX, ESCALATION_WINDOW_TURNS, INFO_PROPAGATION_MIN_TURNS,
    EXPOSURE_THRESHOLD_FOR_THREAT
} from '../../config/engineConfig';
import { isMessengerThreat } from './npcCoherence';

export const ETA_FLOOR_FACTION = 15;
export const ETA_FLOOR_INDIVIDUAL_NEUTRAL = 5;
export const ETA_FLOOR_INDIVIDUAL_HOME = 3;
export const ETA_FLOOR_ENVIRONMENTAL = 2;

export const ETA_FLOOR_COMBAT_INDIVIDUAL = 1;
export const ETA_FLOOR_COMBAT_FACTION = 3;
export const ETA_FLOOR_TENSION_INDIVIDUAL = 2;
export const ETA_FLOOR_TENSION_FACTION = 5;

export const PIVOT_DELAY_TURNS = 2;
export const ENTITY_NAME_MATCH_THRESHOLD = 1;
export const PIVOT_JACCARD_THRESHOLD = 0.35;

export const RESEED_BLOCK_TURNS = 10;
export const RESEED_ENTITY_OVERLAP_THRESHOLD = 1;

export const OVERLAP_MIN_DEFAULT = 2;
export const OVERLAP_MIN_MEDIUM = 3;
export const OVERLAP_MIN_BROAD = 4;
export const WEAK_OVERLAP_WEIGHT = 0.5;

export const HOOK_COOLDOWN_BASE = 8;
export const HOOK_COOLDOWN_ESCALATION = 4;
export const HOOK_COOLDOWN_MAX = 20;
export const HOOK_RATE_LIMIT_TURNS = 5;

export const ENTITY_EXTRACTION_BLACKLIST = new Set([
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

export const extractEntityNamesFromDescription = (
    description: string,
    knownEntityNames: string[] = [],
    playerCharacterName: string = ''
): string[] => {
    const names: Set<string> = new Set();
    const descLower = description.toLowerCase();

    const playerNameParts = new Set(
        playerCharacterName.toLowerCase().split(/\s+/).filter(p => p.length >= 3)
    );

    const partFrequency: Map<string, number> = new Map();
    for (const entityName of knownEntityNames) {
        const primary = entityName.split('(')[0].trim().toLowerCase();
        const parts = primary.split(/\s+/).filter(p => p.length >= 3 && !ENTITY_EXTRACTION_BLACKLIST.has(p));
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

    for (const entityName of knownEntityNames) {
        const primary = entityName.split('(')[0].trim().toLowerCase();
        if (primary.length < 3) continue;

        const primaryParts = primary.split(/\s+/);

        const firstSignificantPart = primaryParts.find(p => p.length >= 3 && !ENTITY_EXTRACTION_BLACKLIST.has(p));
        const isPlayerName = firstSignificantPart !== undefined && playerNameParts.has(firstSignificantPart);
        if (isPlayerName) continue;

        if (primaryParts.every(part => ENTITY_EXTRACTION_BLACKLIST.has(part))) continue;

        const significantParts = primaryParts.filter(part =>
            part.length >= 3 && !ENTITY_EXTRACTION_BLACKLIST.has(part)
        );
        const identityParts = significantParts.filter(part => !settingWords.has(part));
        const settingOnlyParts = significantParts.filter(part => settingWords.has(part));

        if (significantParts.length === 0) continue;

        if (identityParts.length > 0) {
            if (identityParts.some(part => descLower.includes(part))) {
                names.add(primary);
            }
        } else if (settingOnlyParts.length > 0) {
            const fullPhrase = significantParts.join(' ');
            if (fullPhrase.length >= 6 && descLower.includes(fullPhrase)) {
                names.add(primary);
            }
        }
    }

    const quotedNames = description.match(/['']([A-Z][^'']{2,30})['']|"([A-Z][^"]{2,30})"/g);
    if (quotedNames) {
        for (const match of quotedNames) {
            const cleaned = match.replace(/[''""]/g, '').trim().toLowerCase();
            const parts = cleaned.split(/\s+/);
            if (!parts.every(p => ENTITY_EXTRACTION_BLACKLIST.has(p))) {
                names.add(cleaned);
            }
        }
    }

    return Array.from(names);
};

export const generateThreatId = (): string =>
    `threat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const citesImmatureLore = (
    threatDescription: string,
    lore: LoreItem[],
    currentTurn: number,
    turnsPerLoreEntry: number,
    debugLogs: DebugLogEntry[]
): boolean => {
    const threatWords = significantWords(threatDescription);

    for (const entry of lore) {
        const loreCreatedTurn = entry.turnCreated ?? 0;
        const turnsOld = currentTurn - loreCreatedTurn;

        if (turnsOld >= LORE_MATURATION_TURNS) continue;

        const loreWords = significantWords(`${entry.keyword} ${entry.content}`);
        const overlap = jaccardSimilarity(threatWords, loreWords);

        if (overlap >= 0.35) {
            debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[LORE MATURATION — v1.12] Threat "${threatDescription.substring(0, 60)}" ` +
                    `cites immature lore "${entry.keyword}" (created ${turnsOld} turns ago, ` +
                    `minimum: ${LORE_MATURATION_TURNS}). Overlap: ${overlap.toFixed(2)}`,
                type: 'warning'
            });
            return true;
        }
    }

    return false;
};

export const validateInformationChain = (
    threat: WorldTickEvent,
    knownEntities: { name: string; location: string; relationship_level: string }[],
    playerLocation: string,
    currentTurn: number,
    debugLogs: DebugLogEntry[]
): boolean => {
    if (!threat.playerActionCause) return true;

    const cause = threat.playerActionCause.toLowerCase();

    const observerMatch = /^([^"]+?)\s+observed\s+/i.exec(threat.playerActionCause);
    if (!observerMatch) {
        debugLogs.push({
            timestamp: new Date().toISOString(),
            message: `[INFO CHAIN — v1.12] "${threat.description.substring(0, 60)}" — ` +
                `playerActionCause does not follow required format: ` +
                `"[NPC] observed [action] at [location] on turn [N]". BLOCKED.`,
            type: 'error'
        });
        return false;
    }

    const claimedObserver = observerMatch[1].trim();

    const observerEntity = knownEntities.find(e => {
        const primaryName = e.name.split('(')[0].trim().toLowerCase();
        return primaryName.includes(claimedObserver.toLowerCase()) ||
            claimedObserver.toLowerCase().includes(primaryName);
    });

    if (!observerEntity) {
        debugLogs.push({
            timestamp: new Date().toISOString(),
            message: `[INFO CHAIN — v1.12] "${threat.description.substring(0, 60)}" — ` +
                `claimed observer "${claimedObserver}" NOT FOUND in entity registry. ` +
                `NPCs cannot observe events if they don't exist. BLOCKED.`,
            type: 'error'
        });
        return false;
    }

    const turnMatch = /turn\s+(\d+)/i.exec(threat.playerActionCause);
    if (turnMatch) {
        const observedTurn = parseInt(turnMatch[1]);
        const turnsSince = currentTurn - observedTurn;
        const eta = threat.turns_until_impact ?? 0;

        if (turnsSince < INFO_PROPAGATION_MIN_TURNS && eta < INFO_PROPAGATION_MIN_TURNS) {
            debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[INFO CHAIN — v1.12] "${threat.description.substring(0, 60)}" — ` +
                    `observed on turn ${observedTurn}, current turn ${currentTurn}. ` +
                    `Only ${turnsSince} turns for info propagation (min: ${INFO_PROPAGATION_MIN_TURNS}). ` +
                    `ETA ${eta} is too fast for an organized response. Bumping ETA to ${INFO_PROPAGATION_MIN_TURNS}.`,
                type: 'warning'
            });
            threat.turns_until_impact = Math.max(eta, INFO_PROPAGATION_MIN_TURNS);
        }
    }

    return true;
};

export const checkBannedMechanisms = (
    text: string,
    bannedMechanisms: string[][],
    debugLogs: DebugLogEntry[]
): boolean => {
    if (!bannedMechanisms || bannedMechanisms.length === 0) return false;

    const textWords = significantWords(text);

    for (const bannedWords of bannedMechanisms) {
        const bannedSet = new Set(bannedWords);
        const overlap = [...textWords].filter(w => bannedSet.has(w));
        const overlapRatio = bannedSet.size > 0 ? overlap.length / bannedSet.size : 0;

        if (overlapRatio >= 0.60) {
            debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[BANNED MECHANISM — v1.12] Text "${text.substring(0, 60)}" ` +
                    `matches banned concept [${bannedWords.join(', ')}] ` +
                    `(${(overlapRatio * 100).toFixed(0)}% overlap). BLOCKED.`,
                type: 'error'
            });
            return true;
        }
    }

    return false;
};

export const extractBannedMechanismFromRejection = (
    rejectionText: string,
    threatDescription: string
): string[] => {
    const combined = `${rejectionText} ${threatDescription}`;
    return [...significantWords(combined)];
};

export const checkEscalationBudget = (
    threat: WorldTickEvent,
    existingThreats: WorldTickEvent[],
    currentTurn: number,
    debugLogs: DebugLogEntry[]
): boolean => {
    const determineTier = (desc: string): number => {
        const d = desc.toLowerCase();
        if (d.includes('elite') || d.includes('dragon') || d.includes('state-level') || d.includes('army')) return 5;
        if (d.includes('faction') || d.includes('guild') || d.includes('order') || d.includes('syndicate')) return 3;
        if (d.includes('pair') || d.includes('team') || d.includes('squad') || d.includes('group')) return 2;
        return 1;
    };

    const incomingTier = determineTier(threat.description);

    const windowStart = currentTurn - ESCALATION_WINDOW_TURNS;
    const recentThreats = existingThreats.filter(t => (t.turnCreated ?? 0) >= windowStart);

    let currentWindowTotal = 0;
    for (const t of recentThreats) {
        currentWindowTotal += determineTier(t.description);
    }

    const totalAfter = currentWindowTotal + incomingTier;

    if (totalAfter > ESCALATION_BUDGET_MAX) {
        debugLogs.push({
            timestamp: new Date().toISOString(),
            message: `[ESCALATION BUDGET ✗ — v1.12] "${threat.description.substring(0, 40)}" — ` +
                `tier ${incomingTier} pushes window total to ${totalAfter} (max ${ESCALATION_BUDGET_MAX}). ` +
                `Too many threats escalating too quickly. BLOCKED.`,
            type: 'error'
        });
        return true;
    }

    debugLogs.push({
        timestamp: new Date().toISOString(),
        message: `[ESCALATION BUDGET — v1.12] "${threat.description.substring(0, 40)}" — ` +
            `tier ${incomingTier}, window total: ${totalAfter}/${ESCALATION_BUDGET_MAX}`,
        type: 'info'
    });

    return false;
};

/**
 * v1.17: Extracts probable entity name fragments from a threat description
 * by finding capitalized multi-word phrases (proper nouns).
 * Returns lowercase fragments for matching against the denial tracker.
 */
export const extractProperNounFragments = (description: string): string[] => {
    const COMMON_WORDS = new Set([
        'the', 'a', 'an', 'is', 'are', 'was', 'were', 'has', 'have', 'had',
        'will', 'would', 'could', 'should', 'may', 'might', 'can', 'shall',
        'do', 'does', 'did', 'been', 'being', 'having', 'if', 'then', 'else',
        'but', 'and', 'or', 'not', 'no', 'so', 'for', 'yet', 'nor',
        'new', 'old', 'first', 'last', 'next', 'this', 'that', 'these',
        'origin', 'gate', 'test', 'hook', 'action', 'faction', 'exposure',
        'eta', 'threat', 'status', 'building', 'blocked',
    ]);

    const fragments: string[] = [];

    // Match sequences of capitalized words (potential entity names)
    const matches = description.match(
        /\b[A-Z][a-z]+(?:[-'][A-Z][a-z]+)*(?:\s+[A-Z][a-z]+(?:[-'][A-Z][a-z]+)*)*/g
    );
    if (!matches) return fragments;

    for (const match of matches) {
        const parts = match.toLowerCase().split(/[\s\-']+/).filter(
            p => p.length >= 3 && !COMMON_WORDS.has(p)
        );
        if (parts.length >= 2) {
            fragments.push(parts.join(' '));
        }
        for (const part of parts) {
            if (part.length >= 4) {
                fragments.push(part);
            }
        }
    }

    return [...new Set(fragments)];
};
