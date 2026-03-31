// ============================================================================
// ENGINE_CONFIG.TS — Centralized Tuning Constants
// v1.13: Gathered from simulationEngine.ts, contentValidation.ts,
//        characterDelta.ts, bioEngine.ts, promptUtils.ts
// ============================================================================

// ---------------------------------------------------------------------------
// Entity Status Lifecycle (v1.14)
// ---------------------------------------------------------------------------

/** Turns without mention before NEARBY → DISTANT. */
export const ENTITY_NEARBY_DECAY_TURNS = 3;
/** Turns without mention before DISTANT → MISSING. */
export const ENTITY_DISTANT_DECAY_TURNS = 8;

// ---------------------------------------------------------------------------
// Location Proximity Graph (v1.14)
// ---------------------------------------------------------------------------

/** Triangle inequality tolerance factor (1.2 = 20% slack). */
export const TRIANGLE_INEQUALITY_TOLERANCE = 1.2;
/** Maximum travel time (minutes) for instant NPC presence. */
export const MAX_INSTANT_TRAVEL_MINUTES = 30;
/** Default minutes per turn for distance→ETA conversion. */
export const DEFAULT_MINUTES_PER_TURN = 15;

// ---------------------------------------------------------------------------
// Threat Seed Pipeline
// ---------------------------------------------------------------------------

/** Maximum concurrent emerging threat seeds. */
export const THREAT_SEED_CAP = 3;

/** Turns at ETA ~1 before auto-expiry triggers. */
export const MAX_CONSECUTIVE_ETA_ONE = 3;

/** Minimum turns a lore entry must exist before threats can cite it. (v1.12 SE-6) */
export const LORE_MATURATION_TURNS = 3;

/** Maximum threat-tier points allowed per sliding window. (v1.12 SE-10)
 *  Tier points: Individual=1, Professional=2, Faction=3, Elite=5. */
export const ESCALATION_BUDGET_MAX = 8;

/** Sliding window size (in turns) for escalation budget. */
export const ESCALATION_WINDOW_TURNS = 10;

/** Minimum turns for information propagation between entities. (v1.12 SE-7) */
export const INFO_PROPAGATION_MIN_TURNS = 3;

/** Probability that a hostile NPC traversing hazardous area suffers attrition. (v1.12 SE-9) */
export const NPC_ATTRITION_CHANCE = 0.35;

/** Consequent hooks generated when a hook is consumed. (v1.12 SE-4) */
export const CONSEQUENT_HOOKS_PER_CONSUMPTION = 2;

// ---------------------------------------------------------------------------
// v1.17: Threat Denial Suppression + Global Cooldown
// ---------------------------------------------------------------------------

/** Origin Gate denials before an entity is auto-suppressed from future threats. // v1.19: Raised from 3 → 6 to prevent premature permanent suppression of factions */
export const DENIAL_SUPPRESSION_THRESHOLD = 6;

/** Maximum entries in the denial tracker before oldest are pruned. */
export const DENIAL_TRACKER_MAX_ENTRIES = 50;

/** v1.19: Turns before a re-seed block expires. Lowered from 10 to allow faster faction reuse. */
export const RESEED_BLOCK_TURNS_V19 = 5;

/** Turns of global threat cooldown after a threat arc concludes (all threats → 0). */
export const THREAT_ARC_COOLDOWN_TURNS = 5;

/** Cumulative Origin Gate denials in a sliding window that trigger a global cooldown. */
export const DENIAL_COOLDOWN_TRIGGER = 12; // v1.19: Raised from 8 — prevents premature engine shutdown

/** Turns of global cooldown triggered by cumulative denials. */
export const DENIAL_COOLDOWN_TURNS = 3; // v1.19: Lowered from 5 — cooldown is shorter but triggers later

/** Extra cooldown turns added when player input contains downtime keywords during active cooldown. */
export const DOWNTIME_COOLDOWN_EXTENSION = 2;

/** Maximum global cooldown duration (prevents runaway extension). */
export const THREAT_COOLDOWN_MAX = 20;

// ---------------------------------------------------------------------------
// Faction Exposure
// ---------------------------------------------------------------------------

/** Minimum exposure score required for a faction to seed threats. */
export const EXPOSURE_THRESHOLD_FOR_THREAT = 20;

/** Exposure earned when a faction NPC directly observes the player. */
export const EXPOSURE_DIRECT_OBSERVATION = 15;

/** Exposure earned when the player takes a notable public action. */
export const EXPOSURE_PUBLIC_ACTION = 10;

/** Exposure decay per turn when no new observations occur. */
export const EXPOSURE_DECAY_PER_TURN = 2;

// ---------------------------------------------------------------------------
// Hidden Registry
// ---------------------------------------------------------------------------

/** Maximum lines retained in the hidden registry before trimming. */
export const MAX_REGISTRY_LINES = 60;

