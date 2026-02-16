
import { useCallback } from 'react';
import { useGameStore } from '../store';
import { useGeminiService } from './useGeminiService';
import { useToast } from '../components/providers/ToastProvider';
import { db } from '../db';
import { UI_CONFIG } from '../constants';

export const useVisualization = () => {
    const { setGameWorld, setUI } = useGameStore();
    const { getService } = useGeminiService();
    const { showToast } = useToast();

    const handleVisualize = useCallback(async () => {
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
                    console.error("DB Save failed", dbError);
                    showToast("Failed to save visual to memory.", "error");
                    setGameWorld(prev => ({ ...prev, isGeneratingVisual: false }));
                }
            } else {
                setGameWorld(prev => ({ ...prev, isGeneratingVisual: false }));
                showToast("Visual synthesis failed.", "error");
            }
        } catch (e: unknown) {
            console.error("Visualization error:", e);
            setGameWorld(prev => ({ ...prev, isGeneratingVisual: false }));
            
            const errorMessage = e instanceof Error ? e.message : String(e);
            if (errorMessage.includes("Requested entity was not found") || errorMessage.includes("API key not valid")) {
                if (window.aistudio) {
                    setUI({ showKeyPrompt: true });
                }
            }
            showToast("Visual synthesis error.", "error");
        }
    }, [getService, setGameWorld, showToast, setUI]);

    return { handleVisualize };
};
