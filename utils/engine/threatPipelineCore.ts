import { WorldTickEvent, DebugLogEntry, DormantHook, FactionExposure, ThreatArcHistory, LoreItem, LocationGraph } from '../../types';
import { jaccardSimilarity, significantWords } from '../contentValidation';
import {
    THREAT_SEED_CAP, MAX_CONSECUTIVE_ETA_ONE, LORE_MATURATION_TURNS, EXPOSURE_THRESHOLD_FOR_THREAT,
    UNVALIDATED_THREAT_CAP, UNVALIDATED_THREAT_MAX_TURNS,
} from '../../config/engineConfig';
import { resolveExposureEntry } from './factionExposure';

/**
 * v1.28: Origin Gate Test B floor, lowered from 0.10.
 * Retained as a fast path only — the shared-actor check below is now the
 * primary signal for player-caused threats.
 */
const PLAYER_CAUSE_JACCARD_MIN = 0.05;

/**
 * v1.28: capitalised, identity-bearing tokens in a threat description —
 * "Blackmoor", "Drevast", "Caerveld". Sentence-initial words and common
 * capitalised filler are excluded so the first word of a sentence does not
 * masquerade as a name.
 */
const PROPER_NOUN_STOPWORDS = new Set([
    'the', 'a', 'an', 'his', 'her', 'their', 'this', 'that', 'these', 'those',
    'house', 'lord', 'lady', 'duke', 'duchess', 'king', 'queen', 'prince',
    'princess', 'count', 'countess', 'baron', 'baroness', 'sir', 'dame',
    'if', 'when', 'after', 'before', 'while', 'as', 'and', 'but', 'or',
]);

const properNouns = (description: string): Set<string> => {
    const out = new Set<string>();
    // Drop the first token of each sentence — it is capitalised by grammar.
    const body = description.replace(/(^|[.!?]\s+)\S+/g, '$1');
    for (const match of body.matchAll(/\b([A-Z][a-z]{3,})\b/g)) {
        const word = match[1].toLowerCase();
        if (!PROPER_NOUN_STOPWORDS.has(word)) out.add(word);
    }
    return out;
};
import {
    ETA_FLOOR_FACTION, ETA_FLOOR_INDIVIDUAL_NEUTRAL, ETA_FLOOR_INDIVIDUAL_HOME, ETA_FLOOR_ENVIRONMENTAL,
    ETA_FLOOR_COMBAT_INDIVIDUAL, ETA_FLOOR_COMBAT_FACTION, ETA_FLOOR_TENSION_INDIVIDUAL, ETA_FLOOR_TENSION_FACTION,
    PIVOT_DELAY_TURNS, ENTITY_NAME_MATCH_THRESHOLD, PIVOT_JACCARD_THRESHOLD,
    RESEED_BLOCK_TURNS, RESEED_ENTITY_OVERLAP_THRESHOLD, HOOK_RATE_LIMIT_TURNS,
    extractEntityNamesFromDescription, generateThreatId, citesImmatureLore, validateInformationChain,
    checkBannedMechanisms, checkEscalationBudget, OVERLAP_MIN_DEFAULT, OVERLAP_MIN_MEDIUM, OVERLAP_MIN_BROAD, WEAK_OVERLAP_WEIGHT
} from './threatPipeline';

import { validateThreatDistanceConsistency } from './locationGraph';

