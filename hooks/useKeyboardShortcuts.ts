
import { useEffect } from 'react';
import { useGameStore } from '../store';
import { usePersistence } from './usePersistence';
import { useGeminiClient } from './useGeminiClient';

export const useKeyboardShortcuts = () => {
    // We do NOT subscribe to the store state here to avoid re-renders.
    // We access state directly inside the callback via getState().
    const { handleExport } = usePersistence();
    const { handleVisualize } = useGeminiClient();

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore if user is typing in an input or textarea
            if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
                return;
            }

            const key = e.key.toLowerCase();
            const ctrl = e.ctrlKey || e.metaKey;

            // Direct state access for ephemeral checks
            const state = useGameStore.getState();

            // SAVE: ctrl+s
            if (ctrl && key === 's') {
                e.preventDefault();
                state.setShowSaveModal(true);
            }
            // LOAD: ctrl+l
            else if (ctrl && key === 'l') {
                e.preventDefault();
                state.setShowLoadModal(true);
            }
            // EXPORT: ctrl+e
            else if (ctrl && key === 'e') {
                e.preventDefault();
                handleExport();
            }
            // ROLL/VISUALIZE: ctrl+r
            else if (ctrl && key === 'r') {
                e.preventDefault();
                if (!state.gameWorld.isGeneratingVisual) {
                    handleVisualize();
                }
            }
            // HELP/DEBUG: ctrl+/
            else if (ctrl && key === '/') {
                e.preventDefault();
                state.setIsDebugOpen(!state.isDebugOpen);
            }
            // CLOSE MODALS: Escape
            else if (e.key === 'Escape') {
                state.setShowSaveModal(false);
                state.setShowLoadModal(false);
                state.setIsSettingsOpen(false);
                state.setIsGalleryOpen(false);
                state.setIsDebugOpen(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleExport, handleVisualize]);
};
