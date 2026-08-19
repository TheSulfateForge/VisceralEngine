// ============================================================================
// TYPES.TS — Visceral Engine Type Definitions
// v1.6: Added DormantHook, HookCategory, HookStatus, FactionExposureEntry,
//       FactionExposure. Extended WorldTickEvent with dormantHookId and
//       playerActionCause. Extended GameWorld with dormantHooks and factionExposure.
// ============================================================================

// --- Nominal ID Types (prevent accidental mixing) ---
declare const __brand: unique symbol;
type Brand<T, B> = T & { [__brand]: B };

export type SaveId    = Brand<string, 'SaveId'>;
export type MessageId = Brand<string, 'MessageId'>;
export type LoreId    = Brand<string, 'LoreId'>;
export type MemoryId  = Brand<string, 'MemoryId'>;
export type TemplateId = Brand<string, 'TemplateId'>;
export type WorldSeedId = Brand<string, 'WorldSeedId'>;

// --- Scalar / Union Types ---

export const SCENE_MODES = ['NARRATIVE', 'SOCIAL', 'TENSION', 'COMBAT'] as const;
export type SceneMode = typeof SCENE_MODES[number];

// v1.20: Clock-derived narrative time phase. The engine derives the current
// phase from the world clock at prompt-build time and injects it into the
// system prompt; the AI echoes back the phase its narrative depicts via
// `scene_time_phase`. A mismatch is the AI hallucinating time of day.
export const SCENE_TIME_PHASES = [
    'deep_night', 'pre_dawn', 'dawn', 'morning', 'midday',
    'afternoon', 'dusk', 'evening', 'night'
] as const;
export type SceneTimePhase = typeof SCENE_TIME_PHASES[number];

// v1.21: Time-velocity ladder. ORTHOGONAL to `scene_mode` — scene_mode carries
// tone/danger (NARRATIVE/SOCIAL/TENSION/COMBAT) while time_mode carries time
// velocity + pipeline gating. When the AI omits time_mode the engine derives a
// default from scene_mode (see deriveTimeModeFromScene), so legacy saves and
// older responses keep working without a save migration.
//   TICK     seconds–minutes   AI owns clock   cap 30m    skip world-tick
//   SCENE    minutes–hours     AI (clock-bound) cap 120m  all steps
//   ACTIVITY hours (declared)  player          cap 1440m  skip combat
//   REST     hours (declared)  player/engine   cap 540m   skip combat + faction
//   MONTAGE  days–years        player          calendar   summary-only
export const TIME_MODES = ['TICK', 'SCENE', 'ACTIVITY', 'REST', 'MONTAGE'] as const;
export type TimeMode = typeof TIME_MODES[number];

export enum Role {
    USER = 'user',
    MODEL = 'model',
    SYSTEM = 'system',
}
export type RoleType = Role;

export type RollOutcome = 'CRITICAL FAILURE' | 'FAILURE' | 'MIXED/COST' | 'SUCCESS' | 'STRONG SUCCESS' | 'CRITICAL SUCCESS';
export type ConditionSeverity = 'minor' | 'traumatic' | 'lethal';

// --- Bio Types ---

export interface BioModifiers {
    calories: number;
    hydration: number;
    stamina: number;
    lactation: number;
}

export interface BioMonitor {
    metabolism: {
        calories: number;
        hydration: number;
        stamina: number;
        libido: number;
    };
    pressures: {
        bladder: number;
        bowels: number;
        lactation: number;
        seminal: number;
    };
    timestamps: {
        lastSleep: number;
        lastMeal: number;
        lastOrgasm: number;
    };
    modifiers: BioModifiers;
}

export interface BioInputs {
    ingested_calories?: number;
    ingested_water?: number;
    sleep_hours?: number;
    relieved_pressure?: string[]; // ["lactation", "bladder"]
}

export const PREGNANCY_STATUSES = ['gestating', 'birth', 'terminated'] as const;
export type PregnancyStatus = typeof PREGNANCY_STATUSES[number];

export interface Pregnancy {
    id: string;
    motherName: string;
    fatherName: string;
    conceptionTurn: number;
    conceptionTime: number;
    currentWeek: number;
    isVisible: boolean;
    status: PregnancyStatus;
}

// --- Enemy AI Systems ---

export const ENEMY_ARCHETYPES = ['AMATEUR', 'PROFESSIONAL', 'FANATIC', 'MONSTER'] as const;
export type EnemyArchetype = typeof ENEMY_ARCHETYPES[number];

export const ENEMY_STATES = ['EFFECTIVE', 'COMPROMISED', 'BROKEN'] as const;
export type EnemyState = typeof ENEMY_STATES[number];

export const COVER_STATES = ['OPEN', 'PARTIAL', 'FULL'] as const;
export type CoverState = typeof COVER_STATES[number];

export const DISTANCES = ['MELEE', 'CLOSE', 'FAR'] as const;
export type Distance = typeof DISTANCES[number];

export const LIGHTING_LEVELS = ['BRIGHT', 'DIM', 'DARK'] as const;
export type Lighting = typeof LIGHTING_LEVELS[number];

export interface CombatEnvironment {
    summary: string;
    lighting: Lighting;
    weather: string;
    terrain_tags: string[];
}

export interface ActiveThreat {
    id: string;
    name: string;
    archetype: EnemyArchetype;
    status: EnemyState;
    condition: string;
    current_action: string;
    cover_state: CoverState;
    distance: Distance;
}

// --- Social Realism Systems ---

