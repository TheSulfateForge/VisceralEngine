import { useRef, useCallback } from 'react';
import { GeminiService } from '../geminiService';
import { ChatMessage, Role, ModelResponseSchema } from '../types';
import { generateMessageId } from '../idUtils';
import { mapSystemErrorToNarrative } from '../utils';
import { useToast } from '../components/providers/ToastProvider';
import { constructGeminiPrompt } from '../utils/promptUtils';
import { db } from '../db';
import { SYSTEM_INSTRUCTIONS } from '../systemInstructions';
import { useGameStore } from '../store';
import { SimulationEngine } from '../utils/simulationEngine';

const SUMMARIZATION_INTERVAL = 20;

export const useGeminiClient = () => {
  const { 
      gameHistory, setGameHistory, 
      gameWorld, setGameWorld, 
      character, setCharacter, 
      setShowKeyPrompt 
  } = useGameStore();
  
  const latestRequestId = useRef<string | null>(null);
  const { showToast } = useToast();

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
        setShowKeyPrompt(true);
        return null;
    }

    return new GeminiService(apiKey, gameWorld.currentModel);
  }, [gameWorld.currentModel, setShowKeyPrompt]);

  const handleKeyLink = useCallback(async () => {
    if (window.aistudio?.openSelectKey) {
      await window.aistudio.openSelectKey();
      setShowKeyPrompt(false);
      return;
    }
    const key = prompt("Enter Gemini API Key:");
    if (key) {
      localStorage.setItem('visceral_api_key', key);
      setShowKeyPrompt(false);
    }
  }, [setShowKeyPrompt]);

  const handleVisualize = useCallback(async () => {
    try {
        const service = await getService();
        if (!service) return;

        setGameWorld(prev => ({ ...prev, isGeneratingVisual: true }));

        const lastScene = gameHistory.history.slice(-1)[0]?.text || character.setting;
        const prompt = `Subject: ${character.name}, ${character.appearance}. Scene: ${lastScene.slice(0, 300)}.`;

        const base64Data = await service.generateImage(prompt);

        if (base64Data) {
            try {
                const imageId = await db.saveImage(base64Data);
                setGameWorld(prev => ({ 
                    ...prev, 
                    visualUrl: imageId, 
                    generatedImages: [imageId, ...prev.generatedImages], 
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
                setShowKeyPrompt(true);
            }
        }
        showToast("Visual synthesis error.", "error");
    }
  }, [getService, gameHistory.history, character, setGameWorld, showToast, setShowKeyPrompt]);

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

  const performSummarization = useCallback(async (service: GeminiService, history: ChatMessage[]) => {
      const summary = await service.summarizeHistory(history);
      if (summary) {
          setGameHistory(prev => ({
             ...prev,
             lastActiveSummary: summary
          }));
      }
  }, [setGameHistory]);

  const handleSend = useCallback(async (text: string) => {
    if (!text.trim()) return;
    
    const requestId = Date.now().toString();
    latestRequestId.current = requestId;

    const userMsg: ChatMessage = {
      id: generateMessageId(),
      role: Role.USER,
      text,
      timestamp: new Date().toISOString()
    };

    setGameHistory(prev => ({
        ...prev,
        history: [...prev.history, userMsg],
        isThinking: true,
        debugLog: [...prev.debugLog, { timestamp: new Date().toISOString(), message: `Sending Request [${requestId}]`, type: 'info' }]
    }));

    try {
        const service = await getService();
        if (!service) {
            setGameHistory(gs => ({ ...gs, isThinking: false }));
            return;
        }

        if (gameHistory.history.length > 0 && gameHistory.history.length % SUMMARIZATION_INTERVAL === 0) {
            performSummarization(service, gameHistory.history).catch(console.error);
        }

        const contextPrompt = `${SYSTEM_INSTRUCTIONS}\n\n${constructGeminiPrompt(gameHistory, gameWorld, character, text)}`;
        const response: ModelResponseSchema = await service.sendMessage(contextPrompt, [...gameHistory.history, userMsg], gameHistory.lastActiveSummary);

        if (latestRequestId.current !== requestId) {
            console.log("Discarding stale response", requestId);
            return;
        }

        // --- STATE DELTA PROCESSING ---
        // Pre-process explicit character updates from AI (Items, Conditions, Modifiers)
        let tempCharUpdates = { ...character };
        
        if (response.character_updates) {
            const updates = response.character_updates!;
            let newConditions = [...tempCharUpdates.conditions];
            let newInventory = [...tempCharUpdates.inventory];
            
            // Process Conditions
            if (updates.added_conditions?.length) {
                updates.added_conditions.forEach(c => {
                    if (!newConditions.includes(c)) newConditions.push(c);
                    showToast(`Condition Added: ${c}`, 'error');
                });
            }
            if (updates.removed_conditions?.length) {
                newConditions = newConditions.filter(c => !updates.removed_conditions!.includes(c));
                updates.removed_conditions.forEach(c => showToast(`Condition Removed: ${c}`, 'success'));
            }

            // Process Inventory
            if (updates.added_inventory?.length) {
                updates.added_inventory.forEach(i => {
                    if (!newInventory.includes(i)) newInventory.push(i);
                    showToast(`Item Acquired: ${i}`, 'success');
                });
            }
            if (updates.removed_inventory?.length) {
                newInventory = newInventory.filter(i => !updates.removed_inventory!.includes(i));
                updates.removed_inventory.forEach(i => showToast(`Item Lost: ${i}`, 'info'));
            }

            // Process Trauma
            let newTrauma = (tempCharUpdates.trauma || 0) + (updates.trauma_delta || 0);
            newTrauma = Math.max(0, Math.min(100, newTrauma));

            // Process Bio-Modifiers (Merging with existing)
            let newBioModifiers = { ...tempCharUpdates.bio.modifiers };
            if (updates.bio_modifiers) {
                if (updates.bio_modifiers.calories !== undefined) newBioModifiers.calories = updates.bio_modifiers.calories;
                if (updates.bio_modifiers.hydration !== undefined) newBioModifiers.hydration = updates.bio_modifiers.hydration;
                if (updates.bio_modifiers.stamina !== undefined) newBioModifiers.stamina = updates.bio_modifiers.stamina;
                if (updates.bio_modifiers.lactation !== undefined) newBioModifiers.lactation = updates.bio_modifiers.lactation;
            }

            tempCharUpdates = {
                ...tempCharUpdates,
                conditions: newConditions,
                inventory: newInventory,
                trauma: newTrauma,
                bio: {
                    ...tempCharUpdates.bio,
                    modifiers: newBioModifiers
                },
                relationships: updates.relationships || tempCharUpdates.relationships,
                goals: updates.goals || tempCharUpdates.goals
            };
        }

        // --- SIMULATION ENGINE EXECUTION ---
        const nextTurn = (gameHistory.turnCount || 0) + 1;
        
        // Pass the already modified character to the engine for biological processing
        const { worldUpdate, characterUpdate, debugLogs } = SimulationEngine.processTurn(
            response, 
            gameWorld, 
            tempCharUpdates, 
            nextTurn
        );

        const modelMsg: ChatMessage = {
            id: generateMessageId(),
            role: Role.MODEL,
            text: response.narrative,
            timestamp: new Date().toISOString(),
            rollRequest: response.roll_request,
            bargainRequest: response.bargain_request,
            npcInteraction: response.npc_interaction
        };

        // Commit all updates
        setGameWorld(worldUpdate);
        setCharacter(characterUpdate);

        setGameHistory(currentHistory => ({
            ...currentHistory,
            history: [...currentHistory.history, modelMsg],
            isThinking: false,
            turnCount: nextTurn,
            debugLog: [
                ...currentHistory.debugLog, 
                { timestamp: new Date().toISOString(), message: `Response Received [${requestId}]`, type: 'success' },
                ...debugLogs
            ]
        }));

    } catch (e: unknown) {
        if (latestRequestId.current !== requestId) return;
        
        const rawErrorMessage = e instanceof Error ? e.message : String(e);

        if (rawErrorMessage.includes("Requested entity was not found") || rawErrorMessage.includes("API key not valid")) {
            if (window.aistudio) {
                setShowKeyPrompt(true);
            }
        }

        const errText = mapSystemErrorToNarrative(rawErrorMessage);
        setGameHistory(gs => ({
            ...gs,
            isThinking: false,
            history: [...gs.history, { id: generateMessageId(), role: Role.SYSTEM, text: errText, timestamp: new Date().toISOString() }],
            debugLog: [...gs.debugLog, { timestamp: new Date().toISOString(), message: `Error [${requestId}]: ${rawErrorMessage}`, type: 'error' }]
        }));
        showToast("Signal Lost.", "error");
    }
  }, [getService, character, gameHistory, gameWorld, setGameHistory, setGameWorld, setCharacter, showToast, setShowKeyPrompt, performSummarization]);

  return {
    handleSend,
    handleVisualize,
    handleKeyLink,
    handleGenerateScenarios
  };
};