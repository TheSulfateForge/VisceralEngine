import type { PipelineStep, TurnContext } from '../types';
import { shouldFireTraumaEffect, selectTraumaEffect, getTraumaTier } from '../../traumaSystem';
import { TRAUMA_TIERS } from '../../../config/engineConfig';

export const traumaEffectsStep: PipelineStep = {
  name: 'traumaEffects',
  execute: (ctx: TurnContext): TurnContext => {
    const trauma = ctx.characterUpdate.trauma;
    const tier = getTraumaTier(trauma);
    const turnCount = ctx.currentTurn;
    const lastEffectTurn = ctx.worldUpdate.lastTraumaEffectTurn;

    if (!shouldFireTraumaEffect(trauma, turnCount, lastEffectTurn)) {
      // Clear active effect if trauma dropped below threshold
      if (tier === 'STABLE' || tier === 'STRESSED') {
        ctx.worldUpdate = { ...ctx.worldUpdate, activeTraumaEffect: undefined };
      }
      return ctx;
    }

    // Find dead entities for hallucination
    const deadEntities = (ctx.updatedKnownEntities ?? [])
      .filter(e => e.status === 'dead')
      .map(e => e.name);

    const effect = selectTraumaEffect(tier, turnCount, deadEntities);

    ctx.worldUpdate = {
      ...ctx.worldUpdate,
      activeTraumaEffect: effect,
      lastTraumaEffectTurn: turnCount,
    };

    ctx.debugLogs.push({
      timestamp: new Date().toISOString(),
      message: `[TRAUMA] Tier ${TRAUMA_TIERS[tier].label} effect triggered: ${effect.type}`,
      type: 'warning'
    });

    return ctx;
  }
};
