import { KnownEntity, WorldTickAction, NPCInteraction, WorldTickEvent, DebugLogEntry } from '../../types';
import { ENTITY_NEARBY_DECAY_TURNS, ENTITY_DISTANT_DECAY_TURNS } from '../../config/engineConfig';
import { ENTITY_EXTRACTION_BLACKLIST } from './threatPipeline';

/** Helper to match names loosely */
const nameMatch = (a: string, b: string): boolean => {
    return a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase());
};

// ────────────────────────────────────────────────────────────────────────────
// v1.27: Token-aware name mention detection.
// Narrative rarely uses an NPC's full registry name ("Guildmaster Halric
// Vance") — it says "Halric". The old full-string `includes` check missed
// these, so on-screen NPCs still decayed toward missing. Tokens must be ≥4
// chars and non-blacklisted to keep false positives down.
// ────────────────────────────────────────────────────────────────────────────
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const significantTokens = (name: string): string[] =>
    name
        .replace(/\([^)]*\)/g, '')
        .split(/\s+/)
        .map(p => p.toLowerCase().trim())
        .filter(p => p.length >= 4 && !ENTITY_EXTRACTION_BLACKLIST.has(p));

/** Index of the first mention of this entity in `textLower` (full name
 *  preferred, else any significant token as a whole word). -1 if absent. */
export const nameMentionIndex = (textLower: string, name: string): number => {
    const full = name.toLowerCase().trim();
    if (full) {
        const idx = textLower.indexOf(full);
        if (idx >= 0) return idx;
    }
    for (const tok of significantTokens(name)) {
        const m = new RegExp(`\\b${escapeRe(tok)}\\b`).exec(textLower);
        if (m) return m.index;
    }
    return -1;
};

export const nameMentionedIn = (textLower: string, name: string): boolean =>
    nameMentionIndex(textLower, name) >= 0;

/** Called every turn after entity updates are merged. Updates lastSeenTurn
 *  for entities referenced in this turn's narrative, npc_actions, or
 *  npc_interaction. Returns the updated entity array. */
export const updateEntityPresence = (
    entities: KnownEntity[],
    narrative: string,
    npcActions: WorldTickAction[],
    npcInteraction: NPCInteraction | undefined,
    currentTurn: number,
    playerLocation: string,
    debugLogs: DebugLogEntry[]
): KnownEntity[] => {
    const narrativeLower = narrative.toLowerCase();

    return entities.map(entity => {
        if (entity.status === 'dead' || entity.status === 'retired') return entity;

        // v1.27: ACTIVE participation (acted or spoke) vs mere MENTION.
        // Acting/speaking promotes to present at the player's location, as
        // before. A narrative mention alone refreshes lastSeenTurn — halting
        // decay — but does NOT teleport a distant/missing NPC to the player
        // ("she thought of Halric" must not relocate Halric). Token-aware
        // matching (v1.27) means first-name references now count as seen.
        const activeThisTurn =
            npcActions.some(a => nameMatch(a.npc_name, entity.name)) ||
            (!!npcInteraction && nameMatch(npcInteraction.speaker, entity.name));
        const mentionedThisTurn = activeThisTurn || nameMentionedIn(narrativeLower, entity.name);

        if (activeThisTurn || (mentionedThisTurn && (!entity.status || entity.status === 'present' || entity.status === 'nearby'))) {
            return {
                ...entity,
                lastSeenTurn: currentTurn,
                status: 'present' as const,
                location: playerLocation || entity.location,
                statusChangedTurn: entity.status !== 'present' ? currentTurn : entity.statusChangedTurn
            };
        }

        if (mentionedThisTurn) {
            // Distant/missing but referenced — keep them warm, keep them put.
            return { ...entity, lastSeenTurn: currentTurn };
        }

        return entity;
    });
};

/** Called every turn after updateEntityPresence. Applies automatic
 *  status transitions based on turn counts and location changes. */
export const applyStatusTransitions = (
    entities: KnownEntity[],
    currentTurn: number,
    playerLocation: string,
    previousPlayerLocation: string,
    emergingThreats: WorldTickEvent[],
    debugLogs: DebugLogEntry[]
): KnownEntity[] => {
    const playerMoved = playerLocation !== previousPlayerLocation && playerLocation !== '';
    
    return entities.map(entity => {
        if (entity.status === 'dead' || entity.status === 'retired') {
            return entity; // Terminal states
        }
        
        const turnsSinceSeen = currentTurn - (entity.lastSeenTurn ?? entity.firstSeenTurn ?? 0);
        let newStatus = entity.status ?? 'present';
        
        if (entity.status === 'present' && playerMoved && entity.location !== playerLocation) {
            newStatus = 'nearby';
            debugLogs.push({
                timestamp: new Date().toISOString(),
                type: 'info',
                message: `[Entity Lifecycle] ${entity.name} transitioned to NEARBY (player moved).`
            });
        } else if ((entity.status === 'present' || entity.status === 'nearby') && turnsSinceSeen >= ENTITY_NEARBY_DECAY_TURNS) {
            newStatus = 'distant';
            debugLogs.push({
                timestamp: new Date().toISOString(),
                type: 'info',
                message: `[Entity Lifecycle] ${entity.name} transitioned to DISTANT (${turnsSinceSeen} turns unseen).`
            });
        } else if (entity.status === 'distant' && turnsSinceSeen >= ENTITY_DISTANT_DECAY_TURNS) {
            // Check if they are part of an active threat
            const inActiveThreat = emergingThreats.some(t => 
                t.status !== 'expired' && 
                t.description.toLowerCase().includes(entity.name.toLowerCase())
            );
            
            if (!inActiveThreat) {
                newStatus = 'missing';
                debugLogs.push({
                    timestamp: new Date().toISOString(),
                    type: 'info',
                    message: `[Entity Lifecycle] ${entity.name} transitioned to MISSING (${turnsSinceSeen} turns unseen, no active threats).`
                });
            }
        }
        
        if (newStatus !== entity.status) {
            return {
                ...entity,
                status: newStatus,
                statusChangedTurn: currentTurn
            };
        }
        
        return entity;
    });
};

