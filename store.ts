// ============================================================================
// STORE.TS — v1.3
// v1.3 changes: initialWorld now includes turnCount, lastBargainTurn,
// factionIntelligence, legalStatus, and emergingThreats to support all
// simulation integrity systems added in this patch.
// ============================================================================

import { create } from 'zustand';
import {
    GameHistory,
    GameWorld,
    Character,
    View,
    Role,
    MessageId,
    BioMonitor,
    WorldTime,
    LoreItem
} from './types';
import { MODELS } from './constants';

// --- Initial States ---

const DEFAULT_BIO: BioMonitor = {
    metabolism: { calories: 85, hydration: 85, stamina: 100, libido: 5 },
    pressures: { bladder: 0, bowels: 0, lactation: 0, seminal: 0 },
    timestamps: { lastSleep: 0, lastMeal: 0, lastOrgasm: 0 },
    modifiers: { calories: 1.0, hydration: 1.0, stamina: 1.0, lactation: 1.0 }
};

const DEFAULT_TIME: WorldTime = {
    totalMinutes: 540, // 09:00 AM on Day 1
    day: 1,
    hour: 9,
    minute: 0,
    display: "Day 1, 09:00"
};

export const EMPTY_CHARACTER: Character = {
    name: "", gender: "", appearance: "", notableFeatures: "", race: "", backstory: "", setting: "",
    inventory: [], relationships: [], conditions: [], goals: [], trauma: 0,
    bio: DEFAULT_BIO
};

const initialHistory: GameHistory = {
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

const initialWorld: GameWorld = {
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
    // emergingThreats is managed by the threat seed state machine in simulationEngine.ts
    // It is stored as part of world state but typed via the WorldTickEvent interface
    emergingThreats: [],
};

interface UIState {
    view: View;
    activeTab: 'chat' | 'character' | 'world';
    isSettingsOpen: boolean;
    showKeyPrompt: boolean;
    showSaveModal: boolean;
    showLoadModal: boolean;
    screenEffect: 'none' | 'fail' | 'crit';
    isMobileMenuOpen: boolean;
    pulseSeverity: 'none' | 'lethal' | 'traumatic' | 'minor';
    isPulsing: boolean;
    isGalleryOpen: boolean;
    isDebugOpen: boolean;
}

const initialUI: UIState = {
    view: 'landing',
    activeTab: 'chat',
    isSettingsOpen: false,
    showKeyPrompt: false,
    showSaveModal: false,
    showLoadModal: false,
    screenEffect: 'none',
    isMobileMenuOpen: false,
    pulseSeverity: 'none',
    isPulsing: false,
    isGalleryOpen: false,
    isDebugOpen: false,
};

// --- Store Interface ---

interface GameStore {
    // Data State
    gameHistory: GameHistory;
    gameWorld: GameWorld;
    character: Character;
    preTurnSnapshot: { history: GameHistory; world: GameWorld; character: Character } | null;

    // Pending State
    pendingLore: LoreItem[];

    /**
     * Tracks conditions the player manually removed this session (via the character panel).
     * Passed to BioEngine.tick() so the bio engine applies a grace buffer before
     * re-imposing them. Reset to [] at the start of each new AI turn so that over
     * time the engine can legitimately re-apply conditions if the underlying need
     * genuinely deteriorates far enough.
     */
    playerRemovedConditions: string[];

    // UI State
    ui: UIState;

    // Actions
    setGameHistory: (update: GameHistory | ((prev: GameHistory) => GameHistory)) => void;
    setGameWorld: (update: GameWorld | ((prev: GameWorld) => GameWorld)) => void;
    setCharacter: (update: Character | ((prev: Character) => Character)) => void;
    setPreTurnSnapshot: (snapshot: { history: GameHistory; world: GameWorld; character: Character } | null) => void;

    setPendingLore: (update: LoreItem[] | ((prev: LoreItem[]) => LoreItem[])) => void;

    /** Called by the character panel when a player manually removes a condition. */
    addPlayerRemovedCondition: (condition: string) => void;
    /** Called at the start of each AI turn to expire the grace period. */
    clearPlayerRemovedConditions: () => void;

    // UI Actions
    setUI: (update: Partial<UIState>) => void;

    // Composite Actions
    triggerScreenEffect: (effect: 'none' | 'fail' | 'crit') => void;
    resetState: () => void;
}

// --- Store Creation ---

export const useGameStore = create<GameStore>((set) => ({
    // Initial State
    gameHistory: initialHistory,
    gameWorld: initialWorld,
    character: EMPTY_CHARACTER,
    preTurnSnapshot: null,
    pendingLore: [],
    playerRemovedConditions: [],
    ui: initialUI,

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
    setPreTurnSnapshot: (preTurnSnapshot) => set({ preTurnSnapshot }),

    setPendingLore: (update) => set((state) => ({
        pendingLore: typeof update === 'function' ? update(state.pendingLore) : update
    })),

    addPlayerRemovedCondition: (condition) => set((state) => ({
        playerRemovedConditions: state.playerRemovedConditions.includes(condition)
            ? state.playerRemovedConditions
            : [...state.playerRemovedConditions, condition]
    })),

    clearPlayerRemovedConditions: () => set({ playerRemovedConditions: [] }),

    setUI: (update) => set((state) => ({
        ui: { ...state.ui, ...update }
    })),

    triggerScreenEffect: (effect) => {
        set((state) => ({ ui: { ...state.ui, screenEffect: effect } }));
        setTimeout(() => set((state) => ({ ui: { ...state.ui, screenEffect: 'none' } })), 1200);
    },

    resetState: () => set({
        gameHistory: initialHistory,
        gameWorld: initialWorld,
        character: EMPTY_CHARACTER,
        preTurnSnapshot: null,
        pendingLore: [],
        playerRemovedConditions: [],
        ui: initialUI
    })
}));
