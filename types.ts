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

// --- Scalar / Union Types ---

export const SCENE_MODES = ['NARRATIVE', 'SOCIAL', 'TENSION', 'COMBAT'] as const;
export type SceneMode = typeof SCENE_MODES[number];

export enum Role {
    USER = 'user',
    MODEL = 'model',
    SYSTEM = 'system',
}
export type RoleType = Role;

export type RollOutcome = 'CRITICAL FAILURE' | 'FAILURE' | 'MIXED/COST' | 'SUCCESS' | 'STRONG SUCCESS' | 'CRITICAL SUCCESS';

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
}

export interface NPCInteraction {
    speaker: string;
    dialogue: string;
    subtext: string;
    biological_tells: string;
}

// --- Threat Seed State Machine (v1.3) ---
// Enhanced WorldTickEvent with full state tracking to enforce ETA floors,
// the 3-seed cap, and auto-expiry of threats stuck at ETA ~1.

export type ThreatStatus = 'building' | 'imminent' | 'triggered' | 'expired';

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
    sourceField: string;             // 'backstory' | 'relationships' | 'goals' | etc.
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

// --- Schema Types (Matches JSON Output) ---

export interface RollRequest {
    challenge: string;
    bonus?: number;
    advantage?: boolean;
    disadvantage?: boolean;
}

export interface BargainRequest {
    description: string;
}

export interface LoreItem {
    id: LoreId;
    keyword: string;
    content: string;
    timestamp: string;
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
    relationships?: string[];
    goals?: string[];
}

export interface ModelResponseSchema {
    thought_process: string;
    scene_mode: SceneMode;
    tension_level: number;
    narrative: string;

    time_passed_minutes?: number;
    biological_inputs?: BioInputs;

    character_updates?: CharacterUpdates;

    combat_context?: CombatContext;
    known_entity_updates?: KnownEntity[];
    npc_interaction?: NPCInteraction;
    roll_request?: RollRequest;
    bargain_request?: BargainRequest;
    hidden_update?: string;
    new_memory?: { fact: string };
    new_lore?: { keyword: string; content: string };
    biological_event?: boolean;

    world_tick?: WorldTick;
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
    isResolved?: boolean;
    metadata?: Record<string, unknown>;
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
    lastActiveSummary?: string;
}

// --- Low Frequency State ---
export interface GameWorld {
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
    tensionLevel: number;
    time: WorldTime;
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
}

export interface WorldTime {
    totalMinutes: number;
    day: number;
    hour: number;
    minute: number;
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