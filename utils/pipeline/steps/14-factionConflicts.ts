import type { PipelineStep, TurnContext } from '../types';
import { checkConflictTriggers, progressConflicts, applyFactionUpdates } from '../../factionSystem';

export const factionConflictsStep: PipelineStep = {
  name: 'factionConflicts',
  execute: (ctx: TurnContext): TurnContext => {
    const factions = ctx.worldUpdate.factions ?? [];
    if (factions.length === 0) return ctx;

    let conflicts = ctx.worldUpdate.factionConflicts ?? [];
    let updatedFactions = [...factions];

    // Apply AI-provided faction updates
    const r = ctx.sanitisedResponse;
    if (r.faction_updates) {
      updatedFactions = applyFactionUpdates(updatedFactions, r.faction_updates, ctx.debugLogs);
    }

    // Check for new conflict triggers
    conflicts = checkConflictTriggers(updatedFactions, conflicts, ctx.currentTurn, ctx.debugLogs);

    // Progress existing conflicts
    const result = progressConflicts(updatedFactions, conflicts, ctx.currentTurn, ctx.debugLogs);

    ctx.worldUpdate = {
      ...ctx.worldUpdate,
      factions: result.factions,
      factionConflicts: result.conflicts,
    };

    return ctx;
  }
};