// --- Entity Status Lifecycle (v1.14) ---
export const ENTITY_STATUSES = [
    'present',    // In the current scene, actively interactable
    'nearby',     // At the same location but not in the immediate scene
    'distant',    // At a known location far from the player
    'missing',    // Location unknown — disappeared, fled, untracked
    'dead',       // Confirmed dead — engine blocks all actions from them
    'retired',    // Narratively concluded — sailed away, imprisoned, etc.
] as const;
export type EntityStatus = typeof ENTITY_STATUSES[number];

export const RELATIONSHIP_LEVELS = ['NEMESIS', 'HOSTILE', 'COLD', 'NEUTRAL', 'WARM', 'ALLIED', 'DEVOTED'] as const;
export type RelationshipLevel = typeof RELATIONSHIP_LEVELS[number];

export interface KnownEntity {
    id: string;
    name: string;
    role: string;
    location: string;
    impression: string;
    relationship_level: RelationshipLevel;
    leverage: string;
    ledger: string[];

    // --- Characterization (v1.16) ---
    /**
     * Canonical personality descriptors for this entity — traits, quirks,
     * beliefs, habits. Sourced from the World Seed for named seed NPCs and
     * surfaced as its own field in the per-turn entity context so the model
     * does not default-fill characterization from the system prompt's
     * threat-parity language. Free-form text; commas/semicolons fine.
     */
    personality?: string;

    /**
     * v1.24: One or two lines of this NPC's actual dialogue, captured at
     * creation or when a defining line lands. Injected into the ACTIVE
     * ENTITIES block as a register anchor — models imitate an exemplar far
     * more reliably than they obey trait adjectives, so this is the primary
     * defense against voice drift across long campaigns.
     */
    voice_sample?: string;

    /**
     * v1.27: True for NPCs born from the WorldSeed (and anything else the
     * engine should treat as protected canon). Canonical entities:
     *   - can only die via an EXPLICIT death signal (full-name death phrase
     *     in an entity update or narrative) — never via loose first-name/
     *     death-keyword co-occurrence in lore;
     *   - are always listed in the cache-stable WORLD ROSTER so the model
     *     knows they exist even when fully dormant (zero per-turn cost);
     *   - decay to 'missing' is harmless for them — the roster + mention
     *     sentinel rehydrate them the moment they're referenced again.
     */
    canonical?: boolean;

    // --- v1.14: Entity Status Lifecycle ---
    status?: EntityStatus;
    lastSeenTurn?: number;
    firstSeenTurn?: number;
    exitReason?: string;
    statusChangedTurn?: number;
}

export interface NPCInteraction {
    speaker: string;
    dialogue: string;
    subtext: string;
    biological_tells: string;
}

// --- Location Proximity Graph (v1.14) ---

export interface LocationNode {
    /** Unique identifier — normalized lowercase name. */
    id: string;
    /** Display name as introduced in narrative. */
    displayName: string;
    /** Short description from first mention. */
    description?: string;
    /** Turn when this location was first mentioned. */
    firstMentionedTurn: number;
    /** Tags for categorization (e.g., 'settlement', 'wilderness', 'interior'). */
    tags: string[];
}

export interface LocationEdge {
    /** ID of source location node. */
    from: string;
    /** ID of destination location node. */
    to: string;
    /** Travel time in minutes by default movement mode. */
    travelTimeMinutes: number;
    /** How this edge was established (for debugging). */
    source: 'ai_declared' | 'inferred_from_narrative' | 'player_travel';
    /** Turn when this edge was created. */
    createdTurn: number;
    /** Optional: travel modes with time overrides.
     *  E.g., { "horseback": 60, "foot": 180, "carriage": 120 } */
    modeOverrides?: Record<string, number>;
}

export interface LocationGraph {
    /** All known locations. Keyed by normalized ID. */
    nodes: Record<string, LocationNode>;
    /** All known travel connections. */
    edges: LocationEdge[];
    /** The player's current location ID. */
    playerLocationId: string;
}

// --- Threat Seed State Machine (v1.3) ---
// Enhanced WorldTickEvent with full state tracking to enforce ETA floors,
// the 3-seed cap, and auto-expiry of threats stuck at ETA ~1.

/**
 * v1.28: 'unvalidated' added.
 *
 * Previously the Origin Gate DELETED any threat it rejected. Because rejected
 * threats never reached `world.emergingThreats`, the next turn's
 * processThreatSeeds() could never find an `existing` record for them — which
 * silently disabled the three mechanisms that keep a threat coherent across
 * turns: the monotonic ETA countdown, the description lock, and the pivot
 * penalty. The model was then free to re-invent both the wording and the ETA
 * of the "same" threat every single turn, which is what players experienced as
 * a world event that mutates and re-aims on contact.
 *
 * An 'unvalidated' threat is one the Origin Gate rejected but that the engine
 * still REMEMBERS. It is a continuity anchor, not a live threat:
 *   - it is never surfaced to the player or written to the hidden registry;
 *   - it can never reach 'triggered' — it cannot act on the player;
 *   - it DOES anchor description + ETA, so a re-submission of the same idea is
 *     locked to the original wording and forced to count down monotonically;
 *   - it is re-tested by the gate every turn, so the model can legitimise it by
 *     supplying a real cause (promotion);
 *   - it self-expires after UNVALIDATED_THREAT_MAX_TURNS so it cannot linger.
 */
export type ThreatStatus = 'building' | 'imminent' | 'triggered' | 'expired' | 'unvalidated';

// --- v1.6: Dormant Hook Registry ---
// Pre-existing tension vectors extracted from character backstory at session start.
// Every new threat seed must cite one of these, or cite a specific player action,
// or belong to a faction with sufficient exposure score. No other origin is valid.

