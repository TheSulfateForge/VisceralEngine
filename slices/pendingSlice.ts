// ============================================================================
// PENDINGSLICE.TS
// Zustand slice for pending/temporary state: lore, conditions
// ============================================================================

import { StateCreator } from 'zustand';
import {
    LoreItem,
    MontageProposal,
    MontageItemStatus,
    ReviewableItem,
    ProposedMemory,
    ProposedTrauma,
    ProposedSkillUpdate,
    ProposedNpcDelta,
} from '../types';

/** The four reviewable arrays on a MontageProposal. */
export type MontageCategory = 'memories' | 'traumas' | 'skillUpdates' | 'npcDeltas';

/** Union of the per-item payloads carried by a montage proposal. */
export type ProposedItemData =
    | ProposedMemory
    | ProposedTrauma
    | ProposedSkillUpdate
    | ProposedNpcDelta;

const MONTAGE_CATEGORIES: MontageCategory[] = ['memories', 'traumas', 'skillUpdates', 'npcDeltas'];

/** Apply a transform to one reviewable category, returning a new proposal. */
const mapMontageCategory = (
    proposal: MontageProposal,
    category: MontageCategory,
    fn: (items: ReviewableItem<ProposedItemData>[]) => ReviewableItem<ProposedItemData>[],
): MontageProposal => ({
    ...proposal,
    [category]: fn(proposal[category] as ReviewableItem<ProposedItemData>[]),
});

/** Set every item in every category to the same status. */
const setAllMontageStatuses = (
    proposal: MontageProposal,
    status: MontageItemStatus,
): MontageProposal => {
    let p = proposal;
    for (const c of MONTAGE_CATEGORIES) {
        p = mapMontageCategory(p, c, (items) => items.map((it) => ({ ...it, status })));
    }
    return p;
};

// --- Pending Slice Interface ---

export interface PendingSlice {
    /**
     * Pending lore items awaiting processing
     */
    pendingLore: LoreItem[];

    /**
     * The montage proposal currently under review, or null when none is open.
     * Held here (and persisted to the `pending_montage` DB row by the turn-flow
     * layer) so a mid-review app close survives. Cleared on accept/discard.
     */
    montageProposal: MontageProposal | null;

    /**
     * True while a montage memory is being "played out" as a live scene. The
     * proposal stays held; the montage modal hides until the scene resolves and
     * `resumeMontageFromScene` is called.
     */
    montagePausedForScene: boolean;

    /**
     * Tracks conditions the player manually removed this session (via the character panel).
     * Passed to BioEngine.tick() so the bio engine applies a grace buffer before
     * re-imposing them. Reset to [] at the start of each new AI turn so that over
     * time the engine can legitimately re-apply conditions if the underlying need
     * genuinely deteriorates far enough.
     */
    playerRemovedConditions: string[];

    setPendingLore: (update: LoreItem[] | ((prev: LoreItem[]) => LoreItem[])) => void;

    /** Replace the held montage proposal, or clear it with `null`. */
    setMontageProposal: (proposal: MontageProposal | null) => void;

    /** Set a single reviewable item's status (veto / restore-to-pending / accept). */
    setMontageItemStatus: (
        category: MontageCategory,
        itemId: string,
        status: MontageItemStatus,
    ) => void;

    /** Replace a single item's payload (marks it 'edited'; keeps its `original`). */
    editMontageItem: (
        category: MontageCategory,
        itemId: string,
        data: ProposedItemData,
    ) => void;

    /** Veto every item across all categories (the player still gets the time skip). */
    vetoAllMontageItems: () => void;

    /** Restore every item across all categories back to 'pending'. */
    restoreAllMontageItems: () => void;

    /** Pause the montage to play a flagged memory out as a live scene. */
    pauseMontageForScene: (memoryId?: string) => void;

    /** Resume montage review after a promoted scene resolves. */
    resumeMontageFromScene: () => void;

    /** Called by the character panel when a player manually removes a condition. */
    addPlayerRemovedCondition: (condition: string) => void;

    /** Called at the start of each AI turn to expire the grace period. */
    clearPlayerRemovedConditions: () => void;
}

// --- Pending Slice Creator ---

export const createPendingSlice: StateCreator<any, [], [], PendingSlice> = (set) => ({
    // Initial State
    pendingLore: [],
    montageProposal: null,
    montagePausedForScene: false,
    playerRemovedConditions: [],

    // Actions
    setPendingLore: (update) => set((state) => ({
        pendingLore: typeof update === 'function' ? update(state.pendingLore) : update
    })),

    setMontageProposal: (proposal) => set({
        montageProposal: proposal,
        montagePausedForScene: false,
    }),

    setMontageItemStatus: (category, itemId, status) => set((state) => {
        if (!state.montageProposal) return {};
        return {
            montageProposal: mapMontageCategory(state.montageProposal, category, (items) =>
                items.map((it) => (it.id === itemId ? { ...it, status } : it))),
        };
    }),

    editMontageItem: (category, itemId, data) => set((state) => {
        if (!state.montageProposal) return {};
        return {
            montageProposal: mapMontageCategory(state.montageProposal, category, (items) =>
                items.map((it) =>
                    it.id === itemId ? { ...it, data, status: 'edited' as MontageItemStatus } : it)),
        };
    }),

    vetoAllMontageItems: () => set((state) =>
        state.montageProposal
            ? { montageProposal: setAllMontageStatuses(state.montageProposal, 'vetoed') }
            : {}),

    restoreAllMontageItems: () => set((state) =>
        state.montageProposal
            ? { montageProposal: setAllMontageStatuses(state.montageProposal, 'pending') }
            : {}),

    pauseMontageForScene: (memoryId) => set((state) => ({
        montagePausedForScene: true,
        montageProposal: state.montageProposal && memoryId
            ? { ...state.montageProposal, promotedMemoryId: memoryId }
            : state.montageProposal,
    })),

    resumeMontageFromScene: () => set({ montagePausedForScene: false }),

    addPlayerRemovedCondition: (condition) => set((state) => ({
        playerRemovedConditions: state.playerRemovedConditions.includes(condition)
            ? state.playerRemovedConditions
            : [...state.playerRemovedConditions, condition]
    })),

    clearPlayerRemovedConditions: () => set({ playerRemovedConditions: [] })
});
