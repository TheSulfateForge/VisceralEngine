// ============================================================================
// useMontage.ts — Montage turn flow (v0.13, Steps 5–8 wiring)
// ----------------------------------------------------------------------------
// Orchestrates the montage half of the turn loop, kept OUT of useGeminiClient
// because the flow is fundamentally different: a declared time-skip produces an
// UNCOMMITTED proposal that the player reviews before any state is written.
//
//   declareMontage  → resolve duration, prompt the AI for a montage_block,
//                     wrap it as a held MontageProposal (persisted to DB).
//   regenerateMontage → re-run with the same parameters (capped retries).
//   acceptMontage   → commit non-vetoed items + advance the clock (one pass),
//                     append the montage narrative, clear the held proposal.
//   cancelMontage   → back out before commit; NO time passes, nothing written.
//   restoreMontage  → on load, rehydrate a mid-review proposal from the DB row.
//
// Time authority lives in the engine (declaredActions); the AI only proposes the
// artifacts of the elapsed span. See TIME_AND_MONTAGE_DESIGN.md System 5.
// ============================================================================

import { useCallback, useEffect } from 'react';
import {
    ChatMessage,
    Role,
    ModelResponseSchema,
    DeclaredActionType,
    DeclaredActionUnit,
    MontageProposal,
    SaveId,
} from '../types';
import { generateMessageId, AUTOSAVE_ID } from '../idUtils';
import { useGameStore } from '../store';
import { useToast } from '../components/providers/ToastProvider';
import { useGeminiService } from './useGeminiService';
import { constructGeminiPrompt } from '../utils/promptUtils';
import { SYSTEM_INSTRUCTIONS } from '../systemInstructions';
import { buildMontageInstruction } from '../utils/montagePrompt';
import { resolveDeclaredAction } from '../utils/engine/declaredActions';
import { buildMontageProposal, commitMontageProposal } from '../utils/montageSystem';
import { MONTAGE_MAX_REGENERATES } from '../config/engineConfig';
import { db } from '../db';

