
import { useCallback } from 'react';
import { useGameStore } from '../store';
import { useGeminiService } from './useGeminiService';
import { useToast } from '../components/providers/ToastProvider';
import { useErrorHandler } from './useErrorHandler';
import { db } from '../db';
import { buildSeedBrief } from '../utils/seedBrief';

export const useScenarioGen = () => {
    const { character, setGameWorld } = useGameStore();
    const { getService } = useGeminiService();
    const { showToast } = useToast();
    const { handleError } = useErrorHandler();

    const handleGenerateScenarios = useCallback(async () => {
        try {
          const service = await getService();
          if (!service) return [];

          // v0.12.3: Load the selected world seed (if any) and build a compact
          // brief so scenarios anchor to canon NPCs/factions/locations rather
          // than inventing parallel substitutes. When no seed is selected the
          // brief is empty and behavior matches pre-0.12.3.
          let seedBrief: string | undefined;
          const { gameWorld } = useGameStore.getState();
          if (gameWorld.worldSeedId) {
              try {
                  const seed = await db.loadWorldSeed(gameWorld.worldSeedId);
                  if (seed) {
                      seedBrief = buildSeedBrief(seed);
                  } else {
                      console.warn('[useScenarioGen] worldSeedId set but seed not found:', gameWorld.worldSeedId);
                  }
              } catch (e) {
                  // Don't block scenario generation on a seed-load failure;
                  // fall back to character-only behavior.
                  console.warn('[useScenarioGen] failed to load world seed for brief:', e);
              }
          }

          setGameWorld(prev => ({ ...prev, isGeneratingScenarios: true }));
          const scenarios = await service.generateScenarios(character, seedBrief);

          setGameWorld(prev => ({
            ...prev,
            scenarios: scenarios,
            isGeneratingScenarios: false
          }));
          return scenarios;
        } catch (e) {
          handleError(e, 'scenario_generation');
          setGameWorld(prev => ({ ...prev, isGeneratingScenarios: false }));
          return [];
        }
      }, [getService, character, setGameWorld, handleError]);

    return { handleGenerateScenarios };
};
