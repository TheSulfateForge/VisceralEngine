import type { Faction, FactionConflict, FactionDisposition, FactionResource, GameWorld, DebugLogEntry, KnownEntity } from '../types';
import { FACTION_CONFLICT_TRIGGER_CHANCE, FACTION_CONFLICT_MIN_INFLUENCE, FACTION_CONFLICT_RESOLUTION_THRESHOLD, FACTION_MOMENTUM_SHIFT_RANGE, FACTION_MAX_CONFLICTS } from '../config/engineConfig';

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 12345 + 67890) * 67890;
  return x - Math.floor(x);
}

export function checkConflictTriggers(
  factions: Faction[],
  existingConflicts: FactionConflict[],
  turnCount: number,
  debugLogs: DebugLogEntry[]
): FactionConflict[] {
  if (existingConflicts.length >= FACTION_MAX_CONFLICTS) return existingConflicts;

  const newConflicts = [...existingConflicts];

  for (let i = 0; i < factions.length; i++) {
    for (let j = i + 1; j < factions.length; j++) {
      const a = factions[i];
      const b = factions[j];

      // Check if already in conflict
      const alreadyInConflict = existingConflicts.some(c =>
        (c.aggressorId === a.id && c.defenderId === b.id) ||
        (c.aggressorId === b.id && c.defenderId === a.id)
      );
      if (alreadyInConflict) continue;

      // Rivals sharing territory with sufficient influence
      const disp = a.disposition[b.id] ?? 'neutral';
      if (disp !== 'rival' && disp !== 'war') continue;
      if (a.influence < FACTION_CONFLICT_MIN_INFLUENCE || b.influence < FACTION_CONFLICT_MIN_INFLUENCE) continue;

      const sharedTerritory = a.territory.filter(t => b.territory.includes(t));
      if (sharedTerritory.length === 0) continue;

      if (seededRandom(turnCount * 100 + i * 10 + j) < FACTION_CONFLICT_TRIGGER_CHANCE) {
        const conflict: FactionConflict = {
          id: `conflict_${a.id}_${b.id}_t${turnCount}`,
          aggressorId: a.influence >= b.influence ? a.id : b.id,
          defenderId: a.influence >= b.influence ? b.id : a.id,
          type: disp === 'war' ? 'full_war' : 'territory_dispute',
          startTurn: turnCount,
          stakes: `Control of ${sharedTerritory[0]}`,
          momentum: 0,
          lastEscalationTurn: turnCount,
          playerInvolvement: 'none',
        };
        newConflicts.push(conflict);
        debugLogs.push({
          timestamp: new Date().toISOString(),
          message: `[FACTION CONFLICT] New ${conflict.type}: ${a.name} vs ${b.name} — stakes: ${conflict.stakes}`,
          type: 'warning'
        });
      }
    }
  }

  return newConflicts;
}

export function progressConflicts(
  factions: Faction[],
  conflicts: FactionConflict[],
  turnCount: number,
  debugLogs: DebugLogEntry[]
): { conflicts: FactionConflict[]; factions: Faction[] } {
  const updatedConflicts: FactionConflict[] = [];
  const updatedFactions = factions.map(f => ({ ...f }));

  for (const conflict of conflicts) {
    const aggressor = updatedFactions.find(f => f.id === conflict.aggressorId);
    const defender = updatedFactions.find(f => f.id === conflict.defenderId);
    if (!aggressor || !defender) continue;

    // Calculate momentum shift based on resources
    const aggressorStrength = aggressor.resources.length * aggressor.influence;
    const defenderStrength = defender.resources.length * defender.influence;
    const total = aggressorStrength + defenderStrength || 1;
    const shift = ((aggressorStrength / total) - 0.5) * FACTION_MOMENTUM_SHIFT_RANGE;
    const randomFactor = (seededRandom(turnCount * 1000 + conflict.startTurn) - 0.5) * 10;

    let newMomentum = Math.max(-100, Math.min(100, conflict.momentum + shift + randomFactor));

    // Check for resolution
    if (Math.abs(newMomentum) >= FACTION_CONFLICT_RESOLUTION_THRESHOLD) {
      const winner = newMomentum > 0 ? aggressor : defender;
      const loser = newMomentum > 0 ? defender : aggressor;

      // Transfer territory
      const contested = aggressor.territory.filter(t => defender.territory.includes(t));
      if (contested.length > 0) {
        const transferred = contested[0];
        const loserIdx = updatedFactions.findIndex(f => f.id === loser.id);
        const winnerIdx = updatedFactions.findIndex(f => f.id === winner.id);
        if (loserIdx >= 0) {
          updatedFactions[loserIdx] = {
            ...updatedFactions[loserIdx],
            territory: updatedFactions[loserIdx].territory.filter(t => t !== transferred),
            influence: Math.max(0, updatedFactions[loserIdx].influence - 10),
          };
        }
        if (winnerIdx >= 0 && !updatedFactions[winnerIdx].territory.includes(transferred)) {
          updatedFactions[winnerIdx] = {
            ...updatedFactions[winnerIdx],
            territory: [...updatedFactions[winnerIdx].territory, transferred],
            influence: Math.min(100, updatedFactions[winnerIdx].influence + 5),
          };
        }
      }

      debugLogs.push({
        timestamp: new Date().toISOString(),
        message: `[FACTION CONFLICT RESOLVED] ${winner.name} defeats ${loser.name} in ${conflict.type}. Stakes: ${conflict.stakes}`,
        type: 'success'
      });
      continue; // Don't add resolved conflict back
    }

    updatedConflicts.push({ ...conflict, momentum: newMomentum, lastEscalationTurn: turnCount });
  }

  return { conflicts: updatedConflicts, factions: updatedFactions };
}