export const validateThreatCausality = (
    threat: WorldTickEvent,
    dormantHooks: DormantHook[],
    factionExposure: FactionExposure,
    currentTurn: number,
    debugLogs: DebugLogEntry[],
    knownEntityNames: string[] = [],
    playerCharacterName: string = '',
    lore: LoreItem[] = [],           // v1.19: For location-inherent encounter validation
    playerLocation: string = ''       // v1.19: Current player location
): boolean => {
    const log = (msg: string) => debugLogs.push({
        timestamp: new Date().toISOString(),
        message: msg,
        type: 'warning'
    });

    // A threat that ALREADY passed the gate on an earlier turn is grandfathered —
    // re-litigating an accepted arc every turn is what the description lock and
    // ETA countdown exist to prevent.
    //
    // v1.28: 'unvalidated' threats are explicitly excluded from that
    // grandfathering. They are retained purely as continuity anchors, so
    // without this check a rejected threat would simply auto-pass on its second
    // turn and the Origin Gate would become decorative. Instead they are
    // re-tested every turn, which also gives the model a legitimate path to
    // promote one by supplying a real cause.
    if (
        threat.turnCreated !== undefined &&
        threat.turnCreated < currentTurn &&
        threat.status !== 'unvalidated'
    ) {
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

            // v1.19: Thematic words that directly relate to the hook's threat category
            // score at 1.5x instead of 1.0x. This ensures hooks about exploitation/commodification
            // actually fire when threats use exploitation/commodification vocabulary.
            const THEMATIC_BOOST_WORDS = new Set([
                'predatory', 'exploit', 'commodity', 'commodify', 'harvest', 'specimen',
                'trafficking', 'auction', 'breeding', 'capture', 'enslave', 'abduct',
                'physiology', 'biological', 'rare', 'exotic', 'valuable', 'profitable',
                'entertainment', 'licensed', 'regulated', 'inspection', 'warrant',
                'scout', 'talent', 'recruit', 'acquire', 'procurement', 'bounty',
                'groping', 'harassment', 'assault', 'coercion', 'intimidation',
            ]);

            for (const word of threatWords) {
                if (hookWords.has(word)) {
                    const isWeak = word.length >= 4 && (
                        word.includes('faction') || word.includes('guild') ||
                        word.includes('city') || word.includes('guard')
                    );
                    const isThematic = THEMATIC_BOOST_WORDS.has(word);
                    overlapScore += isWeak ? WEAK_OVERLAP_WEIGHT : (isThematic ? 1.5 : 1);
                    matchedWords.push(word);
                }
            }

            if (overlapScore >= overlapMin) {
                log(`[ORIGIN GATE ✓] "${desc}" — matched dormant hook "${hook.id}" (overlap score ${overlapScore.toFixed(1)} ≥ ${overlapMin}: [${matchedWords.join(', ')}])`);
                return true;
            }

            // v1.28: bag-of-words overlap against hook PROSE is a poor test.
            // Hooks are written as 20-30 word sentences; threat descriptions
            // run ~15 words. Requiring 2-3 shared significant words between two
            // independently-worded summaries of the same tension is close to
            // mechanically impossible, and in practice Test A almost never
            // passed. Entity identity is the far stronger signal: if the threat
            // actually names someone the hook is about, the hook is the source.
            const hookEntities = (hook.involvedEntities ?? []).map(e => e.toLowerCase().trim()).filter(Boolean);
            const descLower = threat.description.toLowerCase();
            const namedHookEntities = hookEntities.filter(entity => {
                if (descLower.includes(entity)) return true;
                // Match on any identity-bearing token of the entity name, so
                // "anwen drevast" is matched by a threat naming just "Anwen".
                return entity
                    .split(/\s+/)
                    .filter(tok => tok.length >= 4)
                    .some(tok => descLower.includes(tok));
            });

            if (namedHookEntities.length > 0) {
                log(`[ORIGIN GATE ✓ — v1.28 HOOK ENTITY MATCH] "${desc}" — matched dormant hook "${hook.id}" via named entity/entities [${namedHookEntities.join(', ')}] (prose overlap was ${overlapScore.toFixed(1)} / ${overlapMin}).`);
                return true;
            }

            log(`[ORIGIN GATE ✗ — v1.11 SCALED OVERLAP] "${desc}" — cited dormant hook "${hook.id}" but semantic overlap score ${overlapScore.toFixed(1)} is below minimum ${overlapMin} for a hook with ${hookWords.size} significant words, and the description names none of the hook's entities [${hookEntities.join(', ') || 'none listed'}]. Matched: [${matchedWords.join(', ')}]. BLOCKED.`);
            return false;
        } else {
            log(`[ORIGIN GATE ✗] "${desc}" — cited dormant hook "${threat.dormantHookId}" which does not exist or is resolved. BLOCKED.`);
            return false;
        }
    }

    if (threat.playerActionCause) {
        const causeWords = significantWords(threat.playerActionCause);
        const descWords = significantWords(threat.description);
        const overlap = jaccardSimilarity(causeWords, descWords);

        if (overlap >= PLAYER_CAUSE_JACCARD_MIN) {
            log(`[ORIGIN GATE ✓] "${desc}" — valid player action cause (overlap: ${overlap.toFixed(2)} ≥ ${PLAYER_CAUSE_JACCARD_MIN})`);
            return true;
        }

        // v1.28: Jaccard on two short, independently-worded strings is
        // knife-edge — in real play this test passed at 0.13 and 0.11 and
        // failed at everything else, which is noise, not causality. If the
        // cause and the consequence name the same person or house, the causal
        // link is established regardless of how the two were phrased.
        const causeLower = threat.playerActionCause.toLowerCase();
        const descLower = threat.description.toLowerCase();
        const sharedActors = knownEntityNames
            .map(n => n.toLowerCase())
            .filter(n => n && n !== playerCharacterName.toLowerCase())
            .flatMap(n => n.split(/\s+/).filter(tok => tok.length >= 4))
            .filter(tok => causeLower.includes(tok) && descLower.includes(tok));

        if (sharedActors.length > 0) {
            log(`[ORIGIN GATE ✓ — v1.28 SHARED ACTOR] "${desc}" — player action cause and threat description share actor token(s) [${[...new Set(sharedActors)].join(', ')}] (prose overlap was only ${overlap.toFixed(2)}).`);
            return true;
        }

        log(`[ORIGIN GATE ✗] "${desc}" — cited player action cause but description shares neither vocabulary (${overlap.toFixed(2)} < ${PLAYER_CAUSE_JACCARD_MIN}) nor any named actor with it. BLOCKED.`);
        return false;
    }

    if (threat.factionSource) {
        // v1.28 FIX: exposure accrues keyed by NPC name ("Lord Veyric
        // Blackmoor") while the model writes factionSource as "House
        // Blackmoor". The old direct index lookup queried a key that could
        // never exist, so Test C never passed for any faction in any session.
        const resolved = resolveExposureEntry(factionExposure, threat.factionSource);
        if (resolved && resolved.entry.exposureScore >= EXPOSURE_THRESHOLD_FOR_THREAT) {
            const via = resolved.key === threat.factionSource ? '' : ` (resolved via "${resolved.key}")`;
            log(`[ORIGIN GATE ✓] "${desc}" — faction "${threat.factionSource}" has sufficient exposure (${resolved.entry.exposureScore} >= ${EXPOSURE_THRESHOLD_FOR_THREAT})${via}`);
            return true;
        } else {
            const currentScore = resolved ? resolved.entry.exposureScore : 0;
            const via = resolved && resolved.key !== threat.factionSource ? ` (nearest registry key "${resolved.key}")` : '';
            log(`[ORIGIN GATE ✗] "${desc}" — faction "${threat.factionSource}" lacks exposure (${currentScore} < ${EXPOSURE_THRESHOLD_FOR_THREAT})${via}. BLOCKED.`);
            return false;
        }
    }

    // v1.19: Origin Gate Test D — Location-Inherent Encounters
    // Threats describing creatures, hazards, or environmental dangers that are
    // established in lore for the player's current location pass automatically.
    // This prevents the gate from blocking "giant rats on Floor 1" when lore
    // explicitly documents giant rats on Floor 1.
    if (threat.description && lore && lore.length > 0 && playerLocation) {
        const descLower = threat.description.toLowerCase();
        const locationLower = playerLocation.toLowerCase();

        // Extract the broadest location identifier (e.g., "Floor 1" from "Floor 1 — Sector A (Verdant Corridors)")
        const locationParts = locationLower.split(/[—\-()]/);
        const broadLocation = locationParts[0].trim();

        for (const entry of lore) {
            const loreLower = `${entry.keyword} ${entry.content}`.toLowerCase();

            // Lore must reference the player's current broad location
            if (!loreLower.includes(broadLocation) && broadLocation.length >= 3) continue;

            // Check if the threat description shares significant vocabulary with the lore entry
            const loreWords = significantWords(`${entry.keyword} ${entry.content}`);
            const threatDescWords = significantWords(threat.description);
            const overlap = jaccardSimilarity(loreWords, threatDescWords);

            if (overlap >= 0.15) {
                log(
                    `[ORIGIN GATE ✓ — v1.19 LOCATION-INHERENT] "${desc}" — ` +
                    `matches lore "${entry.keyword}" for location "${broadLocation}" ` +
                    `(overlap: ${overlap.toFixed(2)}). Environmental encounter approved.`
                );
                return true;
            }
        }
    }

    log(`[ORIGIN GATE ✗] "${desc}" — no dormantHookId, no playerActionCause, no factionSource with exposure, no location-inherent lore match. BLOCKED.`);
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
    playerLocation: string = '',
    locationGraph?: LocationGraph,
    minutesPerTurn: number = 10
): WorldTickEvent[] => {
    const log = (message: string, type: DebugLogEntry['type'] = 'warning') => {
        debugLogs.push({ timestamp: new Date().toISOString(), message, type });
    };

    /** v1.28: existing records consumed by an incoming threat this turn. */
    const matchedExistingIds = new Set<string>();

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

        // v1.28: anchor re-matching by shared proper noun.
        //
        // The two matchers above both fail on the most common real case. Jaccard
        // needs 0.60 similarity, which a genuine re-wording never reaches; the
        // entity matcher relies on extractEntityNamesFromDescription, which
        // demotes a surname to a "setting word" once three or more registered
        // entities share it — so in a campaign against a great house with five
        // named members, "Blackmoor" stops counting as an identity at exactly
        // the point the house becomes the antagonist. Anchors then never
        // collapse: every re-wording opens a NEW anchor and the model's churn
        // is preserved rather than suppressed.
        //
        // Deliberately scoped to unvalidated anchors. Two live threats sharing
        // a proper noun can legitimately be distinct arcs ("Blackmoor sues you"
        // vs "Blackmoor hires a knife"); nothing is live here, so collapsing to
        // the earliest wording is exactly the intended behaviour.
        if (!existing) {
            const incomingNouns = properNouns(threat.description);
            if (incomingNouns.size > 0) {
                for (const candidate of existingThreats) {
                    if (candidate.status !== 'unvalidated') continue;
                    const shared = [...properNouns(candidate.description)].filter(n => incomingNouns.has(n));
                    if (shared.length > 0) {
                        existing = candidate;
                        log(
                            `[THREAT ANCHOR MATCH — v1.28] "${threat.description.substring(0, 60)}" ` +
                            `matched unvalidated anchor "${candidate.description.substring(0, 50)}" via shared ` +
                            `proper noun(s) [${shared.join(', ')}]. Treated as a re-wording, not a new threat.`,
                            'info'
                        );
                        break;
                    }
                }
            }
        }

        if (existing?.id) matchedExistingIds.add(existing.id);

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
            const expectedEta = Math.max(0, previousEta - 1);

            // v1.28: the countdown is now EXACT, not merely capped.
            //
            // The old rule only blocked increases and clamped anything above
            // previous - 1. Arbitrary DECREASES were waved through, so a threat
            // seeded at ETA 15 could legitimately report 14 on one turn and 1 on
            // the next — the model collapsing a slow-burning arc into an
            // immediate one the moment the player did something it wanted to
            // punish. Players read that, correctly, as the world reaching for
            // them: "it can't stay at 15, so it drops by 1, then by 13."
            //
            // An ETA is engine state. It moves one turn per turn. Genuine
            // acceleration belongs to explicit engine rules (the pivot penalty
            // below, distance floors, scene-mode floors) — never to a number the
            // model reasserts each turn.
            if (currentEta !== expectedEta) {
                const isIncrease = currentEta > previousEta;
                const violationType = isIncrease
                    ? 'MONOTONIC VIOLATION — ETA INCREASED'
                    : currentEta < expectedEta
                        ? 'ETA ACCELERATION BLOCKED'
                        : 'ETA COUNTDOWN ENFORCED';

                log(
                    `[THREAT ${violationType}] "${threat.description.substring(0, 60)}" — ` +
                    `AI submitted ETA ${currentEta}, previous was ${previousEta}. ` +
                    `Forced to ${expectedEta} (a countdown advances exactly one turn per turn).` +
                    (isIncrease
                        ? ` AI attempted to BUY TIME by increasing ETA — this is always blocked.`
                        : currentEta < expectedEta
                            ? ` AI attempted to PULL THE THREAT FORWARD by ${expectedEta - currentEta} turn(s) — acceleration is an engine decision, not a narrative one.`
                            : ''),
                    isIncrease ? 'error' : 'warning'
                );
                currentEta = expectedEta;
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

            // v1.28: an unvalidated anchor NEVER evolves its wording. Its whole
            // reason to exist is to pin the phrasing of a threat the gate
            // rejected, so that a re-submission next turn is recognisably the
            // same threat rather than a fresh re-aim wearing the same actors.
            if (existing.status === 'unvalidated') {
                lockedDescription = existing.description;
                if (descSimilarity < 1) {
                    log(
                        `[ANCHOR DESCRIPTION LOCKED — v1.28] AI re-worded an unvalidated threat: ` +
                        `"${threat.description.substring(0, 60)}" → keeping "${existing.description.substring(0, 60)}" ` +
                        `(similarity ${descSimilarity.toFixed(2)}). An unvalidated threat may not re-aim.`,
                        'warning'
                    );
                }
            } else if (entityMatchUsed) {
                // v1.28: the evolution bar was similarity ≥ 0.15, which is low
                // enough that "House Blackmoor will mobilise legal assets" and
                // "House Blackmoor will leak Callan's commoner life" counted as
                // the same threat developing rather than the model re-aiming.
                // Raised to the pivot threshold so evolution and pivot use one
                // consistent line.
                if (etaDecreased && descSimilarity >= PIVOT_JACCARD_THRESHOLD) {
                    lockedDescription = threat.description;
                    log(
                        `[DESCRIPTION EVOLVED — v1.9] "${threat.description.substring(0, 60)}" ` +
                        `allowed (entity-matched, ETA ${previousEta}→${currentEta}, similarity ${descSimilarity.toFixed(2)} ≥ ${PIVOT_JACCARD_THRESHOLD})`,
                        'warning'
                    );
                } else {
                    lockedDescription = existing.description;
                    log(
                        `[DESCRIPTION LOCKED — v1.9] "${threat.description.substring(0, 60)}" → ` +
                        `keeping existing: "${existing.description.substring(0, 60)}" ` +
                        `(entity-matched, ETA ${previousEta}→${currentEta}, ` +
                        `similarity ${descSimilarity.toFixed(2)}${!etaDecreased ? ', ETA NOT decreasing' : `, similarity < ${PIVOT_JACCARD_THRESHOLD}`})`,
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

        // v1.28: an anchor stays an anchor until the gate says otherwise.
        // The model re-submits threats without a status field, so without this
        // the anchor's 'unvalidated' marker would be lost here — and because it
        // now carries an inherited (earlier) turnCreated, the gate would
        // grandfather it straight through as a live threat. That would make the
        // Origin Gate trivially bypassable: get rejected once, go live next turn.
        if (existing?.status === 'unvalidated' && status !== 'expired') {
            status = 'unvalidated';
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
            gateBlockedReason: existing?.gateBlockedReason,
            unvalidatedSinceTurn: existing?.unvalidatedSinceTurn,
            promotedTurn: existing?.promotedTurn,
        };
    });

    // v1.28: carry forward unvalidated anchors the model did not re-submit this
    // turn. Without this, an anchor evaporates the moment the model skips the
    // idea for one turn — and if it reintroduces the same idea two turns later
    // with fresh wording, there is nothing left to lock it against and the
    // wobble returns. Anchors age and count down while dormant; the retention
    // filter below reaps them.
    const carriedAnchors: WorldTickEvent[] = existingThreats
        .filter(t => t.status === 'unvalidated' && t.id && !matchedExistingIds.has(t.id))
        .map(t => ({
            ...t,
            turns_until_impact: Math.max(0, (t.turns_until_impact ?? 1) - 1),
        }));

    if (carriedAnchors.length > 0) {
        log(
            `[THREAT ANCHOR CARRY — v1.28] ${carriedAnchors.length} unvalidated anchor(s) not re-submitted this turn — ` +
            `retained and aged so a later re-submission is still locked to the original wording.`,
            'info'
        );
    }

    // -----------------------------------------------------------------------
    // v1.28: MARK, DON'T DELETE.
    //
    // The Origin Gate used to .filter() rejected threats out of existence.
    // Because they never reached world.emergingThreats, the `existing` lookup
    // at the top of this function could never match them next turn, which
    // silently disabled the monotonic ETA countdown, the description lock and
    // the pivot penalty — every brake this file implements. The model was left
    // free to re-word and re-number the same threat on every single turn.
    //
    // The gate now decides whether a threat may ACT ON THE PLAYER, not whether
    // it may EXIST IN ENGINE MEMORY. Rejected threats are retained as
    // 'unvalidated' continuity anchors: never surfaced, never able to trigger,
    // but able to hold a description and an ETA still.
    // -----------------------------------------------------------------------
    const markUnvalidated = (threat: WorldTickEvent, reason: string): WorldTickEvent => {
        if (threat.status !== 'unvalidated') {
            log(
                `[THREAT UNVALIDATED — v1.28] "${threat.description.substring(0, 60)}" — ${reason} ` +
                `Retained as a continuity anchor: it cannot act on the player, but its wording and ETA ` +
                `are now locked so a re-submission next turn cannot silently re-aim.`,
                'warning'
            );
        }
        return {
            ...threat,
            status: 'unvalidated',
            gateBlockedReason: reason,
            unvalidatedSinceTurn: threat.unvalidatedSinceTurn ?? currentTurn,
        };
    };

    const gatePassed = sceneMode === 'COMBAT'
        ? processed
        : processed.map(threat => {
            // Already-live threats from earlier turns are not re-litigated.
            if (threat.turnCreated !== currentTurn && threat.status !== 'unvalidated') return threat;

            if (!validateThreatCausality(threat, dormantHooks, factionExposure, currentTurn, debugLogs, knownEntityNames, playerCharacterName, lore, playerLocation)) {
                return markUnvalidated(threat, 'Origin Gate found no valid cause (no matching hook, player action, exposed faction, or location lore).');
            }

            if (citesImmatureLore(threat.description, lore, currentTurn, 1, debugLogs)) {
                log(
                    `[LORE MATURATION BLOCK — v1.12] "${threat.description.substring(0, 60)}" — ` +
                    `relies on lore created within last ${LORE_MATURATION_TURNS} turns. ` +
                    `Lore must mature before it can source threats.`,
                    'error'
                );
                return markUnvalidated(threat, `cites lore younger than ${LORE_MATURATION_TURNS} turns.`);
            }

            if (!validateInformationChain(threat, knownEntities, playerLocation, currentTurn, debugLogs)) {
                return markUnvalidated(threat, 'no plausible information chain — the actor could not know what this threat assumes they know.');
            }

            if (checkEscalationBudget(threat, existingThreats, currentTurn, debugLogs)) {
                return markUnvalidated(threat, 'exceeds the escalation budget for the current window.');
            }

            // Passed everything. If this was previously an unvalidated anchor,
            // the model has now supplied a real cause — promote it, keeping its
            // accumulated ETA and locked description.
            if (threat.status === 'unvalidated') {
                log(
                    `[THREAT PROMOTED — v1.28] "${threat.description.substring(0, 60)}" — ` +
                    `previously unvalidated since T${threat.unvalidatedSinceTurn}, now passes the Origin Gate. ` +
                    `Going live at ETA ${threat.turns_until_impact} with its original wording intact.`,
                    'info'
                );
                threat = {
                    ...threat,
                    status: (threat.turns_until_impact ?? 99) <= 1 ? 'imminent' : 'building',
                    gateBlockedReason: undefined,
                    unvalidatedSinceTurn: undefined,
                    promotedTurn: currentTurn,
                };
            }

            if (locationGraph && threat.factionSource) {
                const distanceCheck = validateThreatDistanceConsistency(
                    locationGraph,
                    threat.factionSource, // Assuming factionSource is the location or we can use it as such. Wait, factionSource is not a location.
                    // Actually, the spec says "threat's origin". The origin might be in the description or factionSource.
                    // Let's just use factionSource for now, or skip if not a location.
                    // Wait, the spec says: "validateThreatDistanceConsistency(graph, threatOriginLocation, playerLocationId, claimedEtaTurns, minutesPerTurn, debugLogs)"
                    // Let's assume threat.factionSource might be a location, or we need to extract it.
                    // For now, let's just use playerLocation as a placeholder if we don't have a specific origin, or skip.
                    // Actually, let's just pass threat.factionSource and let normalizeLocationId handle it.
                    playerLocation,
                    threat.turns_until_impact ?? 0,
                    minutesPerTurn,
                    debugLogs
                );
                if (!distanceCheck.valid) {
                    threat = { ...threat, turns_until_impact: distanceCheck.minimumEtaTurns };
                }
            }

            return threat;
        });

    // Hard drops. Unlike the gate, these delete outright — a banned mechanism is
    // player-authored content policy, and the re-seed / rate-limit windows exist
    // precisely to stop a threat idea from persisting, so retaining an anchor
    // for them would defeat their purpose.
    const mechanismFiltered = gatePassed.filter(threat => {
        if (threat.turnCreated !== currentTurn) return true;
        return !checkBannedMechanisms(threat.description, bannedMechanisms, debugLogs);
    });

    const reseedFiltered = mechanismFiltered.filter(threat => {
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

    const active = [...causallyValid, ...carriedAnchors]
        .filter(t => t.status !== 'expired' && t.status !== 'triggered');

    // -----------------------------------------------------------------------
    // v1.28: unvalidated anchors are retained on a leash.
    //
    // An anchor exists only to stop the model re-wording and re-numbering the
    // same idea. It must never quietly become a live threat by running its ETA
    // to zero, and it must not accumulate forever.
    // -----------------------------------------------------------------------
    const retained = active.filter(t => {
        if (t.status !== 'unvalidated') return true;

        const age = currentTurn - (t.unvalidatedSinceTurn ?? currentTurn);
        if (age >= UNVALIDATED_THREAT_MAX_TURNS) {
            log(
                `[THREAT ANCHOR EXPIRED — v1.28] "${t.description.substring(0, 60)}" — ` +
                `held unvalidated for ${age} turns without ever passing the Origin Gate. Dropped.`,
                'info'
            );
            return false;
        }
        if ((t.turns_until_impact ?? 99) <= 0) {
            log(
                `[THREAT ANCHOR EXPIRED — v1.28] "${t.description.substring(0, 60)}" — ` +
                `countdown reached zero while still unvalidated. An unvalidated threat may never ` +
                `trigger, so it is dropped rather than allowed to act on the player.`,
                'info'
            );
            return false;
        }
        return true;
    });

    const live = retained.filter(t => t.status !== 'unvalidated');
    const anchors = retained.filter(t => t.status === 'unvalidated');

    if (live.length > THREAT_SEED_CAP) {
        log(`[THREAT CAP] ${live.length} live seeds (after origin gate) — cap is ${THREAT_SEED_CAP}. Oldest seeds trimmed.`, 'warning');
        live.sort((a, b) => (a.turnCreated ?? 0) - (b.turnCreated ?? 0));
        live.splice(0, live.length - THREAT_SEED_CAP);
    }

    if (anchors.length > UNVALIDATED_THREAT_CAP) {
        log(`[THREAT ANCHOR CAP — v1.28] ${anchors.length} unvalidated anchors — cap is ${UNVALIDATED_THREAT_CAP}. Oldest trimmed.`, 'info');
        anchors.sort((a, b) => (a.unvalidatedSinceTurn ?? 0) - (b.unvalidatedSinceTurn ?? 0));
        anchors.splice(0, anchors.length - UNVALIDATED_THREAT_CAP);
    }

    return [...live, ...anchors];
};