/** Categories of latent tension vectors extracted from character backstory. */
export type HookCategory =
    | 'relationship'   // an existing NPC tie with unresolved tension
    | 'backstory'      // a past event that could catch up to them
    | 'secret'         // something the character knows or possesses that others want
    | 'resource'       // something of value the character has (ability, item, lineage)
    | 'location';      // somewhere the character has history or stakes

export type HookStatus = 'dormant' | 'activated' | 'resolved';

/**
 * A latent threat vector extracted from character backstory at session start.
 * Threats may ONLY be seeded if they reference a DormantHook OR cite a specific
 * player action from this session as their cause. No other origin is valid.
 */
export interface DormantHook {
    id: string;                      // e.g. "hook_brennan_favor"
    summary: string;                 // one-sentence description of the tension
    category: HookCategory;
    sourceField: string;             // 'backstory' | 'relationships' | 'goals' | 'consequent_hook' (v1.12)
    involvedEntities: string[];      // names of NPCs or factions involved
    activationConditions: string;    // what player action or event would wake this
    status: HookStatus;
    activatedTurn?: number;
    resolvedTurn?: number;
    // v1.11: Hook Cooldown — prevents infinite threat re-seeding from broad hooks
    cooldownUntilTurn?: number;       // Hook cannot source new threats until this turn
    lastThreatExpiredTurn?: number;   // When the most recent threat from this hook expired
    totalThreatsSourced?: number;     // Lifetime count — used for escalating cooldowns
}

// --- v1.6: Faction Exposure Scoring ---
// Tracks how much a given faction or individual has observed of the player.
// Exposure must accumulate through actual in-session events before a threat
// can be seeded referencing that faction.

/**
 * Per-faction or per-NPC exposure entry.
 * Exposure earns the right to threaten — no observation = no valid threat seed.
 */
export interface FactionExposureEntry {
    exposureScore: number;           // 0–100. Threats require ≥ 20 to be valid.
    lastObservedAction: string | null;
    lastObservedTurn: number;
    observedCapabilities: string[];  // what this entity has concretely witnessed
}

/** Keyed by faction name or NPC name for individuals. */
export type FactionExposure = Record<string, FactionExposureEntry>;

// --- v1.11: Threat Arc History ---
// Tracks entity names from expired/blocked threats to prevent re-seeding.
// When a threat expires, its actors are recorded here so the AI can't
// immediately create a "new" threat with the same entity names.

export interface ThreatArcEntry {
    entityNames: string[];          // lowercase entity names from the expired threat
    expiredTurn: number;            // when this threat expired/was blocked
    descriptionSnippet: string;     // first 80 chars for debug logging
}

/** Keyed by hookId, "playerAction", or "factionExposure". */
export type ThreatArcHistory = Record<string, ThreatArcEntry[]>;

// --- v1.17: Threat Denial Tracking ---
// Tracks how many times each entity name has been denied by the Origin Gate.
// After reaching the suppression threshold, threats mentioning that entity
// are silently dropped before reaching the Origin Gate validation.

export interface ThreatDenialEntry {
    /** Number of times this entity appeared in a blocked threat. */
    denialCount: number;
    /** Turn when the most recent denial occurred. */
    lastDeniedTurn: number;
    /** Turn when auto-suppression activated (undefined = not yet suppressed). */
    suppressedAtTurn?: number;
}

/** Keyed by lowercase entity name fragment. */
export type ThreatDenialTracker = Record<string, ThreatDenialEntry>;

export interface WorldTickEvent {
    description: string;
    turns_until_impact?: number;
    // v1.3 additions — populated and maintained by the engine, not the AI:
    id?: string;
    factionSource?: string;
    turnCreated?: number;
    minimumEtaFloor?: number;
    consecutiveTurnsAtEtaOne?: number;
    requiredLoreCapability?: string;
    status?: ThreatStatus;
    // v1.6 additions — Origin Gate fields (AI-populated, engine-validated):
    dormantHookId?: string;      // Must match a DormantHook.id to pass origin gate
    playerActionCause?: string;  // Describes the specific player action this session that caused this
    // v1.8 additions — Anti-replacement loop fields (engine-managed):
    entitySourceNames?: string[];  // Entity names extracted from description at creation for continuity matching
    pivotPenaltyApplied?: number;  // Turn when a plan-pivot penalty was last applied (prevents stacking)
    // v1.9 addition:
    originalEta?: number;          // ETA at creation, for tracking progression vs retcon
    // v1.11: Track which hook sourced this threat (immutable after creation)
    originHookId?: string;         // Set once at creation; used for cooldown + re-seed detection
    // --- v1.28: Origin Gate rejection bookkeeping (engine-managed) ---
    /** Why the Origin Gate rejected this threat. Set only when status === 'unvalidated'. */
    gateBlockedReason?: string;
    /** First turn this threat entered 'unvalidated'. Drives self-expiry. */
    unvalidatedSinceTurn?: number;
    /** Turn an 'unvalidated' threat passed the gate and became live. Debug/telemetry only. */
    promotedTurn?: number;
}

// --- Faction Intelligence (v1.3) ---
// Tracks what each faction knows about the player and HOW they know it.
// Prevents NPC omniscience by requiring sourced information chains.

export type FactionConfidenceLevel = 'none' | 'rumor' | 'report' | 'confirmed';

export interface FactionIntelligenceEntry {
    knownPlayerLocation: string | null;
    locationConfidenceLevel: FactionConfidenceLevel;
    lastUpdatedTurn: number;
    informationSource: string;
}

export type FactionIntelligence = Record<string, FactionIntelligenceEntry>;

// --- Legal Status (v1.3) ---
// Tracks active and resolved legal claims against the player.
// Prevents the same resolved claim from being re-litigated.