/** Detects death keywords in entity updates or narrative and applies
 *  terminal status. Returns true if any entity was marked dead. */
export const detectEntityDeaths = (
    entities: KnownEntity[],
    entityUpdates: KnownEntity[] | undefined,
    narrative: string,
    debugLogs: DebugLogEntry[]
): KnownEntity[] => {
    const narrativeLower = narrative.toLowerCase();
    // v1.27: EXPLICIT death phrases only. The old bare-keyword list
    // ('dead', 'corpse', 'killed'...) fired on impressions like "shaken
    // after finding the corpse" or "dead tired" — a primary cause of
    // premade NPCs being randomly killed at scale. Every phrase below
    // asserts a death, not proximity to one.
    const DEATH_UPDATE_PHRASES = [
        'is dead', 'was killed', 'killed by', 'was slain', 'slain by',
        'died', 'dies', 'found dead', 'was executed', 'executed by',
        'perished', 'murdered', 'assassinated', 'fell in battle', 'bled out'
    ];

    return entities.map(entity => {
        if (entity.status === 'dead' || entity.status === 'retired') return entity;

        let isDead = false;
        let reason = '';

        // Check updates
        const update = entityUpdates?.find(u => nameMatch(u.name, entity.name));
        if (update) {
            const impressionLower = update.impression.toLowerCase();
            if (DEATH_UPDATE_PHRASES.some(k => impressionLower.includes(k))) {
                isDead = true;
                reason = `Reported dead in entity update: ${update.impression}`;
            } else if (impressionLower.includes('retired') || impressionLower.includes('departed permanently')) {
                return { ...entity, status: 'retired', exitReason: update.impression };
            }
        }

        // Check narrative for an EXPLICIT kill statement. v1.27: token-aware —
        // "killed Halric" now matches "Guildmaster Halric Vance" — but the
        // phrase must directly bind subject to death within the same clause.
        if (!isDead) {
            const mentionIdx = nameMentionIndex(narrativeLower, entity.name);
            if (mentionIdx >= 0) {
                const nameLower = entity.name.toLowerCase();
                const candidates = [nameLower, ...significantTokens(entity.name)];
                for (const t of candidates) {
                    const safe = escapeRe(t);
                    const explicit = new RegExp(
                        `\\b${safe}\\b[^.!?\\n]{0,40}\\b(?:is dead|was killed|was slain|lies dead|dies|died|perishe[sd]|was executed|bleeds? out)\\b` +
                        `|\\b(?:killed|slew|slays|executed|murdered|cut[s]? down|struck down)\\b[^.!?\\n]{0,40}\\b${safe}\\b`,
                        'i'
                    );
                    if (explicit.test(narrativeLower)) {
                        isDead = true;
                        reason = 'Confirmed kill in narrative.';
                        break;
                    }
                }
            }
        }

        if (isDead) {
            debugLogs.push({
                timestamp: new Date().toISOString(),
                type: 'warning',
                message: `[Entity Lifecycle] ${entity.name} marked as DEAD. Reason: ${reason}`
            });
            return { ...entity, status: 'dead', exitReason: reason };
        }
        
        return entity;
    });
};

/** Validates that the AI is not generating world_tick actions for
 *  dead or retired entities. Used alongside existing NPC coherence. */
export const filterDeadEntityActions = (
    npcActions: WorldTickAction[],
    entities: KnownEntity[],
    debugLogs: DebugLogEntry[]
): WorldTickAction[] => {
    return npcActions.filter(action => {
        const entity = entities.find(e => nameMatch(e.name, action.npc_name));
        if (entity && (entity.status === 'dead' || entity.status === 'retired')) {
            debugLogs.push({
                timestamp: new Date().toISOString(),
                type: 'error',
                message: `[NPC Coherence] Blocked action for ${entity.status} entity: ${action.npc_name}`
            });
            return false;
        }
        return true;
    });
};

/**
 * v1.18: Cross-references lore entries with known entities to detect deaths
 * that the AI recorded in lore but never propagated to entity status.
 * This catches the "retroactive consciousness" pattern where the AI kills
 * an entity in lore but continues generating actions for them via
 * world_tick by inventing workarounds (e.g. "consciousness in stasis").
 */
