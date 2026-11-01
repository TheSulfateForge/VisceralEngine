
import { useCallback } from 'react';
import { useGameStore } from '../store';
import { GeminiService } from '../geminiService';
import { useAiProviderStore, getActiveModelName } from '../config/aiProvider';

export const useGeminiService = () => {
    const { gameWorld, setUI } = useGameStore();
    // v1.49: re-create the service when the provider, key or model changes.
    const provider = useAiProviderStore(s => s.provider);
    const openRouterKey = useAiProviderStore(s => s.openRouterKey);
    const openRouterModel = useAiProviderStore(s => s.openRouterModel);

    const getService = useCallback(async (): Promise<GeminiService | null> => {
        // v1.49: OpenRouter — key comes from Settings (saved in localStorage).
        if (provider === 'openrouter') {
            if (!openRouterKey) {
                setUI({ showKeyPrompt: true });
                return null;
            }
            return new GeminiService(openRouterKey, getActiveModelName(gameWorld.currentModel), 'openrouter');
        }

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

        return new GeminiService(apiKey, gameWorld.currentModel, 'gemini');
    }, [gameWorld.currentModel, setUI, provider, openRouterKey, openRouterModel]);

    const handleKeyLink = useCallback(async () => {
        // v1.49: OpenRouter key prompt.
        if (useAiProviderStore.getState().provider === 'openrouter') {
            const key = prompt("Enter OpenRouter API Key:");
            if (key && key.trim()) {
                useAiProviderStore.getState().setOpenRouterKey(key);
                setUI({ showKeyPrompt: false });
            }
            return;
        }
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