export function applyFactionUpdates(
  factions: Faction[],
  updates: Array<{
    faction_name: string;
    influence_delta?: number;
    territory_gained?: string[];
    territory_lost?: string[];
    player_reputation_delta?: number;
    new_objective?: string;
  }>,
  debugLogs: DebugLogEntry[]
): Faction[] {
  if (!updates || updates.length === 0) return factions;

  const result = factions.map(f => ({ ...f }));

  for (const update of updates) {
    const idx = result.findIndex(f => f.name.toLowerCase() === update.faction_name.toLowerCase());
    if (idx < 0) continue;

    const faction = result[idx];

    if (update.influence_delta) {
      faction.influence = Math.max(0, Math.min(100, faction.influence + update.influence_delta));
    }
    if (update.territory_gained) {
      for (const t of update.territory_gained) {
        if (!faction.territory.includes(t)) faction.territory.push(t);
      }
    }
    if (update.territory_lost) {
      faction.territory = faction.territory.filter(t => !update.territory_lost!.includes(t));
    }
    if (update.player_reputation_delta) {
      faction.playerStanding = {
        ...faction.playerStanding,
        reputation: Math.max(-100, Math.min(100, faction.playerStanding.reputation + update.player_reputation_delta)),
      };
    }
    if (update.new_objective) {
      faction.activeObjective = update.new_objective;
    }

    result[idx] = faction;
    debugLogs.push({
      timestamp: new Date().toISOString(),
      message: `[FACTION UPDATE] ${update.faction_name}: influence=${faction.influence}, reputation=${faction.playerStanding.reputation}`,
      type: 'info'
    });
  }

  return result;
}

export function buildFactionPromptBlock(factions: Faction[], conflicts: FactionConflict[]): string {
  if (!factions || factions.length === 0) return '';

  let block = '\n[FACTION STATE]\n';

  for (const faction of factions) {
    const resources = faction.resources.join('+');
    block += `${faction.name} (influence: ${faction.influence}, ${resources})\n`;
    block += `  Territory: ${faction.territory.join(', ') || 'None'}\n`;

    const dispositions = Object.entries(faction.disposition)
      .map(([id, disp]) => {
        const other = factions.find(f => f.id === id);
        return other ? `${disp.toUpperCase()} with ${other.name}` : null;
      })
      .filter(Boolean)
      .join(', ');
    if (dispositions) block += `  Disposition: ${dispositions}\n`;

    const rep = faction.playerStanding.reputation;
    const repLabel = rep >= 50 ? 'Revered' : rep >= 20 ? 'Respected' : rep >= -20 ? 'Unknown' : rep >= -50 ? 'Distrusted' : 'Hated';
    block += `  Player standing: ${rep >= 0 ? '+' : ''}${rep} (${repLabel})\n`;

    if (faction.activeObjective) block += `  Objective: ${faction.activeObjective}\n`;
    block += '\n';
  }

  for (const conflict of conflicts) {
    const aggressor = factions.find(f => f.id === conflict.aggressorId);
    const defender = factions.find(f => f.id === conflict.defenderId);
    if (!aggressor || !defender) continue;

    const leader = conflict.momentum > 0 ? `${aggressor.name} advancing` : conflict.momentum < 0 ? `${defender.name} defending` : 'Stalemate';
    block += `ACTIVE CONFLICT: ${aggressor.name} vs ${defender.name} (${conflict.type})\n`;
    block += `  Momentum: ${conflict.momentum > 0 ? '+' : ''}${Math.round(conflict.momentum)} (${leader})\n`;
    block += `  Stakes: ${conflict.stakes}\n`;
    block += `  Player involvement: ${conflict.playerInvolvement}\n\n`;
  }

  return block;
}
