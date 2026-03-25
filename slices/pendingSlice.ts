// ============================================================================
// PENDINGSLICE.TS
// Zustand slice for pending/temporary state: lore, conditions
// ============================================================================

import { StateCreator } from 'zustand';
import { LoreItem } from '../types';

// --- Pending Slice Interface ---

export interface PendingSlice {
    /**
     * Pending lore items awaiting processing
     */
    pendingLore: LoreItem[];

    /**
     * Tracks conditions the player manually removed this session (via the character panel).
     * Passed to BioEngine.tick() so the bio engine applies a grace buffer before
     * re-imposing them. Reset to [] at the start of each new AI turn so that over
     * time the engine can legitimately re-apply conditions if the underlying need
     * genuinely deteriorates far enough.
     */
    playerRemovedConditions: string[];

    setPendingLore: (update: LoreItem[] | ((prev: LoreItem[]) => LoreItem[])) => void;

    /** Called by the character panel when a player manually removes a condition. */
    addPlayerRemovedCondition: (condition: string) => void;

    /** Called at the start of each AI turn to expire the grace period. */
    clearPlayerRemovedConditions: () => void;
}

// --- Pending Slice Creator ---

export const createPendingSlice: StateCreator<any, [], [], PendingSlice> = (set) => ({
    // Initial State
    pendingLore: [],
    playerRemovedConditions: [],

    // Actions
    setPendingLore: (update) => set((state) => ({
        pendingLore: typeof update === 'function' ? update(state.pendingLore) : update
    })),

    addPlayerRemovedCondition: (condition) => set((state) => ({
        playerRemovedConditions: state.playerRemovedConditions.includes(condition)
            ? state.playerRemovedConditions
            : [...state.playerRemovedConditions, condition]
    })),

    clearPlayerRemovedConditions: () => set({ playerRemovedConditions: [] })
});