// ---------------------------------------------------------------------------
// Time Caps (minutes per turn)
// ---------------------------------------------------------------------------

export const TIME_CAPS = {
    AWAKE_MAX: 120,
    SLEEP_MAX: 540,
    COMBAT_MAX: 30,
    SOCIAL_MAX: 15,       // v1.19.1: Hard cap for SOCIAL scene mode dialogue turns
} as const;

/** v1.19.1: Default time when AI returns 0 or undefined during non-sleep turns. */
export const TIME_FLOOR_MINUTES = 1;

// ---------------------------------------------------------------------------
// Memory & Lore
// ---------------------------------------------------------------------------

/** Maximum memory fragments before consolidation triggers. */
export const MEMORY_CAP = 40;

/** Jaccard similarity threshold for memory deduplication. */
// v1.20: Lowered from 0.55 to 0.42. The AI frequently rephrases the same event
// with varied vocabulary (e.g. "shattered a Golem with Kinetic Resonance" vs
// "used Kinetic Resonance to disintegrate a Golem's arm"), producing Jaccard
// scores of 0.45-0.55 that slip past the old threshold. 0.42 catches these
// while remaining above the 0.40 consolidation cluster threshold.
export const MEMORY_SIMILARITY_THRESHOLD = 0.42;

/** Jaccard similarity threshold for lore deduplication. */
export const LORE_SIMILARITY_THRESHOLD = 0.60;

/** Tighter threshold when two lore entries share a topic prefix. (v1.5 FIX 8) */
export const LORE_SAME_TOPIC_SIMILARITY_THRESHOLD = 0.45;

// ---------------------------------------------------------------------------
// Bio Engine
// ---------------------------------------------------------------------------

/** Hard ceiling multipliers — AI cannot set bio modifiers above these values. */
export const BIO_MODIFIER_CEILING = {
    calories: 3.0,
    hydration: 3.0,
    stamina: 3.0,
    lactation: 5.0,
} as const;

/** Rate at which bio modifiers decay toward baseline (1.0) per tick. */
export const BIO_MODIFIER_DECAY_RATE = 0.05;

// ---------------------------------------------------------------------------
// Character Delta (Condition Management)
// ---------------------------------------------------------------------------

/** Condition count above which the prune gate activates. */
export const CONDITION_PRUNE_THRESHOLD = 25;

/** Minimum removals this turn before any additions when above prune threshold. */
export const MIN_REMOVALS_BEFORE_ADD = 3;

/** Hard cap — no condition additions whatsoever at or above this count. */
export const CONDITION_HARD_CAP = 40;

/** Jaccard threshold for condition semantic deduplication. */
export const CONDITION_SIMILARITY_THRESHOLD = 0.50;

// ---------------------------------------------------------------------------
// RAG Engine
// ---------------------------------------------------------------------------

/** Default max lore entries injected into prompt context. */
export const RAG_LORE_LIMIT = 8;

/** Default max entity entries injected into prompt context. */
export const RAG_ENTITY_LIMIT = 6;

// ---------------------------------------------------------------------------
// Summarization
// ---------------------------------------------------------------------------

/** Summarize history every N turns. */
export const SUMMARIZATION_INTERVAL = 20;

// ---------------------------------------------------------------------------
// v1.21: Model-Adaptive Context Profiles
// ---------------------------------------------------------------------------
// Lite models have reduced instruction-following capacity and shorter effective
// attention spans. Sending 30 messages of history + 63KB system instructions
// overwhelms them, causing context drift by turn 10-15. These profiles scale
// context aggressively based on model capability.

export interface ModelContextProfile {
  /** Max chat messages retained in history sent to the API. */
  maxHistory: number;
  /** Turns between automatic history summarization. */
  summarizationInterval: number;
  /** Max memory items injected into prompt (others dropped by recency). */
  memoryLimit: number;
  /** Override RAG lore retrieval limit. */
  loreLimitOverride?: number;
  /** Override RAG entity retrieval limit. */
  entityLimitOverride?: number;
  /** How many recent messages to keep at full length (older ones get compressed). */
  recentFullMessages: number;
  /** Max characters for compressed (older) history messages. */
  compressedMessageLength: number;
  /** RAG lookback: how many recent model responses to analyze for relevance. */
  ragLookback: number;
}

