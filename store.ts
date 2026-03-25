// ============================================================================
// STORE.TS — v1.3
// Zustand store combining all slices
// ============================================================================

import { create } from 'zustand';
import { createGameSlice, GameSlice } from './slices/gameSlice';
import { createUISlice, UISlice } from './slices/uiSlice';
import { createPendingSlice, PendingSlice } from './slices/pendingSlice';
import { createCompositeSlice, CompositeSlice } from './slices/compositeSlice';

// --- Combined Store Type ---

export type GameStore = GameSlice & UISlice & PendingSlice & CompositeSlice;

// --- Store Creation ---

export const useGameStore = create<GameStore>()((...a) => ({
    ...createGameSlice(...a),
    ...createUISlice(...a),
    ...createPendingSlice(...a),
    ...createCompositeSlice(...a),
}));

// --- Re-exports for Backward Compatibility ---

export { EMPTY_CHARACTER } from './slices/gameSlice';
export { initialHistory, initialWorld, DEFAULT_BIO, DEFAULT_TIME } from './slices/gameSlice';
export type { UIState } from './slices/uiSlice';
export { initialUI } from './slices/uiSlice';
