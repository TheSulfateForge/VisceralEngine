import type {
  WorldSeed,
  GameWorld,
  Faction,
  FactionResource,
  KnownEntity,
  LoreItem,
  LocationGraph,
  FactionDisposition
} from '../types';
import { generateLoreId } from '../idUtils';

export function hydrateWorldSeed(seed: WorldSeed): Partial<GameWorld> {
  // Convert locations to LocationGraph
  const locationGraph: LocationGraph = {
    nodes: Object.fromEntries(
      seed.locations.map(loc => {
        const id = loc.name.toLowerCase().replace(/\s+/g, '_');
        return [id, {
          id,
          displayName: loc.name,
          description: loc.description,
          firstMentionedTurn: 0,
          tags: loc.tags,
        }];
      })
    ),
    edges: seed.locations.flatMap(loc =>
      loc.connections.map(conn => ({
        from: loc.name.toLowerCase().replace(/\s+/g, '_'),
        to: conn.to.toLowerCase().replace(/\s+/g, '_'),
        travelTimeMinutes: conn.travelTimeMinutes,
        source: 'ai_declared' as const,
        createdTurn: 0,
        modeOverrides: conn.mode ? { [conn.mode]: conn.travelTimeMinutes } : undefined,
      }))
    ),
    playerLocationId: '',
  };

  // Convert lore
  const lore: LoreItem[] = seed.lore.map(l => ({
    id: generateLoreId(),
    keyword: l.keyword,
    content: l.content,
    timestamp: new Date().toISOString(),
    turnCreated: 0,
  }));

  // Convert NPCs to KnownEntities
  const knownEntities: KnownEntity[] = seed.npcs.map(npc => ({
    id: `npc_${npc.name.toLowerCase().replace(/\s+/g, '_')}`,
    name: npc.name,
    role: npc.role,
    location: npc.location,
    impression: npc.description,
    relationship_level: 'NEUTRAL' as const,
    leverage: '',
    ledger: [],
    status: 'distant' as const,
    firstSeenTurn: 0,
  }));

  // Convert factions (uses Stream 6 types)
  const factions: Faction[] = seed.factions.map(f => ({
    id: `faction_${f.name.toLowerCase().replace(/\s+/g, '_')}`,
    name: f.name,
    description: f.description,
    territory: f.territory.map(t => t.toLowerCase().replace(/\s+/g, '_')),
    influence: f.influence,
    disposition: f.dispositions as Record<string, FactionDisposition>,
    resources: f.resources as FactionResource[],
    leader: f.leader,
    memberEntityIds: f.keyMembers.map(m => `npc_${m.toLowerCase().replace(/\s+/g, '_')}`),
    playerStanding: { reputation: 0, knownActions: [] },
  }));

  // Convert rules to string array
  const worldRules = seed.rules.map(r => `${r.name}: ${r.description}`);

  return {
    locationGraph,
    lore,
    knownEntities,
    factions,
    factionConflicts: [],
    worldRules,
    worldSeedId: seed.id,
  };
}
