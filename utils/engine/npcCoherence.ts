import { WorldTickAction, WorldTickEvent, DebugLogEntry, KnownEntity } from '../../types';
import { NPC_ATTRITION_CHANCE } from '../../config/engineConfig';
import { ENTITY_EXTRACTION_BLACKLIST, extractEntityNamesFromDescription } from './threatPipeline';

// v1.10: De facto combat detection — verbs in NPC actions that indicate actual combat
// regardless of the AI's stated scene_mode. If the scene contains these, it IS combat.
export const COMBAT_ACTION_VERBS = new Set([
    'attack', 'attacks', 'attacked', 'attacking',
    'shoot', 'shoots', 'shot', 'shooting',
    'fire', 'fires', 'fired', 'firing',
    'charge', 'charges', 'charged', 'charging',
    'strike', 'strikes', 'struck', 'striking',
    'slash', 'slashes', 'slashed', 'slashing',
    'stab', 'stabs', 'stabbed', 'stabbing',
    'volley', 'volleys',
    'trample', 'tramples', 'trampled', 'trampling',
    'lance', 'lances', 'lanced', 'lancing',
    'cleave', 'cleaves', 'cleaved', 'cleaving',
    'kill', 'kills', 'killed', 'killing',
    'execute', 'executes', 'executed', 'executing',
    'impale', 'impales', 'impaled', 'impaling',
    'decapitate', 'decapitates', 'decapitated',
    'disembowel', 'disembowels', 'disemboweled',
    'crushes', 'crushed', 'crushing',
    'smash', 'smashes', 'smashed', 'smashing',
]);

// Broader patterns that indicate combat context (multi-word or participial)
export const COMBAT_ACTION_PATTERNS = [
    /\b(?:draws?\s+(?:sword|weapon|bow|blade|knife|dagger|crossbow|lance|mace))/i,
    /\b(?:fire[sd]?\s+(?:arrow|bolt|volley|crossbow))/i,
    /\b(?:cavalry\s+charge)/i,
    /\b(?:heavy\s+cavalry)/i,
    /\b(?:prepare[sd]?\s+(?:to\s+)?(?:fire|attack|charge|strike|execute))/i,
    /\b(?:aim|aims|aimed|aiming)\s+(?:at|toward)/i,
    /\b(?:lunge[sd]?|leaps?|lunges?)\s+(?:at|toward|into)/i,
    /\b(?:arrows?\s+(?:hit|strike|land|lodge|sprout|pierce))/i,
    /\b(?:incendiary|fire-?arrow|alchemical\s+fire)/i,
    /\b(?:shred|shredding|rend|rending|tear|tearing|rip|ripping)\s/i,
    /\b(?:crossbow|longbow|shortbow|ballista|catapult|trebuchet)/i,
];

// v1.10: Messenger threat patterns — threats where an entity is traveling away
// to deliver information. These require full entity suppression until ETA <= 2.
export const MESSENGER_PATTERNS = [
    /\bfleeing\s+toward/i,
    /\bheading\s+toward/i,
    /\btraveling\s+to/i,
    /\brunning\s+to/i,
    /\briding\s+to/i,
    /\bsprinting\s+toward/i,
    /\bfleeing\s+to/i,
    /\bescaping\s+to/i,
    /\breporting\s+to/i,
    /\bmaking\s+(?:his|her|their|its)\s+way\s+to/i,
    /\bheading\s+(?:for|to)\b/i,
    /\bwith\s+news\s+of/i,
];

export const GENERIC_ROLE_WORDS = new Set([
    'agent', 'scout', 'guard', 'captain', 'leader', 'archer', 'tracker',
    'buyer', 'seller', 'merchant', 'soldier', 'warrior', 'mage', 'priest',
    'hunter', 'spy', 'thief', 'assassin', 'knight', 'sergeant', 'commander',
    'dead', 'alive', 'former', 'current', 'surviving', 'escaped', 'backup',
]);