export type ClaimValidity = 'active' | 'disputed' | 'invalid' | 'resolved';

export interface LegalClaim {
    id: string;
    claimant: string;
    subject: string;
    basis: string;
    validity: ClaimValidity;
    resolvedBy?: string;
    resolvedTurn?: number;
}

export interface LegalStatus {
    knownClaims: LegalClaim[];
    playerDocuments: string[];
}

// --- World Tick Types ---

export interface WorldTickAction {
    npc_name: string;
    action: string;
    player_visible: boolean;
}

export interface WorldTick {
    npc_actions: WorldTickAction[];
    environment_changes: string[];
    emerging_threats: WorldTickEvent[];
}

// --- Stream 4: Trauma Narrative Effects ---
export type TraumaEffectType =
  | 'unreliable_narration'
  | 'hallucinated_entity'
  | 'sensory_distortion'
  | 'flashback'
  | 'paranoia'
  | 'dissociation';

export interface TraumaEffect {
  type: TraumaEffectType;
  tier: string;  // TraumaTier from engineConfig
  description: string;
}

// --- Stream 6: Faction-Scale Conflict ---
export interface Faction {
  id: string;
  name: string;
  description: string;
  territory: string[];
  influence: number;
  disposition: Record<string, FactionDisposition>;
  resources: FactionResource[];
  leader?: string;
  memberEntityIds: string[];
  playerStanding: FactionStanding;
  activeObjective?: string;
}

export type FactionDisposition = 'allied' | 'neutral' | 'rival' | 'war';

// --- Stream 7: Persistent World Seeds ---
export interface WorldSeedLocation {
  name: string;
  description: string;
  tags: string[];
  connections: { to: string; travelTimeMinutes: number; mode?: string }[];
  controllingFaction?: string;
}

export interface WorldSeedFaction {
  name: string;
  description: string;
  territory: string[];
  influence: number;
  resources: string[];
  dispositions: Record<string, string>;
  leader?: string;
  keyMembers: string[];
}

export interface WorldSeedLore {
  keyword: string;
  content: string;
  category: string;
}

export interface WorldSeedNPC {
  name: string;
  role: string;
  location: string;
  faction?: string;
  description: string;
  personality: string;
  goals: string[];
}

export interface WorldSeedRule {
  name: string;
  description: string;
}

export interface WorldSeed {
  id: WorldSeedId;
  name: string;
  description: string;
  timestamp: string;
  lastModified: string;
  locations: WorldSeedLocation[];
  factions: WorldSeedFaction[];
  lore: WorldSeedLore[];
  npcs: WorldSeedNPC[];
  rules: WorldSeedRule[];
  tags: string[];
  thumbnail?: string;
}

export interface FactionStanding {
  reputation: number;
  rank?: string;
  knownActions: string[];
}

export type FactionResource = 'military' | 'economic' | 'intelligence' | 'magical' | 'political';

export interface FactionConflict {
  id: string;
  aggressorId: string;
  defenderId: string;
  type: 'skirmish' | 'trade_war' | 'territory_dispute' | 'full_war' | 'cold_war';
  startTurn: number;
  stakes: string;
  momentum: number;
  lastEscalationTurn: number;
  playerInvolvement: 'none' | 'observer' | 'participant' | 'catalyst';
}

// --- Location Proximity Graph (v1.14) ---

export interface LocationNode {
    id: string;
    displayName: string;
    description?: string;
    firstMentionedTurn: number;
    tags: string[];
}

export interface LocationEdge {
    from: string;
    to: string;
    travelTimeMinutes: number;
    source: 'ai_declared' | 'inferred_from_narrative' | 'player_travel';
    createdTurn: number;
    modeOverrides?: Record<string, number>;
}

export interface LocationGraph {
    nodes: Record<string, LocationNode>;
    edges: LocationEdge[];
    playerLocationId: string;
}

export interface LocationUpdate {
    location_name: string;
    description?: string;
    tags?: string[];
    traveled_from?: string;
    travel_time_minutes?: number;
    nearby_locations?: Array<{
        name: string;
        travel_time_minutes: number;
        mode?: string;
    }>;
}

// --- Stream 5: Skill / Proficiency System ---
export type ProficiencyLevel = 'untrained' | 'familiar' | 'trained' | 'expert' | 'master';

export const PROFICIENCY_MODIFIERS: Record<ProficiencyLevel, number> = {
  untrained: -2,
  familiar: 0,
  trained: 2,
  expert: 4,
  master: 6,
};

export interface Skill {
  id: string;
  name: string;
  category: SkillCategory;
  level: ProficiencyLevel;
  source: string;
  usageCount: number;
  lastUsedTurn?: number;
}

export type SkillCategory = 'combat' | 'physical' | 'social' | 'knowledge' | 'craft';

// --- Schema Types (Matches JSON Output) ---

export interface RollRequest {
    challenge: string;
    bonus?: number;
    advantage?: boolean;
    disadvantage?: boolean;
    relevant_skill?: string;
    /** Optional category hint, used only when `relevant_skill` names a skill the
     *  character does not yet have and Path B must auto-create it. Defaults to
     *  'knowledge' when omitted. */
    relevant_skill_category?: SkillCategory;
}

export interface BargainRequest {
    description: string;
}

export interface LoreItem {
    id: LoreId;
    keyword: string;
    content: string;
    timestamp: string;
    semanticUpdateOf?: LoreId;
    // v1.12: Turn when this lore was created. Used for maturation checks —
    // lore created within LORE_MATURATION_TURNS cannot be cited by threats.
    turnCreated?: number;
}

