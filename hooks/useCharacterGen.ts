
import { useCallback } from 'react';
import { useGameStore } from '../store';
import { useGeminiService } from './useGeminiService';
import { useToast } from '../components/providers/ToastProvider';
import { CharacterService } from '../services/characterService';

export const useCharacterGen = () => {
    const { setCharacter, setGameWorld } = useGameStore();
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

      /**
   * v1.6: Extract Dormant Hook Registry from the current character.
   * Call this once when the player starts a session (before the first AI turn).
   * The result is written directly to gameWorld.dormantHooks.
   */
  const handleExtractDormantHooks = useCallback(async (): Promise<void> => {
      const { character } = useGameStore.getState();
      if (!character.name || !character.backstory) return;

      try {
          const service = await getService();
          if (!service) return;

          const characterService = new CharacterService((service as any).client ?? service);
          const hooks = await characterService.extractDormantHooks(character);

          if (hooks.length > 0) {
              setGameWorld(prev => ({
                  ...prev,
                  dormantHooks: hooks
              }));
              // Log to debug panel
              useGameStore.getState().setGameHistory(prev => ({
                  ...prev,
                  debugLog: [
                      ...prev.debugLog,
                      {
                          timestamp: new Date().toISOString(),
                          message: `[SESSION START] Extracted ${hooks.length} dormant hook(s): ${hooks.map(h => h.id).join(', ')}`,
                          type: 'info'
                      }
                  ]
              }));
          }
      } catch (e) {
          console.error('[DormantHooks] Session-start extraction failed:', e);
      }
  }, [getService, setGameWorld]);

  return {
      handleGenerateCharacter,
      handleGenerateField,
      handleExtractDormantHooks,  // v1.6: exposed for ScenarioSelectionView
  };
};