/**
 * Examines NPC actions for combat verbs and patterns. If actual combat is
 * happening (arrows firing, cavalry charging, melee fighting), returns 'COMBAT'
 * regardless of the AI's stated scene_mode. This closes the critical gap where
 * the AI labels active combat as TENSION, preventing the engine's COMBAT
 * bypasses from activating.
 *
 * Only UPGRADES scene mode (TENSION → COMBAT). Never downgrades COMBAT → TENSION.
 */
export const getEffectiveSceneMode = (
    statedMode: string,
    npcActions: WorldTickAction[],
    debugLogs: DebugLogEntry[]
): string => {
    // If already COMBAT, no override needed
    if (statedMode === 'COMBAT') return 'COMBAT';

    // Only upgrade TENSION → COMBAT (not NARRATIVE/SOCIAL)
    if (statedMode !== 'TENSION') return statedMode;

    // Check NPC actions for combat activity
    let combatActionCount = 0;
    for (const action of npcActions) {
        const actionLower = action.action.toLowerCase();
        const words = actionLower.split(/\s+/);

        // Check individual combat verbs
        if (words.some(w => COMBAT_ACTION_VERBS.has(w))) {
            combatActionCount++;
            continue;
        }

        // Check multi-word combat patterns
        if (COMBAT_ACTION_PATTERNS.some(p => p.test(action.action))) {
            combatActionCount++;
        }
    }

    if (combatActionCount > 0) {
        debugLogs.push({
            timestamp: new Date().toISOString(),
            message: `[SCENE MODE OVERRIDE — v1.10] AI stated mode is TENSION, but ` +
                `${combatActionCount} NPC action(s) contain explicit combat verbs/patterns. ` +
                `Upgrading effective scene_mode to COMBAT.`,
            type: 'warning'
        });
        return 'COMBAT';
    }

    return statedMode;
};

/**
 * v1.10: Identifies if a threat is a "messenger" threat — an entity traveling
 * away to deliver information. These require special coherence handling because
 * the entity is physically elsewhere and cannot take local actions.
 */
export const isMessengerThreat = (threat: WorldTickEvent): boolean => {
    const descLower = threat.description.toLowerCase();
    return MESSENGER_PATTERNS.some(p => p.test(descLower));
};

/**
 * v1.10: Detects if allied/bonded NPCs are standing idle while hostile combat
 * actions are occurring. This indicates the AI is forgetting to manage the
 * player's companions during a fight.
 *
 * Returns an array of passive ally names.
 */
export const detectAlliedPassivity = (
    npcActions: WorldTickAction[],
    knownEntities: { name: string; relationship_level: string }[],
    effectiveSceneMode: string,
    debugLogs: DebugLogEntry[]
): string[] => {
    if (effectiveSceneMode !== 'COMBAT') return [];

    // Identify allies present in the scene (based on knownEntities)
    const allies = knownEntities.filter(e =>
        ['BONDED', 'COMPANION', 'ALLY'].includes(e.relationship_level)
    );
    if (allies.length === 0) return [];

    // Count hostile combat actions
    let hostileCombatActions = 0;
    for (const action of npcActions) {
        // Is this a hostile NPC?
        const isHostile = knownEntities.some(e =>
            ['HOSTILE', 'NEMESIS'].includes(e.relationship_level) &&
            (action.npc_name.toLowerCase().includes(e.name.toLowerCase()) ||
                e.name.toLowerCase().includes(action.npc_name.toLowerCase()))
        );

        if (isHostile) {
            const actionLower = action.action.toLowerCase();
            const words = actionLower.split(/\s+/);
            if (words.some(w => COMBAT_ACTION_VERBS.has(w)) ||
                COMBAT_ACTION_PATTERNS.some(p => p.test(action.action))) {
                hostileCombatActions++;
            }
        }
    }

    // If no hostile combat actions, passivity doesn't matter
    if (hostileCombatActions === 0) return [];

    const passiveAllies: string[] = [];

    // Check if allies are taking combat actions
    for (const ally of allies) {
        const allyActions = npcActions.filter(a =>
            a.npc_name.toLowerCase().includes(ally.name.toLowerCase()) ||
            ally.name.toLowerCase().includes(a.npc_name.toLowerCase())
        );

        // If the ally took NO actions, or only non-combat actions
        const allPassive = allyActions.length === 0 || allyActions.every(a =>
            !a.action.toLowerCase().split(/\s+/).some(w => COMBAT_ACTION_VERBS.has(w)) &&
            !COMBAT_ACTION_PATTERNS.some(p => p.test(a.action))
        );

        if (allPassive) {
            passiveAllies.push(ally.name);
        }
    }

    if (passiveAllies.length > 0) {
        debugLogs.push({
            timestamp: new Date().toISOString(),
            message: `[ALLIED PASSIVITY — v1.10] ${hostileCombatActions} hostile combat actions this turn, ` +
                `but allied NPC(s) [${passiveAllies.join(', ')}] are PASSIVE. ` +
                `Allied NPCs with standing combat orders should be actively fighting.`,
            type: 'error'
        });
    }

    return passiveAllies;
};