export interface Scenario {
    title: string;
    description: string;
    opening_line: string;
}

export interface CombatContext {
    environment: CombatEnvironment;
    active_threats: ActiveThreat[];
}

export interface CharacterUpdates {
    added_conditions?: string[];
    removed_conditions?: string[];
    added_inventory?: string[];
    removed_inventory?: string[];
    trauma_delta?: number;
    bio_modifiers?: Partial<BioModifiers>;
    /**
     * Full replacement of the relationships array. Use sparingly — prefer the
     * additive `added_relationships` / `removed_relationships` fields below
     * to avoid accidentally wiping pre-existing ties.
     */
    relationships?: string[];
    /**
     * Full replacement of the goals array. Use sparingly — prefer the
     * additive `added_goals` / `removed_goals` fields below to avoid
     * accidentally wiping pre-existing directives.
     */
    goals?: string[];
    added_relationships?: string[];
    removed_relationships?: string[];
    added_goals?: string[];
    removed_goals?: string[];
    skill_updates?: Array<{
        skill_name: string;
        /** AI-declared target level. Typed as string because the model can emit
         *  out-of-vocabulary values; the engine validates before applying. */
        new_level: string;
        reason: string;
        /** Optional category for AI-declared NEW skills. Defaults to 'knowledge'. */
        category?: SkillCategory;
    }>;
}

// ============================================================================
// --- Montage System (Steps 5–9) ---
// A montage is a player-declared time skip (days→years) that produces an
// UNCOMMITTED proposal. The AI fills a `montage_block`; the engine holds it as
// a `MontageProposal` whose items the player vetoes/edits/accepts before a
// single Dexie transaction writes the approved results. See
// TIME_AND_MONTAGE_DESIGN.md Systems 4 & 5.
// ============================================================================

export const MONTAGE_TYPES = ['training', 'travel', 'aging', 'rest', 'work'] as const;
export type MontageType = typeof MONTAGE_TYPES[number];

/** Per-entity change kinds the AI may propose for known NPCs during a montage. */
export const NPC_DELTA_CHANGE_TYPES = [
    'none', 'aged', 'moved', 'married', 'died', 'role_change', 'new_relationship',
] as const;
export type NpcDeltaChangeType = typeof NPC_DELTA_CHANGE_TYPES[number];

// --- Declared-action UI affordance (System 4 / Step 5) ---

/** Time units the player can pick in the declared-action picker. */
export const DECLARED_ACTION_UNITS = ['hours', 'days', 'weeks', 'months', 'years'] as const;
export type DeclaredActionUnit = typeof DECLARED_ACTION_UNITS[number];

/**
 * Declared-action verbs. The bare verbs (sleep/study/train/travel/work) resolve
 * to ACTIVITY or REST at sub-day granularity; the `montage:*` variants force
 * MONTAGE mode and invoke the proposal flow.
 */
export const DECLARED_ACTION_TYPES = [
    'sleep', 'study', 'train', 'travel', 'work',
    'montage:training', 'montage:travel', 'montage:aging', 'montage:rest', 'montage:work',
] as const;
export type DeclaredActionType = typeof DECLARED_ACTION_TYPES[number];

/** A duration-bearing action declared by the player via the UI picker. */
export interface DeclaredAction {
    actionType: DeclaredActionType;
    unit: DeclaredActionUnit;
    quantity: number;
    /** Optional focus (e.g. "swordsmanship" for train, "history" for study). */
    focus?: string;
    /** Engine-derived from unit × quantity at resolve time. */
    durationMinutes: number;
}

// --- Montage block (response-schema payload from the AI) ---

export interface ProposedMemory {
    summary: string;
    /** 1–5 salience; drives pinning + eviction once committed. */
    salience: number;
    pinned?: boolean;
    /** When true the player may "play this out" as a live scene before committing. */
    can_play_out?: boolean;
}

export interface ProposedTrauma {
    description: string;
    /** 1–5 severity. */
    severity: number;
    source: string;
}

export interface ProposedSkillUpdate {
    skill_name: string;
    /** AI-declared target level. Typed as string — validated before applying
     *  (mirrors CharacterUpdates.skill_updates). Montage caps advancement to
     *  a single tier per skill regardless of duration. */
    new_level: string;
    category?: SkillCategory;
    reason: string;
}

export interface ProposedNpcDelta {
    entity_id: string;
    change_type: NpcDeltaChangeType;
    description: string;
}

/** The AI's montage output, attached to the model response in MONTAGE mode. */
export interface MontageBlock {
    type: MontageType;
    /** Engine-derived from the player's declared duration. */
    duration_minutes: number;
    focus?: string;
    proposed_memories: ProposedMemory[];
    proposed_traumas: ProposedTrauma[];
    proposed_skill_updates: ProposedSkillUpdate[];
    proposed_npc_deltas: ProposedNpcDelta[];
    /** Years to add to Character.age (aging montages). 0 for non-aging. */
    age_increment_years: number;
    /** Optional explicit season label at the end of the montage. */
    season_delta?: string;
}

// --- Held proposal model (uncommitted, player-reviewed) ---

export type MontageItemStatus = 'pending' | 'accepted' | 'vetoed' | 'edited';

/** One reviewable line item in a proposal. `original` retains the pristine AI
 *  payload so an edit can be reverted; `data` is the (possibly edited) payload
 *  that will be committed if status ≠ 'vetoed'. */
export interface ReviewableItem<T> {
    /** Stable id for UI keys + per-item veto/edit/accept routing. */
    id: string;
    status: MontageItemStatus;
    data: T;
    original: T;
}

export type MontageProposalStatus = 'reviewing' | 'committed' | 'discarded';

