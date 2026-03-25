// ============================================================================
// UISLICE.TS
// Zustand slice for UI state and effects
// ============================================================================

import { StateCreator } from 'zustand';
import { View } from '../types';

// --- UI State Interface ---

export interface UIState {
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

export const initialUI: UIState = {
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

// --- UI Slice Interface ---

export interface UISlice {
    ui: UIState;

    setUI: (update: Partial<UIState>) => void;
    triggerScreenEffect: (effect: 'none' | 'fail' | 'crit') => void;
}

// --- UI Slice Creator ---

export const createUISlice: StateCreator<any, [], [], UISlice> = (set) => ({
    // Initial State
    ui: initialUI,

    // Actions
    setUI: (update) => set((state) => ({
        ui: { ...state.ui, ...update }
    })),

    triggerScreenEffect: (effect) => {
        set((state) => ({ ui: { ...state.ui, screenEffect: effect } }));
        setTimeout(() => set((state) => ({ ui: { ...state.ui, screenEffect: 'none' } })), 1200);
    }
});
