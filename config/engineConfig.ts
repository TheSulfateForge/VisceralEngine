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
} as const;

// ---------------------------------------------------------------------------
// Memory & Lore
// ---------------------------------------------------------------------------

/** Maximum memory fragments before consolidation triggers. */
export const MEMORY_CAP = 40;

/** Jaccard similarity threshold for memory deduplication. */
export const MEMORY_SIMILARITY_THRESHOLD = 0.55;

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
