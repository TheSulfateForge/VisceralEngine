import { TRAUMA_TIERS, TraumaTier, TRAUMA_EFFECT_CHANCE, TRAUMA_EFFECT_COOLDOWN_TURNS } from '../config/engineConfig';
import type { TraumaEffect, TraumaEffectType } from '../types';

export function getTraumaTier(trauma: number): TraumaTier {
  if (trauma >= TRAUMA_TIERS.BREAKING.min) return 'BREAKING';
  if (trauma >= TRAUMA_TIERS.DISSOCIATING.min) return 'DISSOCIATING';
  if (trauma >= TRAUMA_TIERS.UNSTABLE.min) return 'UNSTABLE';
  if (trauma >= TRAUMA_TIERS.STRESSED.min) return 'STRESSED';
  return 'STABLE';
}

export function getTraumaTierLabel(trauma: number): { label: string; tier: TraumaTier } {
  const tier = getTraumaTier(trauma);
  return { label: TRAUMA_TIERS[tier].label, tier };
}

// Seeded random using turn count for determinism
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 49297;
  return x - Math.floor(x);
}

const EFFECT_WEIGHTS: Record<TraumaTier, TraumaEffectType[]> = {
  STABLE: [],
  STRESSED: [],
  UNSTABLE: ['sensory_distortion', 'paranoia', 'sensory_distortion'],
  DISSOCIATING: ['sensory_distortion', 'paranoia', 'hallucinated_entity', 'dissociation', 'flashback'],
  BREAKING: ['hallucinated_entity', 'unreliable_narration', 'dissociation', 'flashback', 'paranoia', 'hallucinated_entity'],
};

export function selectTraumaEffect(tier: TraumaTier, turnCount: number, deadEntities: string[]): TraumaEffect {
  const pool = EFFECT_WEIGHTS[tier];
  const idx = Math.floor(seededRandom(turnCount + 7) * pool.length);
  const type = pool[idx];

  return {
    type,
    tier,
    description: generateEffectDescription(type, tier, turnCount, deadEntities),
  };
}

function generateEffectDescription(type: TraumaEffectType, tier: TraumaTier, turnCount: number, deadEntities: string[]): string {
  switch (type) {
    case 'sensory_distortion':
      return 'Weave a subtle sensory anomaly into the scene — a sound, smell, or shadow that has no source. Do NOT confirm or deny its reality to the player. Present it as fact.';
    case 'paranoia':
      return 'One NPC\'s dialogue or body language should feel subtly wrong — too friendly, oddly specific, as if they know something the player hasn\'t shared. Do NOT explain why. Let the player wonder.';
    case 'hallucinated_entity': {
      if (deadEntities.length > 0) {
        const entity = deadEntities[Math.floor(seededRandom(turnCount + 13) * deadEntities.length)];
        return `Briefly describe a figure in the periphery matching "${entity}"'s silhouette or voice. This is a hallucination — do NOT have the figure interact or respond if approached. Describe it as real.`;
      }
      return 'Describe a figure at the edge of vision that disappears when looked at directly. Present it as real within the narrative.';
    }
    case 'flashback':
      return 'Interrupt the current scene with a vivid 1-2 sentence memory from the character\'s backstory. Present it as bleeding into the present — smells, sounds, or images from the past overlapping with now. Return to the present seamlessly.';
    case 'unreliable_narration':
      return 'Include one concrete detail in the narrative that contradicts something established earlier (a door that was locked is now open, an item in a different location, a person wearing different clothes). Do NOT draw attention to the inconsistency. Let the player notice.';
    case 'dissociation':
      return 'Briefly shift the narrative to third person for 1-2 sentences, as if the character is watching themselves from outside. Then return to normal perspective without comment. Alternatively, skip a small amount of time (30 seconds to 2 minutes) without narrating what happened.';
  }
}

export function shouldFireTraumaEffect(trauma: number, turnCount: number, lastEffectTurn?: number): boolean {
  const tier = getTraumaTier(trauma);
  const chance = TRAUMA_EFFECT_CHANCE[tier];
  if (chance === 0) return false;

  // Cooldown check
  if (lastEffectTurn !== undefined && (turnCount - lastEffectTurn) < TRAUMA_EFFECT_COOLDOWN_TURNS) {
    return false;
  }

  return seededRandom(turnCount) < chance;
}

export function buildTraumaPromptBlock(trauma: number, activeEffect?: TraumaEffect): string {
  const tier = getTraumaTier(trauma);
  if (tier === 'STABLE' || tier === 'STRESSED') return '';

  let block = `\n[TRAUMA STATE: ${TRAUMA_TIERS[tier].label.toUpperCase()} (trauma: ${trauma})]\n`;
  block += `The subject's perception is degrading. `;

  if (tier === 'UNSTABLE') {
    block += `Apply the following ONCE per 2-3 turns:\n`;
    block += `- Describe a sound, smell, or shadow that isn't there. Do NOT confirm it to the player.\n`;
    block += `- One NPC's dialogue should feel slightly wrong — too friendly, oddly worded.\n`;
    block += `- Do NOT tell the player they are hallucinating. Present everything as real.\n`;
  } else if (tier === 'DISSOCIATING') {
    block += `Apply one of these EVERY turn:\n`;
    block += `- Dead NPCs may occasionally "appear" in peripheral descriptions.\n`;
    block += `- Time gaps: skip minutes without narration.\n`;
    block += `- Briefly shift to third person perspective.\n`;
    block += `- Sensory anomalies: sounds that loop, colors that shift, familiar scents from the past.\n`;
    block += `Present ALL of these as real. The player must figure out what's real on their own.\n`;
  } else if (tier === 'BREAKING') {
    block += `The subject is fragmenting. Apply MULTIPLE effects per turn:\n`;
    block += `- Full hallucinated scenes the player must recognize as false.\n`;
    block += `- Flashback sequences interrupting current events.\n`;
    block += `- Roll requests may appear for things that aren't actually happening.\n`;
    block += `- Narrative contradictions (details that don't match prior turns).\n`;
    block += `- Extended third-person episodes.\n`;
    block += `NEVER acknowledge the unreliability. The narrative IS reality as far as the text is concerned.\n`;
  }

  if (activeEffect) {
    block += `\n[ACTIVE TRAUMA DIRECTIVE]: ${activeEffect.description}\n`;
  }

  block += `The player must figure out what's real on their own.\n`;
  return block;
}
