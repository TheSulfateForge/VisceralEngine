import { KnownEntity, WorldTickAction, NPCInteraction, WorldTickEvent, DebugLogEntry, LocationGraph } from '../../types';
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

// ────────────────────────────────────────────────────────────────────────────
// v1.51: OFF-SCREEN ACTORS ARE NOT IN THE ROOM.
//
// world_tick.npc_actions is mandatory every turn and most entries are
// off-screen ("At the Rivergate warehouse, Cyran drafts a note"). Before
// v1.51 ANY npc_action promoted its NPC to status 'present' AT THE PLAYER'S
// LOCATION. Reviewed saves (2026-11-06): Vesna Kamenova, acting ~90 mi away
// at her Hold, was 'present' in the player's Great Hall; Clara Lorrimer stayed
// 'present' after walking home; Iskra's off-screen ledger work put her at the
// tailor's, and the model squared that with "Iskra sent word you'd be coming."
// The prompt lists 'present' NPCs as being in the scene, so the model wrote
// them arriving instantly.
//
// Now only on-screen participation (a player_visible action that isn't
// tagged as remote, or speaking in npc_interaction) places an NPC with the
// player. Off-screen actions keep the NPC warm but put a present NPC out of
// sight ('nearby'). A visible departure ("left the townhouse") takes the NPC
// out of the scene instead of pinning them in it.
// ────────────────────────────────────────────────────────────────────────────

/** Distance annotations the model attaches to off-screen actions:
 *  "(~1 mi from the Great Hall)", "(~90 mi)", "(~half mile)", "(~20 min from …)". */
const REMOTE_ANNOTATION_RE = /\(\s*~?\s*(?:\d+(?:\.\d+)?|half|quarter|a)\s*(?:-?\s*)(?:mi|mile|miles|km|kilometres?|kilometers?|min|minutes?|hours?|hrs?|days?|leagues?)\b/i;

/** Leading locative: "At the Rivergate warehouse, …" / "In Kamenova Hold …". */
const LEADING_LOCATIVE_RE = /^\s*(?:at|in|inside|outside|near|from)\s+(?:the\s+)?([A-Z][\w'’-]*(?:\s+(?:(?:of|the|de|du|on)\s+)*[A-Z][\w'’-]*)*)/i;

/** The NPC leaves the player's scene this turn. */
const DEPARTURE_RE = /\b(?:left|leaves|leaving|departed|departs|departing|walked\s+(?:back|away|out|off|home)|walks\s+(?:back|away|out|off|home)|went\s+(?:out|back|home|away)|goes\s+(?:out|back|home|away)|rode\s+(?:out|off|away|back|for)|rides\s+(?:out|off|away|back|for)|headed\s+(?:out|back|home)|heads\s+(?:out|back|home)|set\s+off|sets\s+off|took\s+(?:his|her|their)\s+leave|takes\s+(?:his|her|their)\s+leave|saw\s+(?:himself|herself|themselves)\s+out|slipped\s+out)\b/i;

