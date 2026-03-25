
import { useCallback } from 'react';
import { useGameStore } from '../store';
import { useGeminiService } from './useGeminiService';
import { useToast } from '../components/providers/ToastProvider';
import { useErrorHandler } from './useErrorHandler';

export const useScenarioGen = () => {
    const { character, setGameWorld } = useGameStore();
    const { getService } = useGeminiService();
    const { showToast } = useToast();
    const { handleError } = useErrorHandler();

    const handleGenerateScenarios = useCallback(async () => {
        try {
          const service = await getService();
          if (!service) return [];
    
          setGameWorld(prev => ({ ...prev, isGeneratingScenarios: true }));
          const scenarios = await service.generateScenarios(character);
    
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
