import { WorldTickEvent, DebugLogEntry, DormantHook, FactionExposure, ThreatArcHistory, LoreItem } from '../../types';
import { jaccardSimilarity, significantWords } from '../contentValidation';
import { THREAT_SEED_CAP, MAX_CONSECUTIVE_ETA_ONE, LORE_MATURATION_TURNS, EXPOSURE_THRESHOLD_FOR_THREAT } from '../../config/engineConfig';
import {
    ETA_FLOOR_FACTION, ETA_FLOOR_INDIVIDUAL_NEUTRAL, ETA_FLOOR_INDIVIDUAL_HOME, ETA_FLOOR_ENVIRONMENTAL,
    ETA_FLOOR_COMBAT_INDIVIDUAL, ETA_FLOOR_COMBAT_FACTION, ETA_FLOOR_TENSION_INDIVIDUAL, ETA_FLOOR_TENSION_FACTION,
    PIVOT_DELAY_TURNS, ENTITY_NAME_MATCH_THRESHOLD, PIVOT_JACCARD_THRESHOLD,
    RESEED_BLOCK_TURNS, RESEED_ENTITY_OVERLAP_THRESHOLD, HOOK_RATE_LIMIT_TURNS,
    extractEntityNamesFromDescription, generateThreatId, citesImmatureLore, validateInformationChain,
    checkBannedMechanisms, checkEscalationBudget, OVERLAP_MIN_DEFAULT, OVERLAP_MIN_MEDIUM, OVERLAP_MIN_BROAD, WEAK_OVERLAP_WEIGHT
} from './threatPipeline';

export const validateThreatCausality = (
    threat: WorldTickEvent,
    dormantHooks: DormantHook[],
    factionExposure: FactionExposure,
    currentTurn: number,
    debugLogs: DebugLogEntry[],
    knownEntityNames: string[] = [],
    playerCharacterName: string = ''
): boolean => {
    const log = (msg: string) => debugLogs.push({
        timestamp: new Date().toISOString(),
        message: msg,
        type: 'warning'
    });

    if (threat.turnCreated !== undefined && threat.turnCreated < currentTurn) {
        return true;
    }

    const desc = threat.description.substring(0, 80);

    if (threat.dormantHookId) {
        const hook = dormantHooks.find(h => h.id === threat.dormantHookId);
        if (hook && hook.status !== 'resolved') {
            if (hook.cooldownUntilTurn !== undefined && currentTurn < hook.cooldownUntilTurn) {
                const remaining = hook.cooldownUntilTurn - currentTurn;
                log(
                    `[ORIGIN GATE ✗ — v1.11 HOOK COOLDOWN] "${desc}" — ` +
                    `hook "${hook.id}" is in cooldown until turn ${hook.cooldownUntilTurn} ` +
                    `(${remaining} turns remaining). Previous threat arc from this hook ` +
                    `concluded recently. BLOCKED.`
                );
                return false;
            }

            const threatWords = significantWords(threat.description);
            const hookWords = significantWords(hook.summary);

            let overlapMin = OVERLAP_MIN_DEFAULT;
            if (hookWords.size > 15) overlapMin = OVERLAP_MIN_BROAD;
            else if (hookWords.size > 10) overlapMin = OVERLAP_MIN_MEDIUM;

            let overlapScore = 0;
            const matchedWords: string[] = [];

            for (const word of threatWords) {
                if (hookWords.has(word)) {
                    const isWeak = word.length >= 4 && (
                        word.includes('faction') || word.includes('guild') ||
                        word.includes('city') || word.includes('guard')
                    );
                    overlapScore += isWeak ? WEAK_OVERLAP_WEIGHT : 1;
                    matchedWords.push(word);
                }
            }

            if (overlapScore >= overlapMin) {
                log(`[ORIGIN GATE ✓] "${desc}" — matched dormant hook "${hook.id}" (overlap score ${overlapScore.toFixed(1)} ≥ ${overlapMin}: [${matchedWords.join(', ')}])`);
                return true;
            } else {
                log(`[ORIGIN GATE ✗ — v1.11 SCALED OVERLAP] "${desc}" — cited dormant hook "${hook.id}" but semantic overlap score ${overlapScore.toFixed(1)} is below minimum ${overlapMin} for a hook with ${hookWords.size} significant words. Matched: [${matchedWords.join(', ')}]. BLOCKED.`);
                return false;
            }
        } else {
            log(`[ORIGIN GATE ✗] "${desc}" — cited dormant hook "${threat.dormantHookId}" which does not exist or is resolved. BLOCKED.`);
            return false;
        }
    }

    if (threat.playerActionCause) {
        const causeWords = significantWords(threat.playerActionCause);
        const descWords = significantWords(threat.description);
        const overlap = jaccardSimilarity(causeWords, descWords);

        if (overlap >= 0.1) {
            log(`[ORIGIN GATE ✓] "${desc}" — valid player action cause (overlap: ${overlap.toFixed(2)})`);
            return true;
        } else {
            log(`[ORIGIN GATE ✗] "${desc}" — cited player action cause but description lacks semantic overlap. BLOCKED.`);
            return false;
        }
    }

    if (threat.factionSource) {
        const exposureEntry = factionExposure[threat.factionSource];
        if (exposureEntry && exposureEntry.exposureScore >= EXPOSURE_THRESHOLD_FOR_THREAT) {
            log(`[ORIGIN GATE ✓] "${desc}" — faction "${threat.factionSource}" has sufficient exposure (${exposureEntry.exposureScore} >= ${EXPOSURE_THRESHOLD_FOR_THREAT})`);
            return true;
        } else {
            const currentScore = exposureEntry ? exposureEntry.exposureScore : 0;
            log(`[ORIGIN GATE ✗] "${desc}" — faction "${threat.factionSource}" lacks exposure (${currentScore} < ${EXPOSURE_THRESHOLD_FOR_THREAT}). BLOCKED.`);
            return false;
        }
    }

    log(`[ORIGIN GATE ✗] "${desc}" — no dormantHookId, no playerActionCause, no factionSource with exposure. BLOCKED.`);
    return false;
};