export const useMontage = () => {
    const { showToast } = useToast();
    const { getService } = useGeminiService();

    const setGameHistory = useGameStore(s => s.setGameHistory);
    const setGameWorld = useGameStore(s => s.setGameWorld);
    const setCharacter = useGameStore(s => s.setCharacter);
    const setMontageProposal = useGameStore(s => s.setMontageProposal);

    // --- Persistence: mirror the held proposal to its DB row on every change so
    // a mid-review app close (or per-item veto/edit from the modal) survives.
    // Explicit clears call db.clearPendingMontage directly; here we only upsert.
    useEffect(() => {
        const unsub = useGameStore.subscribe((state, prev) => {
            if (state.montageProposal === prev.montageProposal) return;
            const p = state.montageProposal;
            if (p) {
                db.savePendingMontage(p).catch(err =>
                    console.warn('[montage] persist failed:', err));
            }
        });
        return unsub;
    }, []);

    /** Build the prompt + call the model for a montage_block. Shared by declare/regenerate. */
    const runMontageRequest = useCallback(async (
        declaredAction: ReturnType<typeof resolveDeclaredAction>['declaredAction'],
        montageType: NonNullable<ReturnType<typeof resolveDeclaredAction>['montageType']>,
    ): Promise<ModelResponseSchema | null> => {
        const service = await getService();
        if (!service) return null;

        const state = useGameStore.getState();
        const declaredLabel = `[Declared action: ${declaredAction.actionType} — ${declaredAction.quantity} ${declaredAction.unit}` +
            `${declaredAction.focus ? `, focus: ${declaredAction.focus}` : ''}]`;

        const userMsg: ChatMessage = {
            id: generateMessageId(),
            role: Role.USER,
            text: declaredLabel,
            timestamp: new Date().toISOString(),
        };

        const { prompt: contextPrompt } = await constructGeminiPrompt(
            state.gameHistory,
            state.gameWorld,
            state.character,
            declaredLabel,
            [],
            service.modelName,
            state.gameHistory.lastActiveSummary,
        );

        const fullSystemPrompt = `${SYSTEM_INSTRUCTIONS}\n\n${contextPrompt}`;
        const instruction = buildMontageInstruction(
            declaredAction,
            montageType,
            state.character,
            state.gameWorld,
        );

        return service.sendMessage(
            fullSystemPrompt,
            [...state.gameHistory.history, userMsg],
            state.gameHistory.lastActiveSummary,
            state.gameWorld.bannedNameMap ?? {},
            instruction,
        );
    }, [getService]);

    /** Step 5/6: declare a time-skip → produce an uncommitted proposal for review. */
    const declareMontage = useCallback(async (
        actionType: DeclaredActionType,
        unit: DeclaredActionUnit,
        quantity: number,
        focus?: string,
    ) => {
        const resolved = resolveDeclaredAction(actionType, unit, quantity, focus);
        if (resolved.timeMode !== 'MONTAGE' || !resolved.montageType) {
            showToast('That action is too short for a montage.', 'info');
            return;
        }

        setGameHistory(prev => ({ ...prev, isThinking: true }));
        try {
            const response = await runMontageRequest(resolved.declaredAction, resolved.montageType);
            if (!response) {
                setGameHistory(prev => ({ ...prev, isThinking: false }));
                return;
            }
            if (!response.montage_block) {
                showToast('The AI did not return a montage. Try again.', 'error');
                setGameHistory(prev => ({ ...prev, isThinking: false }));
                return;
            }

            const turnCount = useGameStore.getState().gameHistory.turnCount ?? 0;
            const proposal = buildMontageProposal(
                response.montage_block,
                resolved.declaredAction,
                AUTOSAVE_ID,
                turnCount,
                response.narrative ?? '',
            );

            setMontageProposal(proposal); // subscription persists it
            setGameHistory(prev => ({ ...prev, isThinking: false }));
        } catch (e) {
            console.error('[montage] declare failed:', e);
            showToast('Montage generation failed.', 'error');
            setGameHistory(prev => ({ ...prev, isThinking: false }));
        }
    }, [runMontageRequest, setGameHistory, setMontageProposal, showToast]);

    /** Re-run the montage prompt with the same parameters (capped retries). */
    const regenerateMontage = useCallback(async () => {
        const proposal = useGameStore.getState().montageProposal;
        if (!proposal) return;
        if (proposal.regenerateCount >= MONTAGE_MAX_REGENERATES) {
            showToast(`Regenerate limit reached (${MONTAGE_MAX_REGENERATES}).`, 'info');
            return;
        }

        const da = proposal.declaredAction;
        const resolved = resolveDeclaredAction(da.actionType, da.unit, da.quantity, da.focus);
        if (!resolved.montageType) return;

        setGameHistory(prev => ({ ...prev, isThinking: true }));
        try {
            const response = await runMontageRequest(resolved.declaredAction, resolved.montageType);
            if (!response?.montage_block) {
                showToast('Regenerate failed — keeping the previous proposal.', 'error');
                setGameHistory(prev => ({ ...prev, isThinking: false }));
                return;
            }

            const fresh = buildMontageProposal(
                response.montage_block,
                resolved.declaredAction,
                proposal.campaignId,
                proposal.createdTurn,
                response.narrative ?? '',
            );
            // Preserve identity + bump the retry counter so the cap holds.
            setMontageProposal({
                ...fresh,
                id: proposal.id,
                regenerateCount: proposal.regenerateCount + 1,
            });
            setGameHistory(prev => ({ ...prev, isThinking: false }));
        } catch (e) {
            console.error('[montage] regenerate failed:', e);
            showToast('Regenerate failed.', 'error');
            setGameHistory(prev => ({ ...prev, isThinking: false }));
        }
    }, [runMontageRequest, setGameHistory, setMontageProposal, showToast]);

    /** Step 7: commit non-vetoed items + advance the clock in a single pass. */
    const acceptMontage = useCallback(async () => {
        const state = useGameStore.getState();
        const proposal = state.montageProposal;
        if (!proposal) return;

        const turnCount = state.gameHistory.turnCount ?? 0;
        const result = commitMontageProposal(proposal, state.character, state.gameWorld, turnCount + 1);

        const modelMsg: ChatMessage = {
            id: generateMessageId(),
            role: Role.MODEL,
            text: proposal.narrative,
            timestamp: new Date().toISOString(),
        };

        setGameWorld(result.world);
        setCharacter(result.character);
        setGameHistory(prev => ({
            ...prev,
            history: [...prev.history, modelMsg],
            turnCount: turnCount + 1,
            isThinking: false,
            debugLog: [
                ...prev.debugLog,
                ...result.events.map(message => ({
                    timestamp: new Date().toISOString(),
                    message,
                    type: 'info' as const,
                })),
            ],
        }));

        setMontageProposal(null);
        try {
            await db.clearPendingMontage(proposal.campaignId as SaveId);
        } catch (e) {
            console.warn('[montage] clear failed:', e);
        }
        showToast('Montage committed.', 'success');
    }, [setGameWorld, setCharacter, setGameHistory, setMontageProposal, showToast]);

    /** Back out before commit. No time passes; nothing is written. */
    const cancelMontage = useCallback(async () => {
        const proposal = useGameStore.getState().montageProposal;
        setMontageProposal(null);
        if (proposal) {
            try {
                await db.clearPendingMontage(proposal.campaignId as SaveId);
            } catch (e) {
                console.warn('[montage] clear failed:', e);
            }
        }
    }, [setMontageProposal]);

    /** On load, rehydrate a proposal left mid-review by a previous session. */
    const restoreMontage = useCallback(async () => {
        try {
            const p: MontageProposal | undefined = await db.loadPendingMontage(AUTOSAVE_ID);
            if (p) setMontageProposal(p);
        } catch (e) {
            console.warn('[montage] restore failed:', e);
        }
    }, [setMontageProposal]);

    return {
        declareMontage,
        regenerateMontage,
        acceptMontage,
        cancelMontage,
        restoreMontage,
    };
};
