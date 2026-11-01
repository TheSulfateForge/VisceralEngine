
import { useCallback } from 'react';
import { useGameStore } from '../store';
import { useGeminiService } from './useGeminiService';
import { useToast } from '../components/providers/ToastProvider';
import { useErrorHandler } from './useErrorHandler';
import { db } from '../db';
import { UI_CONFIG } from '../constants';
import { isImageGenerationAvailable } from '../config/aiProvider';

export const useVisualization = () => {
    const { setGameWorld, setUI } = useGameStore();
    const { getService } = useGeminiService();
    const { showToast } = useToast();
    const { handleError } = useErrorHandler();

    const handleVisualize = useCallback(async () => {
        // v1.49: image generation is Google-only; off while OpenRouter is active.
        // Covers the buttons and the keyboard shortcut.
        if (!isImageGenerationAvailable()) {
            showToast("Image generation is disabled while OpenRouter is the active provider.", "error");
            return;
        }
        try {
            const service = await getService();
            if (!service) return;

            setGameWorld(prev => ({ ...prev, isGeneratingVisual: true }));

            const vizState = useGameStore.getState();
            const lastScene = vizState.gameHistory.history.slice(-1)[0]?.text || vizState.character.setting;
            const prompt = `Subject: ${vizState.character.name}, ${vizState.character.appearance}. Scene: ${lastScene.slice(0, 300)}.`;

            const base64Data = await service.generateImage(prompt);

            if (base64Data) {
                try {
                    const imageId = await db.saveImage(base64Data);
                    setGameWorld(prev => ({ 
                        ...prev, 
                        visualUrl: imageId, 
                        generatedImages: [imageId, ...prev.generatedImages].slice(0, UI_CONFIG.MAX_GENERATED_IMAGES), 
                        isGeneratingVisual: false 
                    }));
                } catch (dbError) {
                    handleError(dbError, 'image_storage');
                    setGameWorld(prev => ({ ...prev, isGeneratingVisual: false }));
                }
            } else {
                setGameWorld(prev => ({ ...prev, isGeneratingVisual: false }));
                showToast("Visual synthesis failed.", "error");
            }
        } catch (e: unknown) {
            handleError(e, 'visualization');
            setGameWorld(prev => ({ ...prev, isGeneratingVisual: false }));

            const errorMessage = e instanceof Error ? e.message : String(e);
            if (errorMessage.includes("Requested entity was not found") || errorMessage.includes("API key not valid")) {
                if (window.aistudio) {
                    setUI({ showKeyPrompt: true });
                }
            }
        }
    }, [getService, setGameWorld, handleError, setUI, showToast]);

    return { handleVisualize };
};
