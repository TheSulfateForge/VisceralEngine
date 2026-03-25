
import { useCallback } from 'react';
import { useGameStore } from '../store';
import { useGeminiService } from './useGeminiService';
import { useToast } from '../components/providers/ToastProvider';
import { useErrorHandler } from './useErrorHandler';
import { CharacterService } from '../services/characterService';
import { SkillService } from '../services/skillService';
import { db } from '../db';
import { hydrateWorldSeed } from '../utils/worldSeedHydration';

export const useCharacterGen = () => {
    const { setCharacter, setGameWorld } = useGameStore();
    const { getService } = useGeminiService();
    const { showToast } = useToast();
    const { handleError } = useErrorHandler();

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
            handleError(e, 'character_generation');
            return false;
        }
      }, [getService, setCharacter, handleError]);
    
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
            handleError(e, 'field_generation');
            return null;
        }
      }, [getService, setCharacter, handleError]);

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

          const characterService = new CharacterService(service);
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
          handleError(e, 'dormant_hook_extraction');
      }
  }, [getService, setGameWorld, handleError]);

  /**
   * Stream 5: Extract initial skills from the current character.
   * Call this once when the player starts a session (before the first AI turn).
   * The result is written directly to character.skills.
   */
  const handleExtractSkills = useCallback(async (): Promise<void> => {
      const { character } = useGameStore.getState();
      if (!character.name || !character.backstory) return;

      try {
          const service = await getService();
          if (!service) return;

          const skillService = new SkillService(service);
          const skills = await skillService.extractInitialSkills(character);

          if (skills.length > 0) {
              setCharacter(prev => ({ ...prev, skills }));
              useGameStore.getState().setGameHistory(prev => ({
                  ...prev,
                  debugLog: [...prev.debugLog, {
                      timestamp: new Date().toISOString(),
                      message: `[SESSION START] Extracted ${skills.length} skill(s): ${skills.map(s => `${s.name} (${s.level})`).join(', ')}`,
                      type: 'info'
                  }]
              }));
          }
      } catch (e) {
          handleError(e, 'skill_extraction');
      }
  }, [getService, setCharacter, handleError]);

  /**
   * Stream 7: Hydrate World Seed at session start.
   * If a world seed is selected, load it and merge its locations, NPCs, factions, lore, and rules
   * into the game world.
   */
  const handleHydrateWorldSeed = useCallback(async (): Promise<void> => {
      const { gameWorld } = useGameStore.getState();
      if (!gameWorld.worldSeedId) return;

      try {
          const seed = await db.loadWorldSeed(gameWorld.worldSeedId);
          if (!seed) {
              console.warn('[Stream 7] World seed not found:', gameWorld.worldSeedId);
              return;
          }

          const hydrated = hydrateWorldSeed(seed);

          setGameWorld(prev => ({
              ...prev,
              ...hydrated,
              worldSeedId: seed.id,
          }));

          useGameStore.getState().setGameHistory(prev => ({
              ...prev,
              debugLog: [
                  ...prev.debugLog,
                  {
                      timestamp: new Date().toISOString(),
                      message: `[SESSION START] Hydrated world seed "${seed.name}" — ${seed.locations.length} locations, ${seed.npcs.length} NPCs, ${seed.factions.length} factions`,
                      type: 'info'
                  }
              ]
          }));
      } catch (e) {
          handleError(e, 'world_seed_hydration');
      }
  }, [setGameWorld, handleError]);

  return {
      handleGenerateCharacter,
      handleGenerateField,
      handleExtractDormantHooks,  // v1.6: exposed for ScenarioSelectionView
      handleExtractSkills,        // Stream 5: exposed for session initialization
      handleHydrateWorldSeed,     // Stream 7: exposed for session initialization
  };
};