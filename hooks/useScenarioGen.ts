
import { useCallback } from 'react';
import { useGameStore } from '../store';
import { useGeminiService } from './useGeminiService';
import { useToast } from '../components/providers/ToastProvider';

export const useScenarioGen = () => {
    const { character, setGameWorld } = useGameStore();
    const { getService } = useGeminiService();
    const { showToast } = useToast();

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
          console.error("Scenario generation error:", e);
          setGameWorld(prev => ({ ...prev, isGeneratingScenarios: false }));
          showToast("Scenario calculation failed.", "error");
          return [];
        }
      }, [getService, character, setGameWorld, showToast]);

    return { handleGenerateScenarios };
};