/**
 * Validates that world_tick NPC actions don't contradict emerging threat ETAs.
 *
 * The AI's primary bypass vector is: set an emerging_threat with ETA 15, then
 * use npc_actions to show the threat already arriving/acting locally. This
 * validator detects when a hidden NPC action references terms/entities from
 * an emerging threat whose ETA is still > coherence threshold, and blocks those actions.
 *
 * v1.9: Scene-mode awareness.
 *   COMBAT: Skip coherence entirely — all NPCs are in-scene.
 *   TENSION: Check only hidden actions with threshold ETA > 1.
 *   NARRATIVE/SOCIAL: Check BOTH visible and hidden actions for entities
 *     linked to distant threats. This closes the vector where the AI marks
 *     a messenger's arrival as player_visible to bypass the check.
 *     Threshold: ETA > 1 for arrival actions.
 */
export const validateNpcActionCoherence = (
    npcActions: WorldTickAction[],
    emergingThreats: WorldTickEvent[],
    currentTurn: number,
    debugLogs: DebugLogEntry[],
    sceneMode: string = 'NARRATIVE'   // v1.9
): WorldTickAction[] => {
    const log = (msg: string, type: DebugLogEntry['type'] = 'warning') => {
        debugLogs.push({ timestamp: new Date().toISOString(), message: msg, type });
    };

    // v1.9: During active COMBAT, all NPCs are physically present in the scene.
    // Coherence checking would block legitimate combat actions (archers shooting,
    // cavalry charging, etc.) whose ETA floors just got bumped by the engine.
    if (sceneMode === 'COMBAT') return npcActions;

    // Build entity names from threats with ETA > 1
    // v1.9: Use entity-name matching instead of keyword extraction to prevent
    // false positives from common words in threat descriptions.
    const distantThreatEntities: Map<string, { eta: number; originalEta: number }> = new Map();
    // v1.10: Track messenger threat entities separately — these get FULL suppression
    const messengerEntities: Map<string, { eta: number }> = new Map();
    for (const threat of emergingThreats) {
        const eta = threat.turns_until_impact ?? 0;
        if (eta <= 1) continue; // Imminent threats — NPC can appear freely

        const entityNames = threat.entitySourceNames ?? [];

        // v1.10: Messenger threats get full entity suppression until ETA <= 2.
        // When Garek is "fleeing toward a battalion" (ETA 5), ANY action by Garek
        // is invalid — he's not here. Not just "arrival" actions.
        const isMessenger = isMessengerThreat(threat) && eta > 2;
        if (isMessenger) {
            for (const name of entityNames) {
                const nameLower = name.toLowerCase();
                const parts = nameLower.split(/\s+/).filter(p =>
                    p.length >= 3 && !ENTITY_EXTRACTION_BLACKLIST.has(p)
                );
                for (const part of parts) {
                    const existing = messengerEntities.get(part);
                    if (!existing || eta > existing.eta) {
                        messengerEntities.set(part, { eta });
                    }
                }
            }
        }

        for (const name of entityNames) {
            const nameLower = name.toLowerCase();
            // Extract the identity part (skip setting words / blacklisted)
            const parts = nameLower.split(/\s+/).filter(p =>
                p.length >= 3 && !ENTITY_EXTRACTION_BLACKLIST.has(p)
            );
            for (const part of parts) {
                const existing = distantThreatEntities.get(part);
                if (!existing || eta > existing.eta) {
                    distantThreatEntities.set(part, {
                        eta,
                        originalEta: threat.originalEta ?? eta
                    });
                }
            }
        }
    }

    if (distantThreatEntities.size === 0 && messengerEntities.size === 0) return npcActions;

    // Verbs indicating physical presence / arrival at a location
    const ARRIVAL_INDICATORS = [
        'arrived', 'arriving', 'reached', 'reaching',
        'approaching', 'entered', 'entering',
        'dismounting', 'dismounted',
        'surrounding', 'surrounded',
        'position', 'positioned', 'in position',
        'slaughter', 'slaughtering',
        'moving through', 'fan out', 'fanned out', 'fanout',
        'pincer', 'encircle', 'encircling',
        'back alleys', 'perimeter',
        'outskirts', 'edge of town', 'edge of the town',
        'north gate', 'south gate', 'east gate', 'west gate',
        'town square', 'town center',
        'three-mile', 'one-mile', 'half-mile',
        // v1.9: Additional arrival verbs observed in save data
        'collapses inside', 'collapses in front', 'collapses at',
        'leads the', 'leading the',   // "Leads the patrol to the site"
        'signals', 'signaling',        // "Signals the riders" (implies present with group)
        'within sight', 'in sight of',
        'draws', 'drawing in the dust', // "Drawing a wolf in the dust to explain"
        'waving his arms', 'waving her arms',
        'breaches the', 'breaks through',
        'crawls into', 'stumbles into',
    ];

    return npcActions.filter(action => {
        // v1.9: During TENSION, only check hidden actions (visible NPCs are in-scene)
        // During NARRATIVE/SOCIAL, check ALL actions — the AI bypasses by marking
        // distant messenger arrivals as player_visible.
        if (sceneMode === 'TENSION' && action.player_visible) return true;

        const actionLower = action.action.toLowerCase();
        const npcNameLower = action.npc_name.toLowerCase();

        // v1.10: MESSENGER ENTITY FULL SUPPRESSION
        // If this NPC is the primary entity of a messenger threat (ETA > 2),
        // ALL actions by them are blocked — not just arrival actions.
        // The messenger is physically elsewhere (traveling to report).
        for (const [entityPart, { eta }] of messengerEntities.entries()) {
            if (npcNameLower.includes(entityPart)) {
                log(
                    `[NPC ACTION BLOCKED — v1.10 MESSENGER] "${action.npc_name}: ` +
                    `${action.action.substring(0, 100)}" — entity "${entityPart}" is ` +
                    `the subject of a messenger threat with ETA ${eta} (> 2). ` +
                    `Messenger NPCs cannot appear locally while traveling to their destination.`,
                    'error'
                );
                return false;
            }
        }

        // Check if this NPC's name matches a distant threat entity
        for (const [entityPart, { eta, originalEta }] of distantThreatEntities.entries()) {
            // Check both the NPC name and the action text for the entity name
            const entityInAction = npcNameLower.includes(entityPart) || actionLower.includes(entityPart);
            if (!entityInAction) continue;

            const hasArrivalIndicator = ARRIVAL_INDICATORS.some(v => actionLower.includes(v));
            if (hasArrivalIndicator) {
                log(
                    `[NPC ACTION BLOCKED — v1.9 COHERENCE] "${action.npc_name}: ` +
                    `${action.action.substring(0, 100)}" — implies local presence of ` +
                    `entity "${entityPart}" from threat with ETA ${eta} (original: ${originalEta}). ` +
                    `Actions cannot advance threats faster than their ETA countdown.`,
                    'error'
                );
                return false;
            }
        }

        return true;
    });
};

