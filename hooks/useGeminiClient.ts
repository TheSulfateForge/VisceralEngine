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
import { UI_CONFIG } from '../constants';

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

  const handleUndo = useCallback(() => {
    const { preTurnSnapshot } = useGameStore.getState();
    if (!preTurnSnapshot) {
        showToast("No turn to undo.", "info");
        return;
    }
    setGameHistory(preTurnSnapshot.history);
    setGameWorld(preTurnSnapshot.world);
    setCharacter(preTurnSnapshot.character);
    useGameStore.getState().setPreTurnSnapshot(null);
    showToast("Last turn reverted.", "success");
  }, [setGameHistory, setGameWorld, setCharacter, showToast]);

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
                setShowKeyPrompt(true);
            }
        }
        showToast("Visual synthesis error.", "error");
    }
  }, [getService, setGameWorld, showToast, setShowKeyPrompt]);

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

  // --- AI Character Generation (Full) ---
  const handleGenerateCharacter = useCallback(async (concept: string): Promise<boolean> => {
    try {
        const service = await getService();
        if (!service) return false;

        const result = await service.generateCharacter(concept);
        if (!result) {
            showToast("Neural synthesis failed. Try a different concept.", "error");
            return false;
        }

        // Merge generated fields into character, preserving bio/trauma defaults
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

  // --- AI Field-Level Assist ---
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

        // Auto-apply the result to the character
        if (Array.isArray(result)) {
            setCharacter(prev => ({
                ...prev,
                [fieldName]: result
            }));
        } else {
            setCharacter(prev => ({
                ...prev,
                [fieldName]: result
            }));
        }

        showToast(`${fieldName} synthesized.`, "success");
        return result;
    } catch (e) {
        console.error(`Field generation error for ${fieldName}:`, e);
        showToast("Field synthesis error.", "error");
        return null;
    }
  }, [getService, setCharacter, showToast]);

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

        const historyForSummarization = useGameStore.getState().gameHistory;
        if (historyForSummarization.history.length > 0 && historyForSummarization.history.length % SUMMARIZATION_INTERVAL === 0) {
            performSummarization(service, historyForSummarization.history).catch(console.error);
        }

        const preCallState = useGameStore.getState();
        const { prompt: contextPrompt, ragDebug } = constructGeminiPrompt(preCallState.gameHistory, preCallState.gameWorld, preCallState.character, text);
        const response: ModelResponseSchema = await service.sendMessage(
            contextPrompt, 
            [...preCallState.gameHistory.history, userMsg], 
            preCallState.gameHistory.lastActiveSummary
        );

        if (latestRequestId.current !== requestId) {
            console.log("Discarding stale response", requestId);
            return;
        }

        const freshState = useGameStore.getState();
        const currentCharacter = freshState.character;
        const currentWorld = freshState.gameWorld;
        const currentHistory = freshState.gameHistory;

        // Capture pre-turn state for undo
        useGameStore.getState().setPreTurnSnapshot({
            history: currentHistory,
            world: currentWorld,
            character: currentCharacter
        });

        // --- STATE DELTA PROCESSING ---
        // Pre-process explicit character updates from AI (Items, Conditions, Modifiers)
        let tempCharUpdates = { ...currentCharacter };
        
        if (response.character_updates) {
            const updates = response.character_updates!;
            let newConditions = [...tempCharUpdates.conditions];
            let newInventory = [...tempCharUpdates.inventory];
            
            // Process Conditions
            if (updates.added_conditions?.length) {
                updates.added_conditions.forEach(c => {
                    if (!newConditions.includes(c)) newConditions.push(c);
                    showToast(`Condition Added: ${c}`, 'error', 6000);
                });
            }
            if (updates.removed_conditions?.length) {
                newConditions = newConditions.filter(c => !updates.removed_conditions!.includes(c));
                updates.removed_conditions.forEach(c => showToast(`Condition Removed: ${c}`, 'success', 6000));
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
        const nextTurn = (currentHistory.turnCount || 0) + 1;
        
        // Pass the already modified character to the engine for biological processing
        const { worldUpdate, characterUpdate, debugLogs } = SimulationEngine.processTurn(
            response, 
            currentWorld, 
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

        setGameHistory(currentHistoryState => ({
            ...currentHistoryState,
            history: [...currentHistoryState.history, modelMsg],
            isThinking: false,
            turnCount: nextTurn,
            debugLog: [
                ...currentHistoryState.debugLog, 
                { timestamp: new Date().toISOString(), message: `Response Received [${requestId}]`, type: 'success' },
                { timestamp: new Date().toISOString(), message: `[RAG] Lore: ${ragDebug.filteredLore}/${ragDebug.totalLore} | Entities: ${ragDebug.filteredEntities}/${ragDebug.totalEntities} | Tokens: [${ragDebug.queryTokens.slice(0, 10).join(', ')}]`, type: 'info' },
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
  }, [getService, setGameHistory, setGameWorld, setCharacter, showToast, setShowKeyPrompt, performSummarization]);

  return {
    handleSend,
    handleVisualize,
    handleKeyLink,
    handleGenerateScenarios,
    handleUndo,
    handleGenerateCharacter,
    handleGenerateField
  };
};