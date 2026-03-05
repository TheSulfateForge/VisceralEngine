import { KnownEntity, WorldTickAction, NPCInteraction, WorldTickEvent, DebugLogEntry } from '../../types';
import { ENTITY_NEARBY_DECAY_TURNS, ENTITY_DISTANT_DECAY_TURNS } from '../../config/engineConfig';

/** Helper to match names loosely */
const nameMatch = (a: string, b: string): boolean => {
    return a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase());
};

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
        let seenThisTurn = false;
        
        // Check narrative
        if (narrativeLower.includes(entity.name.toLowerCase())) {
            seenThisTurn = true;
        }
        
        // Check NPC actions
        if (!seenThisTurn && npcActions.some(a => nameMatch(a.npc_name, entity.name))) {
            seenThisTurn = true;
        }
        
        // Check NPC interaction
        if (!seenThisTurn && npcInteraction && nameMatch(npcInteraction.speaker, entity.name)) {
            seenThisTurn = true;
        }
        
        if (seenThisTurn) {
            return {
                ...entity,
                lastSeenTurn: currentTurn,
                // If they were missing/distant/nearby, they are now present
                status: (entity.status === 'dead' || entity.status === 'retired') ? entity.status : 'present',
                location: playerLocation || entity.location,
                statusChangedTurn: entity.status !== 'present' ? currentTurn : entity.statusChangedTurn
            };
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
    const deathKeywords = ['dies', 'died', 'killed', 'slain', 'dead', 'corpse', 'perishes', 'perished', 'executed'];
    
    return entities.map(entity => {
        if (entity.status === 'dead' || entity.status === 'retired') return entity;
        
        const nameLower = entity.name.toLowerCase();
        let isDead = false;
        let reason = '';
        
        // Check updates
        const update = entityUpdates?.find(u => nameMatch(u.name, entity.name));
        if (update) {
            const impressionLower = update.impression.toLowerCase();
            if (deathKeywords.some(k => impressionLower.includes(k))) {
                isDead = true;
                reason = `Reported dead in entity update: ${update.impression}`;
            } else if (impressionLower.includes('retired') || impressionLower.includes('departed permanently')) {
                return { ...entity, status: 'retired', exitReason: update.impression };
            }
        }
        
        // Check narrative for strong death association
        if (!isDead && narrativeLower.includes(nameLower)) {
            // Very basic proximity check for death keywords near the name
            const nameIndex = narrativeLower.indexOf(nameLower);
            const windowStart = Math.max(0, nameIndex - 50);
            const windowEnd = Math.min(narrativeLower.length, nameIndex + nameLower.length + 50);
            const contextWindow = narrativeLower.substring(windowStart, windowEnd);
            
            if (deathKeywords.some(k => contextWindow.includes(k))) {
                // We don't auto-kill just based on narrative proximity to avoid false positives 
                // (e.g. "John saw the dead body"). We rely more on the AI's entity updates or explicit combat results.
                // But we can flag it for review or if it's very explicit.
                // For now, let's trust the entity updates more, but if the AI explicitly says "[Name] is dead"
                if (contextWindow.includes(`${nameLower} is dead`) || contextWindow.includes(`killed ${nameLower}`)) {
                    isDead = true;
                    reason = 'Confirmed kill in narrative.';
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
