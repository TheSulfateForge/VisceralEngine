// ============================================================================
// COMPOSITESLICE.TS
// Zustand slice for composite/derived actions that reset ALL slices
// ============================================================================

import { StateCreator } from 'zustand';
import { initialHistory, initialWorld, EMPTY_CHARACTER } from './gameSlice';
import { initialUI } from './uiSlice';

// --- Composite Slice Interface ---

export interface CompositeSlice {
    /**
     * Reset all state to initial defaults across all slices
     */
    resetState: () => void;
}

// --- Composite Slice Creator ---

export const createCompositeSlice: StateCreator<any, [], [], CompositeSlice> = (set) => ({
    // Actions
    resetState: () => set({
        // Game slice reset
        gameHistory: initialHistory,
        gameWorld: initialWorld,
        character: EMPTY_CHARACTER,
        preTurnSnapshot: null,

        // Pending slice reset
        pendingLore: [],
        playerRemovedConditions: [],

        // UI slice reset
        ui: initialUI
    })
});
