
import { useCallback } from 'react';
import { useGameStore } from '../store';
import { GeminiService } from '../geminiService';

export const useGeminiService = () => {
    const { gameWorld, setUI } = useGameStore();

    const getService = useCallback(async (): Promise<GeminiService | null> => {
        let apiKey: string | null = null;

        if (window.aistudio) {
            const hasKey = await window.aistudio.hasSelectedApiKey();
            if (hasKey) {
                apiKey = process.env.API_KEY || '';
            }
        } else {
            apiKey = localStorage.getItem('visceral_api_key');
        }

        if (!apiKey) {
            setUI({ showKeyPrompt: true });
            return null;
        }

        return new GeminiService(apiKey, gameWorld.currentModel);
    }, [gameWorld.currentModel, setUI]);

    const handleKeyLink = useCallback(async () => {
        if (window.aistudio?.openSelectKey) {
            await window.aistudio.openSelectKey();
            setUI({ showKeyPrompt: false });
            return;
        }
        const key = prompt("Enter Gemini API Key:");
        if (key) {
            localStorage.setItem('visceral_api_key', key);
            setUI({ showKeyPrompt: false });
        }
    }, [setUI]);

    return { getService, handleKeyLink };
};