export const detectLoreDeaths = (
    entities: KnownEntity[],
    lore: { keyword: string; content: string }[],
    debugLogs: DebugLogEntry[]
): KnownEntity[] => {
    // v1.27: 'destroyed' removed — it fired on places and objects ("the
    // eastern bridge was destroyed") in entries that merely mentioned an
    // NPC, killing them. Every phrase below is person-shaped.
    const DEATH_PHRASES = [
        'beaten to death', 'killed by', 'was killed', 'was slain',
        'died', 'found dead', 'executed', 'perished',
        'murdered', 'assassinated', 'fell in battle',
        'mortally wounded', 'bled out'
    ];

    /** v1.27: Death phrase must sit within ±120 chars of the NAME MENTION,
     *  not merely anywhere in the entry. The old anywhere-in-entry check
     *  was the single biggest source of random premade-NPC deaths: any
     *  lore entry containing both a first name and a death phrase —
     *  about anyone — killed that NPC. */
    const PROXIMITY = 120;

    return entities.map(entity => {
        if (entity.status === 'dead' || entity.status === 'retired') return entity;

        const nameLower = entity.name.toLowerCase();

        for (const entry of lore) {
            const contentLower = entry.content.toLowerCase();
            const keywordLower = entry.keyword.toLowerCase();

            const contentIdx = nameMentionIndex(contentLower, entity.name);
            const inKeyword = nameMentionedIn(keywordLower, entity.name);

            if (contentIdx < 0 && !inKeyword) continue;

            let hasDeath = false;
            if (contentIdx >= 0) {
                const win = contentLower.substring(
                    Math.max(0, contentIdx - PROXIMITY),
                    Math.min(contentLower.length, contentIdx + nameLower.length + PROXIMITY)
                );
                hasDeath = DEATH_PHRASES.some(phrase => win.includes(phrase));
            } else {
                // Name appears only in the keyword — the entry is ABOUT them,
                // so a death phrase anywhere in the body counts... unless the
                // entity is canonical, in which case we demand their name in
                // the content too. Seed NPCs don't die on inference.
                hasDeath = !entity.canonical &&
                    DEATH_PHRASES.some(phrase => contentLower.includes(phrase));
            }

            if (hasDeath) {
                debugLogs.push({
                    timestamp: new Date().toISOString(),
                    type: 'warning',
                    message: `[LORE DEATH — v1.18] ${entity.name} marked as DEAD. ` +
                        `Lore entry "${entry.keyword}" contains death language: ` +
                        `"${entry.content.substring(0, 80)}"`
                });
                return {
                    ...entity,
                    status: 'dead' as const,
                    exitReason: `Confirmed dead in lore: ${entry.keyword}`
                };
            }
        }

        return entity;
    });
};

// ============================================================================
// v1.20: Entity/Condition Coherence Validation
// Removes conditions that reference entities whose current status contradicts
// the condition's semantics.
// ============================================================================

/** Condition patterns that imply the referenced entity must be present/accessible. */
const ENTITY_PRESENCE_CONDITIONS: { pattern: RegExp; requiredStatuses: string[] }[] = [
    { pattern: /^Mounted\s*\((.+?)\)/i, requiredStatuses: ['present'] },
    { pattern: /^Beast-Bonded\s*\((.+?)\)/i, requiredStatuses: ['present', 'nearby'] },
    { pattern: /^Guarded by\s*\((.+?)\)/i, requiredStatuses: ['present'] },
    { pattern: /^Accompanied by\s*\((.+?)\)/i, requiredStatuses: ['present'] },
    { pattern: /^Intimacy:\s*(.+?)\s*\(/i, requiredStatuses: ['present'] },
];

export const validateConditionEntityCoherence = (
    conditions: string[],
    entities: { name: string; status: string }[],
    debugLogs: { push: (log: { timestamp: string; message: string; type: string }) => void }
): { conditions: string[]; removed: string[] } => {
    const removed: string[] = [];
    const surviving = conditions.filter(cond => {
        for (const rule of ENTITY_PRESENCE_CONDITIONS) {
            const match = rule.pattern.exec(cond);
            if (!match) continue;

            const referencedNames = match[1].split(/[,&]/).map(n => n.trim().toLowerCase());

            for (const refName of referencedNames) {
                if (refName.length < 3) continue;

                const entity = entities.find(e => {
                    const eName = e.name.toLowerCase();
                    return eName === refName || eName.includes(refName) || refName.includes(eName);
                });

                if (entity && !rule.requiredStatuses.includes(entity.status)) {
                    debugLogs.push({
                        timestamp: new Date().toISOString(),
                        message: `[CONDITION-ENTITY COHERENCE — v1.20] Removed "${cond}" — ` +
                            `entity "${entity.name}" is ${entity.status}, requires: ${rule.requiredStatuses.join('/')}`,
                        type: 'warning'
                    });
                    removed.push(cond);
                    return false;
                }
            }
        }
        return true;
    });

    return { conditions: surviving, removed };
};
