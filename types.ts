import React from 'react';

// ============================================================================
// TYPES.TS - Enhanced Type Definitions
// ============================================================================

declare global {
  interface Window {
    // aistudio is declared in the global scope by the environment (Project IDX / GenAI)
    // We rely on the global interface merging from the environment.
    webkitAudioContext?: typeof AudioContext;
  }
}

export enum Role {
  USER = 'user',
  MODEL = 'model',
  SYSTEM = 'system'
}

// Branded types for better type safety
export type MessageId = string & { readonly __brand: 'MessageId' };
export type SaveId = string & { readonly __brand: 'SaveId' };
export type MemoryId = string & { readonly __brand: 'MemoryId' };
export type LoreId = string & { readonly __brand: 'LoreId' };

export type RollOutcome = 
  | 'CRITICAL FAILURE'
  | 'FAILURE'
  | 'MIXED/COST'
  | 'SUCCESS'
  | 'STRONG SUCCESS'
  | 'CRITICAL SUCCESS';

export type ConditionSeverity = 'lethal' | 'traumatic' | 'minor';

export const SCENE_MODES = ['NARRATIVE', 'SOCIAL', 'TENSION', 'COMBAT'] as const;
export type SceneMode = typeof SCENE_MODES[number];

// --- Chronos System ---

export interface WorldTime {
  totalMinutes: number;   // Absolute counter
  day: number;            // Derived
  hour: number;           // Derived
  minute: number;         // Derived
  display: string;        // "Day 1, 09:00"
}

// --- Biological Systems ---

export interface BioModifiers {
    calories: number;       // Default 1.0. <1 = Slow Burn (Good), >1 = Fast Burn (Bad)
    hydration: number;      // Default 1.0
    stamina: number;        // Default 1.0
    lactation: number;      // Default 1.0. >1 = Faster Production
}

export interface BioMonitor {
    metabolism: {
        calories: number;       // 0-100 (Energy)
        hydration: number;      // 0-100 (Water)
        stamina: number;        // 0-100 (Sleep need)
        libido: number;         // 0-100 (Pressure)
    };
    pressures: {
        bladder: number;        // 0-100
        bowels: number;         // 0-100
        lactation: number;      // 0-100 (Milk storage)
        seminal: number;        // 0-100 (Seed storage)
    };
    timestamps: {
        lastSleep: number;
        lastMeal: number;
        lastOrgasm: number;
    };
    modifiers: BioModifiers; // Dynamic Multipliers managed by AI
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
  motherName: string; // "Player" or NPC Name
  fatherName: string; // "Unknown" or NPC Name
  conceptionTurn: number;
  conceptionTime: number; // Absolute minutes
  currentWeek: number;
  isVisible: boolean; // Becomes true after week 12
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
  summary: string; // "Rain-slicked alleyway, minimal light"
  lighting: Lighting;
  weather: string;
  terrain_tags: string[]; // ["Muddy", "Crowded", "Narrow"]
}

export interface ActiveThreat {
  id: string;
  name: string;
  archetype: EnemyArchetype;
  status: EnemyState;
  condition: string; // Brief description of their physical state e.g. "Knee-capped"
  current_action: string; // What they are doing THIS turn e.g. "Suppressing Fire"
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
  impression: string; // Dynamic adjective: "Wary", "Infatuated", "Contemptuous"
  relationship_level: RelationshipLevel;
  leverage: string; // Specific transactional data
  ledger: string[]; // List of specific interactions: "Player gave me water", "Player killed my brother"
}

export interface NPCInteraction {
  speaker: string;
  dialogue: string; // The spoken words
  subtext: string; // The hidden meaning/intent
  biological_tells: string; // Visceral indicators: "Pupils dilated", "Sweating"
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
  bio_modifiers?: Partial<BioModifiers>; // New: AI can adjust metabolism
  relationships?: string[]; 
  goals?: string[];
}

export interface ModelResponseSchema {
  thought_process: string; // New: Inner monologue for reasoning
  scene_mode: SceneMode; // New: Explicit state tracking
  tension_level: number; // New: 0-100 atmosphere meter
  narrative: string;
  
  time_passed_minutes?: number; // CHRONOS: How much time happened?
  biological_inputs?: BioInputs; // CHRONOS: Did the player eat/sleep?

  // Refactored: Uses Deltas now
  character_updates?: CharacterUpdates;
  
  combat_context?: CombatContext; 
  known_entity_updates?: KnownEntity[]; 
  npc_interaction?: NPCInteraction;
  roll_request?: RollRequest;
  bargain_request?: BargainRequest;
  hidden_update?: string;
  new_memory?: { fact: string }; // MEMORY FRAGMENTS: AI can now save permanent history
  new_lore?: { keyword: string; content: string };
  biological_event?: boolean; 
}

// --- Application Types ---

export interface DebugLogEntry {
  timestamp: string;
  message: string;
  type: 'info' | 'error' | 'success';
}

export interface ChatMessage {
  id: MessageId;
  role: Role;
  text: string; // The narrative content
  timestamp: string;
  rollRequest?: RollRequest;
  bargainRequest?: BargainRequest;
  npcInteraction?: NPCInteraction; // Structured social data
  isResolved?: boolean;
  metadata?: Record<string, unknown>; // NO ANY. STRICT RECORD.
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
  relationships: string[]; // Legacy/Quick list
  conditions: string[];
  goals: string[];
  trauma: number; // 0-100 scale of psychological damage
  bio: BioMonitor; // CHRONOS: Biological state
  hiddenNotes?: string;
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

// High Frequency Updates (Re-renders often)
export interface GameHistory {
  history: ChatMessage[];
  rollLog: string[];
  rollStats: RollStatistics;
  isThinking: boolean;
  debugLog: DebugLogEntry[];
  turnCount: number;
  lastActiveSummary?: string; 
}

// Low Frequency Updates (Re-renders rarely)
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
  time: WorldTime; // CHRONOS: Global Clock
}

// Composite for Persistence
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