export const MODEL_CONTEXT_PROFILES: Record<string, ModelContextProfile> = {
  'gemini-3-flash-preview': {
    maxHistory: 30,
    summarizationInterval: 20,
    memoryLimit: 40,
    recentFullMessages: 10,
    compressedMessageLength: 500,
    ragLookback: 5,
  },
  'gemini-3.1-flash-lite-preview': {
    maxHistory: 14,
    summarizationInterval: 8,
    memoryLimit: 15,
    loreLimitOverride: 6,
    entityLimitOverride: 5,
    recentFullMessages: 6,
    compressedMessageLength: 300,
    ragLookback: 6,
  },
  'gemini-2.5-flash': {
    maxHistory: 30,
    summarizationInterval: 20,
    memoryLimit: 40,
    recentFullMessages: 10,
    compressedMessageLength: 500,
    ragLookback: 5,
  },
  'gemini-2.5-flash-lite': {
    maxHistory: 14,
    summarizationInterval: 10,
    memoryLimit: 15,
    loreLimitOverride: 6,
    entityLimitOverride: 5,
    recentFullMessages: 6,
    compressedMessageLength: 300,
    ragLookback: 6,
  },
};

/** Default profile when model name is unknown. */
export const DEFAULT_CONTEXT_PROFILE: ModelContextProfile = {
  maxHistory: 20,
  summarizationInterval: 15,
  memoryLimit: 25,
  recentFullMessages: 8,
  compressedMessageLength: 400,
  ragLookback: 5,
};

/** Resolve the context profile for a given model name. */
export const getContextProfile = (modelName: string): ModelContextProfile =>
  MODEL_CONTEXT_PROFILES[modelName] ?? DEFAULT_CONTEXT_PROFILE;

// ---------------------------------------------------------------------------
// Prompt Construction
// ---------------------------------------------------------------------------

/** Keywords that indicate player downtime intent (skip threat escalation). */
export const DOWNTIME_KEYWORDS = [
    'sleep', 'rest', 'wait', 'camp', 'hide',
    'relax', 'craft', 'recover', 'read', 'eat',
    'drink', 'bath', 'wash', 'clean', 'sit',
    'meditate', 'heal', 'study', 'walk', 'travel',
    'say', 'ask', 'tell', 'shout', 'whisper', 'talk', 'kiss', 'hug',
    'masturbate', 'pleasure', 'touch myself', 'jerk', 'orgasm',
    'cook', 'sew', 'repair', 'sharpen', 'whittle', 'carve',
    'pray', 'contemplate', 'think', 'ponder', 'reflect',
    'undress', 'dress', 'change', 'groom', 'shave',
    'stretch', 'exercise', 'train', 'practice', 'spar',
    'write', 'draw', 'sketch', 'journal', 'sing', 'hum',
    'pet', 'feed', 'tend', 'water', 'garden',
    'browse', 'shop', 'haggle', 'barter', 'trade',
    'lock', 'bar the door', 'close the door', 'stay inside',
] as const;

/** v1.17: Keywords that indicate the player is actively seeking trouble.
 *  These BREAK an active global threat cooldown. */
export const AGGRESSION_KEYWORDS = [
    'attack', 'fight', 'hunt', 'ambush', 'stalk', 'pursue', 'confront',
    'challenge', 'provoke', 'threaten', 'raid', 'assault', 'charge',
    'kill', 'murder', 'steal', 'rob', 'pickpocket', 'break in',
    'trespass', 'infiltrate', 'sabotage', 'destroy', 'burn',
    'draw my weapon', 'draw my sword', 'draw my knife', 'draw my gun',
    'look for trouble', 'looking for a fight', 'pick a fight',
] as const;

// --- Stream 4: Trauma Narrative Effects ---
export const TRAUMA_TIERS = {
  STABLE:       { min: 0,  max: 29, label: 'Stable' },
  STRESSED:     { min: 30, max: 49, label: 'Stressed' },
  UNSTABLE:     { min: 50, max: 69, label: 'Unstable' },
  DISSOCIATING: { min: 70, max: 84, label: 'Dissociating' },
  BREAKING:     { min: 85, max: 100, label: 'Breaking' },
} as const;

export type TraumaTier = keyof typeof TRAUMA_TIERS;

export const TRAUMA_EFFECT_CHANCE: Record<TraumaTier, number> = {
  STABLE: 0,
  STRESSED: 0,
  UNSTABLE: 0.15,
  DISSOCIATING: 0.35,
  BREAKING: 0.60,
};

export const TRAUMA_EFFECT_COOLDOWN_TURNS = 2;

// ---------------------------------------------------------------------------
// Stream 5: Skill Advancement Thresholds
// ---------------------------------------------------------------------------

export const SKILL_ADVANCEMENT_THRESHOLD: Record<string, number> = {
  untrained: 3,
  familiar: 8,
  trained: 20,
  expert: 50,
  master: Infinity,
};

// ---------------------------------------------------------------------------
// Stream 6: Faction Conflict Configuration
// ---------------------------------------------------------------------------

export const FACTION_CONFLICT_TRIGGER_CHANCE = 0.15;
export const FACTION_CONFLICT_MIN_INFLUENCE = 30;
export const FACTION_CONFLICT_RESOLUTION_THRESHOLD = 80;
export const FACTION_MOMENTUM_SHIFT_RANGE = 15;
export const FACTION_MAX_CONFLICTS = 3;
