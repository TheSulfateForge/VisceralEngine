
import { useCallback } from 'react';
import { useGameStore } from '../store';
import { useGeminiService } from './useGeminiService';
import { useToast } from '../components/providers/ToastProvider';

export const useCharacterGen = () => {
    const { setCharacter } = useGameStore();
    const { getService } = useGeminiService();
    const { showToast } = useToast();

    const handleGenerateCharacter = useCallback(async (concept: string): Promise<boolean> => {
        try {
            const service = await getService();
            if (!service) return false;
    
            const result = await service.generateCharacter(concept);
            if (!result) {
                showToast("Neural synthesis failed. Try a different concept.", "error");
                return false;
            }
    
            setCharacter(prev => ({
                ...prev,
                name: result.name,
                gender: result.gender,
                appearance: result.appearance,
                notableFeatures: result.notableFeatures,
                race: result.race,
                backstory: result.backstory,
                setting: result.setting,
                inventory: result.inventory || [],
                relationships: result.relationships || [],
                conditions: result.conditions || [],
                goals: result.goals || [],
            }));
    
            showToast("Subject profile synthesized.", "success");
            return true;
        } catch (e) {
            console.error("Character generation error:", e);
            showToast("Neural synthesis error.", "error");
            return false;
        }
      }, [getService, setCharacter, showToast]);
    
      const handleGenerateField = useCallback(async (
        fieldName: string,
        fieldDescription: string
      ): Promise<string | string[] | null> => {
        try {
            const service = await getService();
            if (!service) return null;
    
            const currentChar = useGameStore.getState().character;
            const result = await service.generateCharacterField(currentChar, fieldName, fieldDescription);
    
            if (result === null) {
                showToast("Field synthesis failed.", "error");
                return null;
            }
    
            setCharacter(prev => ({
                ...prev,
                [fieldName]: result
            }));
    
            showToast(`${fieldName} synthesized.`, "success");
            return result;
        } catch (e) {
            console.error(`Field generation error for ${fieldName}:`, e);
            showToast("Field synthesis error.", "error");
            return null;
        }
      }, [getService, setCharacter, showToast]);

    return { handleGenerateCharacter, handleGenerateField };
};