/**
 * Validates that hidden_update text doesn't describe threat entities as locally
 * present when their threat ETA is still > 3. The AI uses hidden_update to
 * narrate threat progress (e.g., "Kavar has tracked the player to the shop") even
 * when NPC actions would be blocked by the coherence check.
 *
 * Returns the sanitised hidden_update string with violating lines stripped.
 */
export const validateHiddenUpdateCoherence = (
    hiddenUpdate: string,
    emergingThreats: WorldTickEvent[],
    debugLogs: DebugLogEntry[],
    playerCharacterName: string = '',
    sceneMode: string = 'NARRATIVE'   // v1.9
): string => {
    if (!hiddenUpdate || hiddenUpdate.trim().length === 0) return hiddenUpdate;

    // v1.9: During COMBAT, all entities are in-scene — skip coherence
    if (sceneMode === 'COMBAT') return hiddenUpdate;

    // Build entity names from distant threats (ETA > 3)
    const distantThreatEntityNames: Map<string, number> = new Map();
    for (const threat of emergingThreats) {
        const eta = threat.turns_until_impact ?? 0;
        if (eta <= 3) continue;

        // Use stored entity names if available, otherwise extract
        const names = threat.entitySourceNames ??
            extractEntityNamesFromDescription(threat.description, [], playerCharacterName);
        for (const name of names) {
            const existing = distantThreatEntityNames.get(name) ?? 0;
            if (eta > existing) distantThreatEntityNames.set(name, eta);
        }
    }

    if (distantThreatEntityNames.size === 0) return hiddenUpdate;

    // Arrival/presence indicators that suggest the entity is at the player's location
    const PRESENCE_INDICATORS = [
        'tracked', 'found', 'located', 'spotted', 'identified',
        'arrived', 'reached', 'entered', 'barged', 'searched',
        'questioning', 'interrogat', 'demanding', 'confronting',
        'surrounding', 'watching the', 'outside the shop',
        'one curtain away', 'at the door', 'at the front',
        'in the shop', 'in the tavern', 'in the building',
        'currently question', 'currently search',
    ];

    // Split into lines and filter
    const lines = hiddenUpdate.split('\n');
    const filtered = lines.filter(line => {
        const lineLower = line.toLowerCase();

        for (const [entityName, eta] of distantThreatEntityNames.entries()) {
            if (!lineLower.includes(entityName)) continue;

            const hasPresence = PRESENCE_INDICATORS.some(p => lineLower.includes(p));
            if (hasPresence) {
                debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: `[HIDDEN UPDATE BLOCKED — v1.8 COHERENCE] "${line.substring(0, 100)}" — ` +
                        `describes "${entityName}" as locally present, but threat ETA is ${eta}. ` +
                        `Hidden updates cannot bypass threat ETAs.`,
                    type: 'error'
                });
                return false;
            }
        }
        return true;
    });

    return filtered.join('\n');
};

