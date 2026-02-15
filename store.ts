
import { create } from 'zustand';
import { 
    GameHistory, 
    GameWorld, 
    Character, 
    View, 
    Role, 
    MessageId,
    BioMonitor,
    WorldTime
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
            'CRITICAL FAILURE': 0, 'FAILURE': 0, 'MIXED/COST': 0, 'SUCCESS': 0, 'STRONG SUCCESS': 0, 'CRITICAL SUCCESS': 0
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
    time: DEFAULT_TIME
};

// --- Store Interface ---

interface GameStore {
    // Data State
    gameHistory: GameHistory;
    gameWorld: GameWorld;
    character: Character;
    preTurnSnapshot: { history: GameHistory; world: GameWorld; character: Character } | null;
    
    // UI State
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

    // Actions
    setGameHistory: (update: GameHistory | ((prev: GameHistory) => GameHistory)) => void;
    setGameWorld: (update: GameWorld | ((prev: GameWorld) => GameWorld)) => void;
    setCharacter: (update: Character | ((prev: Character) => Character)) => void;
    setPreTurnSnapshot: (snapshot: { history: GameHistory; world: GameWorld; character: Character } | null) => void;
    
    setView: (view: View) => void;
    setActiveTab: (tab: 'chat' | 'character' | 'world') => void;
    setIsSettingsOpen: (open: boolean) => void;
    setShowKeyPrompt: (show: boolean) => void;
    setShowSaveModal: (show: boolean) => void;
    setShowLoadModal: (show: boolean) => void;
    setScreenEffect: (effect: 'none' | 'fail' | 'crit') => void;
    setIsMobileMenuOpen: (open: boolean) => void;
    setPulseSeverity: (severity: 'none' | 'lethal' | 'traumatic' | 'minor') => void;
    setIsPulsing: (isPulsing: boolean) => void;
    setIsGalleryOpen: (open: boolean) => void;
    setIsDebugOpen: (open: boolean) => void;

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

    setView: (view) => set({ view }),
    setActiveTab: (activeTab) => set({ activeTab }),
    setIsSettingsOpen: (isSettingsOpen) => set({ isSettingsOpen }),
    setShowKeyPrompt: (showKeyPrompt) => set({ showKeyPrompt }),
    setShowSaveModal: (showSaveModal) => set({ showSaveModal }),
    setShowLoadModal: (showLoadModal) => set({ showLoadModal }),
    setScreenEffect: (screenEffect) => set({ screenEffect }),
    setIsMobileMenuOpen: (isMobileMenuOpen) => set({ isMobileMenuOpen }),
    setPulseSeverity: (pulseSeverity) => set({ pulseSeverity }),
    setIsPulsing: (isPulsing) => set({ isPulsing }),
    setIsGalleryOpen: (isGalleryOpen) => set({ isGalleryOpen }),
    setIsDebugOpen: (isDebugOpen) => set({ isDebugOpen }),

    triggerScreenEffect: (effect) => {
        set({ screenEffect: effect });
        setTimeout(() => set({ screenEffect: 'none' }), 1200);
    },

    resetState: () => set({
        gameHistory: initialHistory,
        gameWorld: initialWorld,
        character: EMPTY_CHARACTER,
        view: 'landing',
        preTurnSnapshot: null
    })
}));