/**
 * The uncommitted montage proposal held in the pending slice AND persisted to
 * the `pending_montage` Dexie row (one per campaign) so a mid-review app close
 * does not lose it. On accept, approved items are written in a single tx and
 * the row is cleared.
 */
export interface MontageProposal {
    /** Proposal id — also the pending_montage row id. */
    id: string;
    /** Owning campaign (save) id, for DB persistence + projection. */
    campaignId: string;
    createdTurn: number;
    /** What the player asked for (drives clock advance even on veto-all). */
    declaredAction: DeclaredAction;
    type: MontageType;
    durationMinutes: number;
    focus?: string;
    ageIncrementYears: number;
    seasonDelta?: string;
    /** The montage prose the AI produced (shown above the review items). */
    narrative: string;
    memories: ReviewableItem<ProposedMemory>[];
    traumas: ReviewableItem<ProposedTrauma>[];
    skillUpdates: ReviewableItem<ProposedSkillUpdate>[];
    npcDeltas: ReviewableItem<ProposedNpcDelta>[];
    /** Regenerate attempts used so far (cap MONTAGE_MAX_REGENERATES). */
    regenerateCount: number;
    /** Set while a memory is being promoted to a live scene ("play this out"). */
    promotedMemoryId?: string;
    status: MontageProposalStatus;
}

/** Review item 1: per-call token usage surfaced from Gemini's usageMetadata. */
export interface TokenUsage {
    promptTokenCount: number;
    candidatesTokenCount: number;
    cachedContentTokenCount: number;
    thoughtsTokenCount: number;
    totalTokenCount: number;
}

export interface ModelResponseSchema {
    thought_process: string;
    /** Review item 1: token accounting for this generation (runtime-only, not in the response schema). */
    usageMetadata?: TokenUsage;
    scene_mode: SceneMode;
    tension_level: number;
    narrative: string;

    // v1.20: Phase the narrative depicts. Optional in TS for back-compat with
    // saved responses from before this field existed; the response schema
    // marks it required so new generations always supply it.
    scene_time_phase?: SceneTimePhase;

    // v1.21: Time-velocity mode (orthogonal to scene_mode). Optional — when
    // absent the engine derives it from scene_mode. Drives time caps + pipeline
    // gating, not tone.
    time_mode?: TimeMode;

    /**
     * v1.31: 0-2 short clauses naming what this turn established and therefore
     * spent. Folded into world.sceneLedger so a later turn can see what is
     * already covered instead of re-establishing it.
     */
    established?: string[];

    /**
     * v1.31: 0-2 short clauses capturing facts the PLAYER asserted this turn
     * about their own character. Folded into world.playerCanon.
     */
    player_assertions?: string[];

    time_passed_minutes?: number;
    biological_inputs?: BioInputs;

    character_updates?: CharacterUpdates;

    combat_context?: CombatContext;
    known_entity_updates?: KnownEntity[];
    npc_interaction?: NPCInteraction;
    roll_request?: RollRequest;
    bargain_request?: BargainRequest;
    hidden_update?: string;
    /**
     * @deprecated v1.22 — kept for back-compat. The pipeline promotes a
     * non-null `new_memory` into a single-element `new_memories` array.
     */
    new_memory?: { fact: string };
    /**
     * v1.22: Multi-fact memory writes per turn. Each entry may include a
     * salience score (1–5) and tags ('vow' | 'oath' | 'debt' | 'reveal' |
     * 'death' | 'identity' | 'betrayal' | ...). Tags drive pinning, salience
     * drives eviction order when at MEMORY_CAP.
     */
    new_memories?: Array<{ fact: string; salience?: number; tags?: string[] }>;
    new_lore?: { keyword: string; content: string };
    biological_event?: boolean;
    location_update?: LocationUpdate;

    faction_updates?: Array<{
        faction_name: string;
        influence_delta?: number;
        territory_gained?: string[];
        territory_lost?: string[];
        player_reputation_delta?: number;
        new_objective?: string;
    }>;

    world_tick?: WorldTick;

    // v0.13: MONTAGE mode only. The AI's proposed time-skip consequences,
    // held uncommitted as a MontageProposal pending player review.
    montage_block?: MontageBlock;
}

// --- Application Types ---

export interface DebugLogEntry {
    timestamp: string;
    message: string;
    type: 'info' | 'error' | 'success' | 'warning';
}

export interface ChatMessage {
    id: MessageId;
    role: Role;
    text: string;
    timestamp: string;
    rollRequest?: RollRequest;
    bargainRequest?: BargainRequest;
    npcInteraction?: NPCInteraction;
    worldTick?: WorldTick;
    isResolved?: boolean;
    metadata?: Record<string, unknown>;
    /**
     * v1.31: Out-of-character exchange — the player's meta-instruction or
     * clarification, or the engine's OOC answer to one. These messages are NOT
     * narrative: they must be excluded from anything that reads "the last thing
     * that happened in the fiction" (situation recap, repetition detection,
     * softening-tell length baselines, summarization windows).
     */
    ooc?: boolean;
}

// --- v1.31: Player-authored canon -------------------------------------------

/**
 * A fact the PLAYER asserted about their own character or about previously
 * established world state.
 *
 * Before this existed the model owned every state channel — world_tick,
 * new_memories, character_updates, location_update — while the player's input
 * went only into raw chat history. That asymmetry is why corrections did not
 * stick: in the reviewed save the player said the armor keeps her warm and the
 * very next turn the model re-said "it'll keep you from freezing", because the
 * correction was one chat message competing with ~110k chars of context while
 * the model's own prior assumption was baked into state and prose.
 */