/**
 * v1.11: Extract hostile faction keywords from knownEntities.
 * Any entity with NEMESIS or HOSTILE relationship contributes its role's
 * significant words (excluding generic role words) as faction identifiers.
 */
export const extractHostileFactionKeywords = (
    knownEntities: Array<{ name: string; role: string; relationship_level: string }>
): Set<string> => {
    const keywords = new Set<string>();
    const hostileLevels = new Set(['NEMESIS', 'HOSTILE']);

    for (const entity of knownEntities) {
        if (!hostileLevels.has(entity.relationship_level)) continue;
        const roleParts = entity.role.toLowerCase().split(/[\s()\-_,]/);
        for (const part of roleParts) {
            if (part.length >= 4 && !GENERIC_ROLE_WORDS.has(part)) {
                keywords.add(part);
            }
        }
    }

    return keywords;
};

/**
 * v1.11 FIX 4: Blocks NPC actions from entities that are NOT in the
 * knownEntities registry AND whose names contain hostile faction identifiers.
 * Closes the gap where the AI invents brand-new hostile NPCs that bypass
 * coherence checks because they aren't linked to any existing threat.
 */
export const validateNpcEntityRegistration = (
    npcActions: WorldTickAction[],
    knownEntityNames: string[],
    emergingThreats: WorldTickEvent[],
    hostileFactionKeywords: Set<string>,
    debugLogs: DebugLogEntry[],
    sceneMode: string = 'NARRATIVE'
): WorldTickAction[] => {
    if (sceneMode === 'COMBAT') return npcActions;
    if (hostileFactionKeywords.size === 0) return npcActions;

    const knownNamesLower = knownEntityNames.map(n => n.toLowerCase());
    const knownFirstNames = new Set<string>();
    for (const name of knownNamesLower) {
        for (const part of name.split(/[\s(']/)) {
            if (part.length >= 3) knownFirstNames.add(part.trim());
        }
    }

    const threatEntityNames = new Set<string>();
    for (const threat of emergingThreats) {
        for (const name of (threat.entitySourceNames ?? [])) {
            threatEntityNames.add(name);
        }
    }

    return npcActions.filter(action => {
        const npcNameLower = action.npc_name.toLowerCase();

        // Is this NPC in the known entities registry?
        const isKnown = knownNamesLower.some(known => {
            const firstName = known.split(/[\s(']/)[0].trim();
            return firstName.length >= 3 && (
                npcNameLower.includes(firstName) || firstName.includes(npcNameLower.split(/[\s(']/)[0])
            );
        });
        if (isKnown) return true;

        // Is this NPC listed in an active threat's entity names?
        const isInThreat = [...threatEntityNames].some(tn => npcNameLower.includes(tn));
        if (isInThreat) return true;

        // Does this NPC's name contain hostile faction keywords?
        const npcNameParts = npcNameLower.split(/[\s()\-_]/);
        const hasHostileFactionId = npcNameParts.some(part =>
            part.length >= 3 && hostileFactionKeywords.has(part)
        );

        if (hasHostileFactionId) {
            debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[NPC ACTION BLOCKED — v1.11 PHANTOM ENTITY] "${action.npc_name}: ` +
                    `${action.action.substring(0, 100)}" — NPC is not in knownEntities ` +
                    `registry and name contains hostile faction keyword. Unregistered ` +
                    `hostile entities cannot take actions. Register via known_entity_updates first.`,
                type: 'error'
            });
            return false;
        }

        return true;
    });
};

/**
 * v1.12 FIX SE-5: Syncs entity locations from world_tick NPC actions.
 * When an NPC action describes an entity at a specific location, update
 * that entity's location in knownEntities. This prevents stale location data
 * where the registry says an entity is in one place but hidden_update shows
 * them elsewhere.
 */
export const syncEntityLocationsFromWorldTick = (
    knownEntities: KnownEntity[],
    npcActions: WorldTickAction[],
    hiddenUpdate: string,
    debugLogs: DebugLogEntry[]
): KnownEntity[] => {
    const updated = [...knownEntities];

    // Location extraction patterns from NPC actions
    const LOCATION_PATTERNS = [
        /(?:at|in|near|outside|inside|heading to|arrives? at|reaches?|enters?)\s+(?:the\s+)?([A-Z][a-zA-Z\s'-]+?)(?:\.|,|$|to\s)/,
        /(?:sweeps?|searches?|secures?|patrols?)\s+(?:the\s+)?([A-Z][a-zA-Z\s'-]+?)(?:\.|,|$)/,
    ];

    for (const action of npcActions) {
        // Find the matching entity
        const entityIdx = updated.findIndex(e => {
            const primaryName = e.name.split('(')[0].trim().toLowerCase();
            const actionNpc = action.npc_name.toLowerCase();
            return actionNpc.includes(primaryName) || primaryName.includes(actionNpc);
        });

        if (entityIdx === -1) continue;

        // Try to extract a location from the action text
        for (const pattern of LOCATION_PATTERNS) {
            const match = pattern.exec(action.action);
            if (match && match[1]) {
                const newLocation = match[1].trim();
                if (newLocation.length >= 4 && newLocation.length <= 60) {
                    const oldLocation = updated[entityIdx].location;
                    if (oldLocation !== newLocation) {
                        updated[entityIdx] = { ...updated[entityIdx], location: newLocation };
                        debugLogs.push({
                            timestamp: new Date().toISOString(),
                            message: `[ENTITY LOCATION SYNC — v1.12] ${updated[entityIdx].name}: ` +
                                `"${oldLocation}" → "${newLocation}" (from world_tick action)`,
                            type: 'info'
                        });
                    }
                    break;
                }
            }
        }
    }

    return updated;
};

/**
 * v1.12 FIX SE-9: Validates that NPC actions describing movement through
 * known hostile areas account for environmental hazards. If an NPC traverses
 * an area with active hostile entities (stirges, vermin, traps), they may
 * be delayed, injured, or fail to arrive.
 *
 * Uses deterministic check based on threat description + area keywords.
 * Returns filtered actions with blocked movements logged.
 */
export const applyNpcAttritionLayer = (
    npcActions: WorldTickAction[],
    activeThreats: WorldTickEvent[],
    environmentChanges: string[],
    knownEntities: { name: string; relationship_level: string }[],
    debugLogs: DebugLogEntry[]
): WorldTickAction[] => {
    // Build a set of hazardous area keywords from active environmental threats
    // and recent environment changes
    const hazardKeywords = new Set<string>();
    const ENVIRONMENTAL_HAZARDS = [
        'swarm', 'vermin', 'stirge', 'trap', 'collapse', 'flood',
        'miasma', 'spore', 'toxic', 'lava', 'acid', 'nest'
    ];

    // Extract area hazards from environment changes
    for (const change of environmentChanges) {
        const changeLower = change.toLowerCase();
        for (const hazard of ENVIRONMENTAL_HAZARDS) {
            if (changeLower.includes(hazard)) {
                // Extract location words near the hazard mention
                const words = changeLower.split(/\s+/);
                const hazardIdx = words.findIndex(w => w.includes(hazard));
                if (hazardIdx >= 0) {
                    // Grab surrounding words as area identifiers
                    for (let i = Math.max(0, hazardIdx - 3); i <= Math.min(words.length - 1, hazardIdx + 3); i++) {
                        if (words[i].length >= 4) hazardKeywords.add(words[i]);
                    }
                }
            }
        }
    }

    // Also extract from active threat descriptions
    for (const threat of activeThreats) {
        const descLower = threat.description.toLowerCase();
        for (const hazard of ENVIRONMENTAL_HAZARDS) {
            if (descLower.includes(hazard)) {
                hazardKeywords.add(hazard);
            }
        }
    }

    if (hazardKeywords.size === 0) return npcActions;

    // Filter NPC actions — hostile/nemesis NPCs traversing hazardous areas get flagged
    const MOVEMENT_VERBS = ['navigate', 'traverse', 'descend', 'enter', 'move through',
        'head to', 'proceed', 'advance', 'infiltrate', 'approach'];

    return npcActions.filter(action => {
        const actionLower = action.action.toLowerCase();
        const npcNameLower = action.npc_name.toLowerCase();

        // Only apply to hostile NPCs
        const isHostileNpc = knownEntities.some(e => {
            const primaryName = e.name.split('(')[0].trim().toLowerCase();
            return (npcNameLower.includes(primaryName) || primaryName.includes(npcNameLower)) &&
                ['HOSTILE', 'NEMESIS'].includes(e.relationship_level);
        });
        if (!isHostileNpc) return true;

        // Check if the action describes movement through a hazardous area
        const isMovement = MOVEMENT_VERBS.some(v => actionLower.includes(v));
        if (!isMovement) return true;

        const hitsHazard = [...hazardKeywords].some(kw => actionLower.includes(kw));
        if (!hitsHazard) return true;

        // This NPC is moving through a hazardous area — apply attrition check
        // Use a deterministic hash based on NPC name + turn to avoid randomness
        const hash = (npcNameLower.length * 17 + actionLower.length * 31) % 100;
        if (hash < NPC_ATTRITION_CHANCE * 100) {
            debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[NPC ATTRITION — v1.12] "${action.npc_name}: ${action.action.substring(0, 80)}" — ` +
                    `hostile NPC traversing hazardous area (${[...hazardKeywords].join(', ')}). ` +
                    `Attrition applied: action DELAYED/BLOCKED.`,
                type: 'warning'
            });
            return false;
        }

        return true;
    });
};