export const processThreatSeeds = (
    incomingThreats: WorldTickEvent[],
    existingThreats: WorldTickEvent[],
    currentTurn: number,
    debugLogs: DebugLogEntry[],
    dormantHooks: DormantHook[] = [],
    factionExposure: FactionExposure = {},
    knownEntityNames: string[] = [],
    playerCharacterName: string = '',
    sceneMode: string = 'NARRATIVE',
    threatArcHistory: ThreatArcHistory = {},
    lore: LoreItem[] = [],
    bannedMechanisms: string[][] = [],
    knownEntities: { name: string; location: string; relationship_level: string }[] = [],
    playerLocation: string = ''
): WorldTickEvent[] => {
    const log = (message: string, type: DebugLogEntry['type'] = 'warning') => {
        debugLogs.push({ timestamp: new Date().toISOString(), message, type });
    };

    const processed: WorldTickEvent[] = incomingThreats.map(threat => {
        let existing = existingThreats.find(t => t.id && t.id === threat.id);

        if (!threat.id && !existing) {
             existing = existingThreats.find(t => {
                const sim = jaccardSimilarity(
                    significantWords(threat.description),
                    significantWords(t.description)
                );
                return sim >= 0.60;
            });
        }

        let entityMatchUsed = false;
        if (!existing) {
            const incomingNames = extractEntityNamesFromDescription(
                threat.description, knownEntityNames, playerCharacterName
            );

            if (incomingNames.length > 0) {
                for (const existingThreat of existingThreats) {
                    const existingNames = existingThreat.entitySourceNames ??
                        extractEntityNamesFromDescription(
                            existingThreat.description, knownEntityNames, playerCharacterName
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

        const id = threat.id || existing?.id || generateThreatId();

        const turnCreated = existing?.turnCreated ?? threat.turnCreated ?? currentTurn;

        const entitySourceNames = existing?.entitySourceNames ??
            extractEntityNamesFromDescription(threat.description, knownEntityNames, playerCharacterName);

        let currentEta = threat.turns_until_impact ?? 0;

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
                currentEta >= 10;

            let floor: number;
            if (sceneMode === 'COMBAT') {
                floor = isFactionThreat ? ETA_FLOOR_COMBAT_FACTION : ETA_FLOOR_COMBAT_INDIVIDUAL;
            } else if (sceneMode === 'TENSION') {
                floor = isFactionThreat ? ETA_FLOOR_TENSION_FACTION : ETA_FLOOR_TENSION_INDIVIDUAL;
            } else {
                floor = isFactionThreat ? ETA_FLOOR_FACTION : ETA_FLOOR_INDIVIDUAL_NEUTRAL;
            }

            if (currentEta < floor) {
                log(
                    `[THREAT ETA ENFORCED] "${threat.description.substring(0, 60)}" bumped ETA ${currentEta} → ${floor} (floor for ${isFactionThreat ? 'faction' : 'individual'} threat, scene: ${sceneMode})`,
                    'warning'
                );
                currentEta = floor;
            }
        }

        if (existing && existing.turns_until_impact !== undefined && turnCreated !== currentTurn) {
            const previousEta = existing.turns_until_impact;
            const expectedMaxEta = Math.max(0, previousEta - 1);

            if (currentEta > expectedMaxEta) {
                const isIncrease = currentEta > previousEta;
                const logLevel = isIncrease ? 'error' : 'warning';
                const violationType = isIncrease ? 'MONOTONIC VIOLATION — ETA INCREASED' : 'ETA COUNTDOWN ENFORCED';

                log(
                    `[THREAT ${violationType}] "${threat.description.substring(0, 60)}" — ` +
                    `AI submitted ETA ${currentEta}, previous was ${previousEta}. ` +
                    `Forced to ${expectedMaxEta}.` +
                    (isIncrease ? ` AI attempted to BUY TIME by increasing ETA — this is always blocked.` : ''),
                    logLevel
                );
                currentEta = expectedMaxEta;
            }
        }

        let lockedDescription = threat.description;
        if (existing && turnCreated !== currentTurn) {
            const descSimilarity = jaccardSimilarity(
                significantWords(threat.description),
                significantWords(existing.description)
            );

            const previousEta = existing.turns_until_impact ?? 999;
            const etaDecreased = currentEta < previousEta;

            if (entityMatchUsed) {
                if (etaDecreased && descSimilarity >= 0.15) {
                    lockedDescription = threat.description;
                    log(
                        `[DESCRIPTION EVOLVED — v1.9] "${threat.description.substring(0, 60)}" ` +
                        `allowed (entity-matched, ETA ${previousEta}→${currentEta}, similarity ${descSimilarity.toFixed(2)} ≥ 0.15)`,
                        'warning'
                    );
                } else {
                    lockedDescription = existing.description;
                    log(
                        `[DESCRIPTION LOCKED — v1.9] "${threat.description.substring(0, 60)}" → ` +
                        `keeping existing: "${existing.description.substring(0, 60)}" ` +
                        `(entity-matched, ETA ${previousEta}→${currentEta}, ` +
                        `similarity ${descSimilarity.toFixed(2)}${!etaDecreased ? ', ETA NOT decreasing' : ', similarity < 0.15'})`,
                        'warning'
                    );
                }
            } else if (descSimilarity >= 0.60) {
                lockedDescription = threat.description;
            } else {
                lockedDescription = existing.description;
            }

            const descriptionWasLocked = lockedDescription === existing.description;
            const alreadyPenalized = existing.pivotPenaltyApplied === currentTurn ||
                (existing.pivotPenaltyApplied !== undefined &&
                 currentTurn - existing.pivotPenaltyApplied < PIVOT_DELAY_TURNS);

            if (descriptionWasLocked && descSimilarity < PIVOT_JACCARD_THRESHOLD && !alreadyPenalized) {
                const pivotEta = Math.max(currentEta, currentEta + PIVOT_DELAY_TURNS);
                log(
                    `[THREAT PIVOT DETECTED — v1.9] AI attempted: "${threat.description.substring(0, 60)}" — ` +
                    `similarity ${descSimilarity.toFixed(2)} < ${PIVOT_JACCARD_THRESHOLD}. ` +
                    `Description locked + adding ${PIVOT_DELAY_TURNS}-turn reaction delay: ` +
                    `ETA ${currentEta} → ${pivotEta}.`,
                    'warning'
                );
                currentEta = pivotEta;
                threat.pivotPenaltyApplied = currentTurn;
            }
        }

        let consecutiveTurnsAtEtaOne = 0;
        if (currentEta <= 1) {
            consecutiveTurnsAtEtaOne = (existing?.consecutiveTurnsAtEtaOne ?? 0) + 1;
        }
        if (currentEta > 1) {
            consecutiveTurnsAtEtaOne = 0;
        }

        let status = threat.status ?? 'building';
        if (currentEta <= 1) status = 'imminent';
        if (currentEta === 0) status = 'triggered';

        if (consecutiveTurnsAtEtaOne >= MAX_CONSECUTIVE_ETA_ONE) {
            log(`[THREAT EXPIRED] "${threat.description.substring(0, 60)}" — stuck at ETA ~1 for ${consecutiveTurnsAtEtaOne} consecutive turns. Auto-expired.`, 'warning');
            status = 'expired';
        }

        return {
            ...threat,
            description: lockedDescription,
            id,
            turnCreated,
            entitySourceNames,
            pivotPenaltyApplied: threat.pivotPenaltyApplied ?? existing?.pivotPenaltyApplied,
            originalEta: existing?.originalEta ?? currentEta,
            consecutiveTurnsAtEtaOne,
            turns_until_impact: currentEta,
            status,
            originHookId: existing?.originHookId ?? threat.dormantHookId,
        };
    });

    const gatePassed = sceneMode === 'COMBAT'
        ? processed
        : processed.filter(threat => {
            if (threat.turnCreated !== currentTurn) return true;

            if (!validateThreatCausality(threat, dormantHooks, factionExposure, currentTurn, debugLogs, knownEntityNames, playerCharacterName)) {
                return false;
            }

            if (citesImmatureLore(threat.description, lore, currentTurn, 1, debugLogs)) {
                log(
                    `[LORE MATURATION BLOCK — v1.12] "${threat.description.substring(0, 60)}" — ` +
                    `relies on lore created within last ${LORE_MATURATION_TURNS} turns. ` +
                    `Lore must mature before it can source threats.`,
                    'error'
                );
                return false;
            }

            if (checkBannedMechanisms(threat.description, bannedMechanisms, debugLogs)) {
                return false;
            }

            if (!validateInformationChain(threat, knownEntities, playerLocation, currentTurn, debugLogs)) {
                return false;
            }

            if (checkEscalationBudget(threat, existingThreats, currentTurn, debugLogs)) {
                return false;
            }

            return true;
        });

    const reseedFiltered = gatePassed.filter(threat => {
        if (threat.turnCreated !== currentTurn) return true;
        const incomingNames = extractEntityNamesFromDescription(
            threat.description, knownEntityNames, playerCharacterName
        );
        if (incomingNames.length === 0) return true;

        for (const [sourceKey, entries] of Object.entries(threatArcHistory)) {
            for (const entry of entries) {
                const turnsSinceExpiry = currentTurn - entry.expiredTurn;
                if (turnsSinceExpiry > RESEED_BLOCK_TURNS) continue;
                const sharedNames = incomingNames.filter(n => entry.entityNames.includes(n));
                if (sharedNames.length >= RESEED_ENTITY_OVERLAP_THRESHOLD) {
                    log(
                        `[ORIGIN GATE ✗ — v1.11 RE-SEED BLOCKED] ` +
                        `"${threat.description.substring(0, 80)}" — shares entity name(s) ` +
                        `[${sharedNames.join(', ')}] with recently expired threat ` +
                        `"${entry.descriptionSnippet}" (expired turn ${entry.expiredTurn}, ` +
                        `${turnsSinceExpiry} turns ago, block window: ${RESEED_BLOCK_TURNS}). ` +
                        `New threats using the same actors are blocked for ${RESEED_BLOCK_TURNS} turns.`,
                        'warning'
                    );
                    return false;
                }
            }
        }
        return true;
    });

    const hookLastCreated: Map<string, number> = new Map();
    for (const t of existingThreats) {
        const hookId = t.originHookId ?? t.dormantHookId;
        if (!hookId) continue;
        const existing = hookLastCreated.get(hookId) ?? 0;
        if ((t.turnCreated ?? 0) > existing) hookLastCreated.set(hookId, t.turnCreated ?? 0);
    }
    const causallyValid = reseedFiltered.filter(threat => {
        if (threat.turnCreated !== currentTurn) return true;
        const hookId = threat.dormantHookId;
        if (!hookId) return true;
        const lastCreated = hookLastCreated.get(hookId);
        if (lastCreated === undefined) return true;
        const gap = currentTurn - lastCreated;
        if (gap < HOOK_RATE_LIMIT_TURNS) {
            log(
                `[HOOK RATE LIMIT — v1.11] "${threat.description.substring(0, 60)}" — ` +
                `hook "${hookId}" already sourced a threat ${gap} turns ago ` +
                `(turn ${lastCreated}). Minimum gap: ${HOOK_RATE_LIMIT_TURNS} turns. BLOCKED.`,
                'warning'
            );
            return false;
        }
        return true;
    });

    const active = causallyValid.filter(t => t.status !== 'expired' && t.status !== 'triggered');

    if (active.length > THREAT_SEED_CAP) {
        log(`[THREAT CAP] ${active.length} seeds (after origin gate) — cap is ${THREAT_SEED_CAP}. Oldest seeds trimmed.`, 'warning');
        active.sort((a, b) => (a.turnCreated ?? 0) - (b.turnCreated ?? 0));
        active.splice(0, active.length - THREAT_SEED_CAP);
    }

    return active;
};
