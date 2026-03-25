// ============================================================================
// GAMESLICE.TS
// Zustand slice for game state: gameHistory, gameWorld, character, preTurnSnapshot
// ============================================================================

import { StateCreator } from 'zustand';
import {
    GameHistory,
    GameWorld,
    Character,
    Role,
    MessageId,
    BioMonitor,
    WorldTime
} from '../types';
import { MODELS } from '../constants';

// --- Initial States ---

export const DEFAULT_BIO: BioMonitor = {
    metabolism: { calories: 85, hydration: 85, stamina: 100, libido: 5 },
    pressures: { bladder: 0, bowels: 0, lactation: 0, seminal: 0 },
    timestamps: { lastSleep: 0, lastMeal: 0, lastOrgasm: 0 },
    modifiers: { calories: 1.0, hydration: 1.0, stamina: 1.0, lactation: 1.0 }
};

export const DEFAULT_TIME: WorldTime = {
    totalMinutes: 540, // 09:00 AM on Day 1
    day: 1,
    hour: 9,
    minute: 0,
    display: "Day 1, 09:00"
};

export const EMPTY_CHARACTER: Character = {
    name: "", gender: "", appearance: "", notableFeatures: "", race: "", backstory: "", setting: "",
    inventory: [], relationships: [], conditions: [], goals: [], trauma: 0,
    bio: DEFAULT_BIO,
    skills: []
};

export const initialHistory: GameHistory = {
    history: [{ id: 'init' as MessageId, role: Role.SYSTEM, text: "--- ENGINE INITIALIZED ---", timestamp: new Date().toISOString() }],
    rollLog: [],
    isThinking: false,
    debugLog: [],
    rollStats: {
        totalRolls: 0,
        criticalSuccesses: 0,
        criticalFailures: 0,
        averageRoll: 0,
        outcomes: {
            'CRITICAL FAILURE': 0, 'FAILURE': 0, 'MIXED/COST': 0,
            'SUCCESS': 0, 'STRONG SUCCESS': 0, 'CRITICAL SUCCESS': 0
        }
    },
    turnCount: 0
};

export const initialWorld: GameWorld = {
    currentModel: MODELS[0],
    memory: [],
    lore: [],
    generatedImages: [],
    isGeneratingVisual: false,
    isGeneratingScenarios: false,
    scenarios: [],
    failedModels: [],
    hiddenRegistry: "Initial registry empty.",
    pregnancies: [],
    activeThreats: [],
    knownEntities: [],
    environment: {
        summary: "Unknown Location",
        lighting: "DIM",
        weather: "None",
        terrain_tags: []
    },
    sceneMode: 'NARRATIVE',
    tensionLevel: 10,
    time: DEFAULT_TIME,
    lastWorldTickTurn: 0,

    // v1.3: Simulation Integrity Systems
    turnCount: 0,                       // Authoritative turn counter — increments every processTurn()
    lastBargainTurn: 0,                // Devil's Bargain tracking — resets every time a bargain is offered
    factionIntelligence: {},           // NPC omniscience prevention — keyed by faction name
    legalStatus: {                     // Claim resurrection prevention
        knownClaims: [],
        playerDocuments: []
    },

    // v1.6: Dormant Hook Registry — populated at session start from character backstory.
    // The AI may ONLY seed new threats that reference a hook here, OR cite a specific
    // player action this session, OR belong to a faction with exposure score >= 20.
    dormantHooks: [],

    // v1.6: Faction Exposure Scoring — accumulates as NPCs observe the player.
    // A faction with exposureScore < 20 cannot be the source of a new threat seed.
    factionExposure: {},

    // v1.7: Persistent name resolution map for banned names
    bannedNameMap: {},

    // v1.15: Name uniqueness — tracks all names ever used in this story
    usedNameRegistry: [],

    // v1.13: Properties promoted from `as any` casts
    emergingThreats: [],
    passiveAlliesDetected: false,
    location: '',
    locationGraph: { nodes: {}, edges: [], playerLocationId: '' },
};

// --- Game Slice Interface ---

export interface GameSlice {
    gameHistory: GameHistory;
    gameWorld: GameWorld;
    character: Character;
    preTurnSnapshot: { history: GameHistory; world: GameWorld; character: Character } | null;

    setGameHistory: (update: GameHistory | ((prev: GameHistory) => GameHistory)) => void;
    setGameWorld: (update: GameWorld | ((prev: GameWorld) => GameWorld)) => void;
    setCharacter: (update: Character | ((prev: Character) => Character)) => void;
    setPreTurnSnapshot: (snapshot: GameSlice['preTurnSnapshot']) => void;
}

// --- Game Slice Creator ---

export const createGameSlice: StateCreator<any, [], [], GameSlice> = (set) => ({
    // Initial State
    gameHistory: initialHistory,
    gameWorld: initialWorld,
    character: EMPTY_CHARACTER,
    preTurnSnapshot: null,

    // Actions
    setGameHistory: (update) => set((state) => ({
        gameHistory: typeof update === 'function' ? update(state.gameHistory) : update
    })),

    setGameWorld: (update) => set((state) => ({
        gameWorld: typeof update === 'function' ? update(state.gameWorld) : update
    })),

    setCharacter: (update) => set((state) => ({
        character: typeof update === 'function' ? update(state.character) : update
    })),

    setPreTurnSnapshot: (preTurnSnapshot) => set({ preTurnSnapshot })
});
