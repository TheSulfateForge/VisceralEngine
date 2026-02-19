// ============================================================================
// TYPES.TS — Visceral Engine Type Definitions
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

export const ROLES = ['user', 'model', 'system'] as const;
export type Role = typeof ROLES[number];

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

    // State Tracking
    sceneMode: SceneMode;
    tensionLevel: number;
    time: WorldTime;
    lastWorldTickTurn: number;

    // v1.3 — Simulation Integrity Systems
    turnCount: number;                      // authoritative turn counter (was on GameHistory only)
    lastBargainTurn: number;               // tracks when last Devil's Bargain was offered
    factionIntelligence: FactionIntelligence; // NPC omniscience prevention
    legalStatus: LegalStatus;             // claim resurrection prevention
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

export interface ModalProps {
    show: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
}