export interface PlayerCanonEntry {
    id: string;
    /** Short declarative clause, e.g. "Armor maintains body temperature when deployed." */
    fact: string;
    /** Turn on which the player asserted it. */
    turnAsserted: number;
    /** True when it arrived through the OOC channel rather than in-character prose. */
    viaOoc: boolean;
}

// --- v1.31: Scene-scoped working memory -------------------------------------

/**
 * One beat already established in the CURRENT scene.
 *
 * The engine had memory at campaign scale (world.memory), a retrospective
 * summary (summarySegments) and raw history at turn scale — but nothing at
 * scene scale. Nothing told the model which offers, promises and observations
 * this conversation had already spent, so it re-made them. In the reviewed save
 * turn 18 re-offered the cured-goat under-shifts and re-proposed the trip to
 * the workshop, both of which turn 17 had already done.
 */
export interface SceneLedgerEntry {
    id: string;
    /** Short clause describing what was established. */
    beat: string;
    turn: number;
    /** 'npc' = derived from a player-visible npc_action; 'model' = declared via `established`. */
    source: 'npc' | 'model';
}

/**
 * v1.31: Compact snapshot of the volatile world state at the END of a turn,
 * diffed on the NEXT turn to produce the [SINCE LAST TURN] block. Deliberately
 * small — it is persisted in every save.
 */
export interface TurnDigest {
    turn: number;
    location: string;
    totalMinutes: number;
    sceneMode: string;
    tensionLevel: number;
    /** Names of entities marked present/nearby, sorted. */
    presentEntities: string[];
    /** Count of live (validated) threats. */
    threatCount: number;
    conditionCount: number;
}

export interface Character {
    name: string;
    gender: string;
    appearance: string;
    notableFeatures: string;
    race: string;
    backstory: string;
    setting: string;
    inventory: string[];
    relationships: string[];
    conditions: string[];
    goals: string[];
    trauma: number;
    bio: BioMonitor;
    hiddenNotes?: string;
    conditionTimestamps?: Record<string, number>;
    skills?: Skill[];
    /**
     * v0.13 — Character age in years. Optional for back-compat (legacy saves
     * omit it). Aging montages add `MontageBlock.age_increment_years` to this;
     * rebirth campaigns seed it at 0. Missing ⇒ age is simply untracked.
     */
    age?: number;
    /**
     * v1.19 — Languages the character can speak/read. When the character
     * encounters speech/writing in a language NOT in this list, the model
     * must render it as unintelligible (paraphrased subtext / body language
     * only). Missing/empty ⇒ legacy behavior (all languages understood).
     */
    languagesKnown?: string[];
}

export interface CharacterTemplate {
    id: TemplateId;
    name: string;
    timestamp: string;
    character: Omit<Character, 'bio' | 'trauma' | 'hiddenNotes'>;
}

export interface GeneratedCharacterFields {
    name: string;
    gender: string;
    appearance: string;
    notableFeatures: string;
    race: string;
    backstory: string;
    setting: string;
    inventory: string[];
    relationships: string[];
    conditions: string[];
    goals: string[];
}

export interface MemoryItem {
    id: MemoryId;
    fact: string;
    timestamp: string;
    /**
     * v1.22: Salience score 1–5. Drives RAG pinning and salience-weighted
     * eviction when MEMORY_CAP is reached. Default 2 when unspecified.
     *  5 = pivotal/permanent (death, vow of vengeance, identity reveal)
     *  4 = major (significant relationship shift, faction reveal)
     *  3 = notable (first encounter, location discovery)
     *  2 = moderate (default — normal in-fiction events)
     *  1 = minor (small flavor beats)
     */
    salience?: number;
    /**
     * v1.22: Optional category tags. Memories tagged with any of
     * {vow, oath, debt, reveal, death, identity, betrayal} are pinned —
     * always injected into context regardless of recency or RAG score.
     */
    tags?: string[];
    /** v1.22: Turn this memory was created. Drives age decay during eviction. */
    turnCreated?: number;
}

/**
 * v1.22: Hierarchical / segmented historical summary.
 * Each segment summarises a fixed window of turns (typically
 * SUMMARIZATION_INTERVAL turns wide). At prompt-build time the segments are
 * RAG-ranked against the current user input so only the relevant ones are
 * injected — letting us cover much more total history without inflating the
 * per-turn token budget.
 */
export interface SummarySegment {
    startTurn: number;
    endTurn: number;
    summary: string;
    timestamp: string;
}

export interface RollStatistics {
    totalRolls: number;
    criticalSuccesses: number;
    criticalFailures: number;
    averageRoll: number;
    outcomes: Record<RollOutcome, number>;
}

// --- High Frequency State ---
export interface GameHistory {
    history: ChatMessage[];
    rollLog: string[];
    rollStats: RollStatistics;
    isThinking: boolean;
    debugLog: DebugLogEntry[];
    turnCount: number;
    /**
     * @deprecated v1.22 — kept for save-file backward compatibility. New code
     * should read/write `summarySegments`. When loading a save with only this
     * field set, the prompt builder treats it as a single segment covering
     * turns 0..turnCount.
     */
    lastActiveSummary?: string;
    /**
     * v1.22: Rolling segmented summaries. Each segment covers a window of
     * turns. Replaces the single flat string above so we can keep older
     * windows around and RAG-rank them against the current scene.
     */
    summarySegments?: SummarySegment[];
}