const placeTokens = (s: string): string[] =>
    s.toLowerCase()
        .replace(/[^a-z0-9\s'-]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length >= 4 && !['the', 'with', 'from', 'near'].includes(t));

/** True when a world_tick action describes the NPC somewhere other than the
 *  player's location — by a distance annotation, or by a leading "At X" whose
 *  place shares no significant word with the player's location. */
export const isRemoteAction = (actionText: string, playerLocation: string): boolean => {
    if (REMOTE_ANNOTATION_RE.test(actionText)) return true;
    const lead = LEADING_LOCATIVE_RE.exec(actionText);
    if (lead && lead[1] && /^[A-Z]/.test(lead[1])) {
        const placeT = placeTokens(lead[1]);
        const playerT = new Set(placeTokens(playerLocation));
        if (placeT.length > 0 && !placeT.some(t => playerT.has(t))) return true;
    }
    return false;
};

export const isDepartureAction = (actionText: string): boolean => DEPARTURE_RE.test(actionText);

/** Called every turn after entity updates are merged. Updates lastSeenTurn
 *  for entities referenced in this turn's narrative, npc_actions, or
 *  npc_interaction. Returns the updated entity array.
 *
 *  `previousPlayerLocation` (v1.51): when the player changed location this
 *  turn, a bare narrative mention no longer carries a 'present' NPC along —
 *  only on-screen participation does. */
export const updateEntityPresence = (
    entities: KnownEntity[],
    narrative: string,
    npcActions: WorldTickAction[],
    npcInteraction: NPCInteraction | undefined,
    currentTurn: number,
    playerLocation: string,
    debugLogs: DebugLogEntry[],
    previousPlayerLocation?: string
): KnownEntity[] => {
    const narrativeLower = narrative.toLowerCase();
    const playerMoved =
        previousPlayerLocation !== undefined &&
        playerLocation !== '' &&
        previousPlayerLocation !== playerLocation;

    return entities.map(entity => {
        if (entity.status === 'dead' || entity.status === 'retired') return entity;

        const myActions = npcActions.filter(a => nameMatch(a.npc_name, entity.name));
        // v1.51: an action counts as on-screen only if the model marked it
        // player_visible AND did not place it somewhere else.
        const onScreenActions = myActions.filter(
            a => a.player_visible !== false && !isRemoteAction(a.action ?? '', playerLocation)
        );
        const offScreenActions = myActions.filter(a => !onScreenActions.includes(a));
        const spoke = !!npcInteraction && nameMatch(npcInteraction.speaker, entity.name);
        const departing = onScreenActions.some(a => isDepartureAction(a.action ?? ''));
        const onScreen = (onScreenActions.length > 0 || spoke) && !departing;
        const mentionedThisTurn =
            myActions.length > 0 || spoke || nameMentionedIn(narrativeLower, entity.name);

        // 1. Left the scene on screen → out of the room, still warm.
        if (departing && !spoke) {
            if (entity.status === 'present' || !entity.status) {
                debugLogs.push({
                    timestamp: new Date().toISOString(),
                    type: 'info',
                    message: `[PRESENCE — v1.51] ${entity.name} left the scene → nearby (no longer in the room).`
                });
            }
            return {
                ...entity,
                lastSeenTurn: currentTurn,
                status: 'nearby' as const,
                location: entity.location === playerLocation ? `left ${playerLocation}` : entity.location,
                statusChangedTurn: entity.status !== 'nearby' ? currentTurn : entity.statusChangedTurn
            };
        }

        // 2. On screen (acted visibly here, or spoke) → present with the player.
        if (onScreen) {
            return {
                ...entity,
                lastSeenTurn: currentTurn,
                status: 'present' as const,
                location: playerLocation || entity.location,
                statusChangedTurn: entity.status !== 'present' ? currentTurn : entity.statusChangedTurn
            };
        }

        // 3. Acted off screen only → keep warm; if the registry had them in the
        //    room, the model has now put them elsewhere: out of sight.
        if (offScreenActions.length > 0) {
            if (entity.status === 'present' || !entity.status) {
                debugLogs.push({
                    timestamp: new Date().toISOString(),
                    type: 'info',
                    message: `[PRESENCE — v1.51] ${entity.name} acted off screen ("${(offScreenActions[0].action ?? '').slice(0, 60)}") → nearby, not placed with the player.`
                });
                return {
                    ...entity,
                    lastSeenTurn: currentTurn,
                    status: 'nearby' as const,
                    location: entity.location === playerLocation ? '' : entity.location,
                    statusChangedTurn: currentTurn
                };
            }
            return { ...entity, lastSeenTurn: currentTurn };
        }

        // 4. Mentioned only. A present NPC stays present while the player
        //    stays put; if the player moved, a mention doesn't carry them.
        //    Nearby/distant/missing NPCs are never promoted by a mention
        //    ("she thought of Halric" must not relocate Halric — v1.27).
        if (mentionedThisTurn) {
            if ((entity.status === 'present' || !entity.status) && !playerMoved) {
                return {
                    ...entity,
                    lastSeenTurn: currentTurn,
                    status: 'present' as const,
                    location: playerLocation || entity.location,
                };
            }
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
        } else if (entity.status === 'distant' && turnsSinceSeen >= ENTITY_DISTANT_DECAY_TURNS
            // v1.54: someone at a KNOWN place is not missing — they are where
            // the record says. (Lyssara, an ambassador at her own house in
            // Caerveld, went MISSING after eight turns off screen.)
            && !(entity.location ?? '').trim()) {
            // Check if they are part of an active threat
            const inActiveThreat = emergingThreats.some(t =>
                t.status !== 'expired' &&
                // v1.28: an unvalidated anchor is not an active threat and must
                // not keep an otherwise-forgotten entity pinned in the roster.
                t.status !== 'unvalidated' &&
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

// ────────────────────────────────────────────────────────────────────────────
// v1.54: AN NPC IN ANOTHER TOWN IS NOT 'NEARBY'.
//
// Westcross save: Lady Mirabel's off-screen action "Rides home to Sablebrook
// Manor" put her at Sablebrook Manor — but her status stayed 'nearby' (same
// building, out of the room). The scene digest lists 'nearby' as present, so
// at turn 56 she was "present" in the player's townhouse bath, and since every
// off-screen action refreshes lastSeenTurn she never decayed to distant.
//
// Rule: a present/nearby NPC whose location is a KNOWN place (a location-graph
// node) sharing no place word with the player's location is 'distant'.
// Unknown or bare room names ("Solarium") are left alone — too ambiguous.
// ────────────────────────────────────────────────────────────────────────────
const placeWords = (s: string): Set<string> => new Set(placeTokens((s ?? '').replace(/^left\s+/i, '')));
const stripThe = (s: string) => s.trim().replace(/^the\s+/i, '').toLowerCase();

export const demoteRemoteNearby = (
    entities: KnownEntity[],
    graph: LocationGraph | undefined,
    playerLocation: string,
    currentTurn: number,
    debugLogs: DebugLogEntry[],
): KnownEntity[] => {
    if (!playerLocation.trim()) return entities;
    const known = new Set(
        Object.values(graph?.nodes ?? {})
            .flatMap(n => {
                const name = stripThe(n.displayName ?? '');
                // "Westcross Townhouse, Caerveld" / "X — Garden" also count by their root
                const root = name.split(/\s*(?:—|–|,)\s*/)[0];
                return [name, root];
            })
            .filter(Boolean),
    );
    const player = placeWords(playerLocation);
    return entities.map(e => {
        if (e.status !== 'present' && e.status !== 'nearby') return e;
        const loc = (e.location ?? '').trim();
        if (!loc || /^left\s+/i.test(loc)) return e;
        if (!known.has(stripThe(loc))) return e;
        const theirs = placeWords(loc);
        if (theirs.size === 0 || [...theirs].some(t => player.has(t))) return e;
        debugLogs.push({
            timestamp: new Date().toISOString(),
            type: 'info',
            message: `[PRESENCE — v1.54] ${e.name} is at ${loc}, not with the player at ${playerLocation} → DISTANT.`,
        });
        return { ...e, status: 'distant' as const, statusChangedTurn: currentTurn };
    });
};