// --- Low Frequency State ---
export interface GameWorld {
    // v1.12: Player-rejected mechanisms — keywords that the engine blocks
    // from appearing in future lore or threat descriptions.
    bannedMechanisms?: string[][];
    currentModel: string;
    memory: MemoryItem[];
    lore: LoreItem[];
    visualUrl?: string;
    generatedImages: string[];
    isGeneratingVisual: boolean;
    isGeneratingScenarios: boolean;
    scenarios: Scenario[];
    failedModels: string[];
    hiddenRegistry: string;
    pregnancies: Pregnancy[];
    environment?: CombatEnvironment;
    activeThreats: ActiveThreat[];
    knownEntities: KnownEntity[];
    bannedNameMap: Record<string, string>;

    // State Tracking
    sceneMode: SceneMode;
    // v1.21: Time-velocity mode (orthogonal to sceneMode). Optional & not
    // persisted to the projection row — re-derived from sceneMode on load, so
    // no save migration is needed. Set at runtime each turn.
    timeMode?: TimeMode;
    tensionLevel: number;
    time: WorldTime;
    /** Optional per-world calendar override (hydrated from the world seed). Defaults to DEFAULT_CALENDAR. */
    calendar?: CalendarConfig;
    lastWorldTickTurn: number;

    // v1.3 — Simulation Integrity Systems
    turnCount: number;
    lastBargainTurn: number;
    factionIntelligence: FactionIntelligence;
    legalStatus: LegalStatus;

    // v1.6 — Dormant Hook Registry + Exposure Scoring
    dormantHooks: DormantHook[];
    factionExposure: FactionExposure;

    // v1.11 — Threat Arc History for re-seed detection
    threatArcHistory?: ThreatArcHistory;

    // v1.14 — Location Proximity Graph
    locationGraph?: LocationGraph;

    // --- NEW v1.13: Properties promoted from `as any` casts ---

    /** Active emerging threats being tracked by the threat seed state machine. */
    emergingThreats: WorldTickEvent[];

    /** v1.17: Tracks Origin Gate denial counts per entity to auto-suppress repeat offenders. */
    threatDenialTracker?: ThreatDenialTracker;

    /** v1.17: Global threat cooldown — no new threats until this turn. */
    threatCooldownUntilTurn?: number;
    /** v1.17: Turn when the most recent threat arc ended (all emergingThreats → 0). */
    lastThreatArcEndTurn?: number;
    /** v1.17: Cumulative Origin Gate denials this session (for global cooldown trigger). */
    sessionDenialCount?: number;

    /**
     * v1.31: Facts the PLAYER asserted, promoted to canon so the model reads
     * them in the same channel it reads everything else it treats as true.
     */
    playerCanon?: PlayerCanonEntry[];

    /**
     * v1.31: Beats already established in the current scene. FIFO-capped and
     * cleared when the scene changes (location or scene-mode transition).
     */
    sceneLedger?: SceneLedgerEntry[];

    /** v1.31: End-of-turn snapshot, diffed next turn to build [SINCE LAST TURN]. */
    lastTurnDigest?: TurnDigest;

    /** v1.10: Flag set by allied passivity detection for sectionReminders. */
    passiveAlliesDetected?: boolean;

    /** Player's current location string — used by info chain validation. */
    location?: string;

    // v1.15 — Name Uniqueness Registry
    // Every character name ever used in this story is recorded here (lowercase).
    // Once a name appears, no new character may use it — even if the original
    // character is dead or retired. Prevents the 3-Tegwens problem.
    usedNameRegistry?: string[];

    // Stream 4: Trauma Narrative Effects
    activeTraumaEffect?: TraumaEffect;
    lastTraumaEffectTurn?: number;

    // Stream 6: Faction-Scale Conflict
    factions?: Faction[];
    factionConflicts?: FactionConflict[];

    // Stream 7: World Seeds
    worldRules?: string[];
    worldSeedId?: WorldSeedId;
    /**
     * Top-level world tags hydrated from the active WorldSeed (e.g. "high-fantasy",
     * "matriarchal", "gritty"). Surfaced in the runtime prompt as tone/genre
     * anchors so the AI doesn't drift away from the seed's setting.
     */
    worldTags?: string[];
}

export interface CalendarConfig {
    daysPerYear: number;
    monthsPerYear: number;
    daysPerMonth: number;
    seasonsPerYear: number;
    daysPerSeason: number;
    /** Season labels; length should equal seasonsPerYear. Defaults to spring/summer/autumn/winter. */
    seasonNames: string[];
    /** Optional month labels; length should equal monthsPerYear. If absent, display uses "Month N". */
    monthNames?: string[];
    /** Minutes in a day. Defaults to 1440 when omitted. */
    minutesPerDay?: number;
}

export interface WorldTime {
    totalMinutes: number;
    /** 1-based absolute day count since campaign start (kept for back-compat / montage math). */
    day: number;
    hour: number;
    minute: number;
    // --- Calendar fields (derived from totalMinutes via CalendarConfig) ---
    /** 1-based year. */
    year: number;
    /** 1-based month within the year (1..monthsPerYear). */
    month: number;
    /** 1-based day within the month (1..daysPerMonth). */
    dayOfMonth: number;
    /** 1-based day within the year (1..daysPerYear). */
    dayOfYear: number;
    /** Season label for the current dayOfYear. */
    season: string;
    display: string;
}

// --- Composite Types ---
export interface GameState {
    history: GameHistory;
    world: GameWorld;
}

export interface GameSave {
    id: SaveId;
    name: string;
    timestamp: string;
    gameState: GameState;
    character: Character;
    thumbnail?: string;
}

export interface SaveMetadata {
    name: string;
    timestamp: string;
    id: string;
}

export type View = 'landing' | 'creator' | 'scenario' | 'game';

import type { ReactNode } from 'react';

export interface ModalProps {
    show: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
}
