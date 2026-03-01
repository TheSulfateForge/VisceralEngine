import { useRef, useCallback } from 'react';
import { ChatMessage, Role, ModelResponseSchema } from '../types';
import { generateMessageId } from '../idUtils';
import { mapSystemErrorToNarrative } from '../utils';
import { useToast } from '../components/providers/ToastProvider';
import { constructGeminiPrompt } from '../utils/promptUtils';
import { GeminiService } from '../geminiService';
import { useGameStore } from '../store';
import { SimulationEngine } from '../utils/simulationEngine';
import { getSectionReminders } from '../sectionReminders';

// Extracted Hooks & Utils
import { useGeminiService } from './useGeminiService';
import { useVisualization } from './useVisualization';
import { useScenarioGen } from './useScenarioGen';
import { useCharacterGen } from './useCharacterGen';
import { processCharacterUpdates } from '../utils/characterDelta';
import { deduplicateConditions } from '../utils/characterUtils';
import { significantWords } from '../utils/contentValidation';

const SUMMARIZATION_INTERVAL = 20;

export const useGeminiClient = () => {
  const { 
      setGameHistory, 
      setGameWorld, 
      setCharacter, 
      setUI,
      setPendingLore 
  } = useGameStore();
  
  const latestRequestId = useRef<string | null>(null);
  const { showToast } = useToast();

  // Composed Sub-Hooks
  const { getService, handleKeyLink } = useGeminiService();
  const { handleVisualize } = useVisualization();
  const { handleGenerateScenarios } = useScenarioGen();
  const { handleGenerateCharacter, handleGenerateField, handleExtractDormantHooks } = useCharacterGen();

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

  const performSummarization = useCallback(async (service: GeminiService, history: ChatMessage[]) => {
      const summary = await service.summarizeHistory(history);
      if (summary) {
          setGameHistory(prev => ({
             ...prev,
             lastActiveSummary: summary
          }));
      }
  }, [setGameHistory]);

  // Main Turn Orchestrator
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

    // v1.12 FIX UI-1: Detect player rejection of AI fabrications
    // When the player writes CANCEL/DELETE/REMOVE, extract the rejected
    // concept and add it to bannedMechanisms so the engine blocks re-use.
    const REJECTION_MARKERS = ['CANCEL', 'DELETE', 'REMOVE', 'bullshit', 'doesn\'t exist', 'does not exist'];
    const hasRejection = REJECTION_MARKERS.some(marker => 
        text.toUpperCase().includes(marker.toUpperCase())
    );
    
    if (hasRejection) {
        const currentWorld = useGameStore.getState().gameWorld;
        const currentBanned = ((currentWorld as any).bannedMechanisms as string[][]) ?? [];
        
        // Extract the rejected concept keywords from the player's message
        // Look for threat descriptions in the CANCEL text (between quotes or after keywords)
        const threatDescMatch = text.match(/(?:CANCEL|DELETE|REMOVE)[^"]*"([^"]+)"/i) 
            ?? text.match(/(?:CANCEL|DELETE|REMOVE)\s+(?:THIS\s+)?(.+?)(?:\.|$)/im);
        
        if (threatDescMatch) {
            const rejectedText = threatDescMatch[1];
            const rejectedWords = [...significantWords(rejectedText)];
            
            if (rejectedWords.length >= 3) {
                const updatedBanned = [...currentBanned, rejectedWords];
                // Cap at 20 banned mechanisms to prevent unbounded growth
                const trimmedBanned = updatedBanned.slice(-20);
                
                useGameStore.getState().setGameWorld({
                    ...currentWorld,
                    bannedMechanisms: trimmedBanned
                } as any);
                
                console.log('[v1.12] Banned mechanism added:', rejectedWords);
            }
        }
        
        // Also check for specific mechanism rejections stated in natural language
        // e.g., "Hucows do not produce a trackable pheromone"
        const MECHANISM_DENIAL_PATTERNS = [
            /(?:does?\s+not?|doesn'?t|don'?t|cannot|can'?t)\s+(?:have|carry|produce|emit|use|possess)\s+(.+?)(?:\.|$)/gi,
            /(?:such a thing|no such thing|that)\s+(?:does\s+not|doesn'?t)\s+exist/gi,
        ];
        
        for (const pattern of MECHANISM_DENIAL_PATTERNS) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                if (match[1]) {
                    const deniedWords = [...significantWords(match[1])];
                    if (deniedWords.length >= 2) {
                        const currentBannedNow = ((useGameStore.getState().gameWorld as any).bannedMechanisms as string[][]) ?? [];
                        const updatedBannedNow = [...currentBannedNow, deniedWords].slice(-20);
                        useGameStore.getState().setGameWorld({
                            ...useGameStore.getState().gameWorld,
                            bannedMechanisms: updatedBannedNow
                        } as any);
                        console.log('[v1.12] Mechanism denial banned:', deniedWords);
                    }
                }
            }
        }
    }

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
        const playerRemovedConditions = preCallState.playerRemovedConditions;
        useGameStore.getState().clearPlayerRemovedConditions();

        const { prompt: contextPrompt, ragDebug } = constructGeminiPrompt(preCallState.gameHistory, preCallState.gameWorld, preCallState.character, text, playerRemovedConditions);
        
        // Debug Log the injected reminder if active
        // v1.5: Pass entityCount and goalCount to match updated signature.
        const activeReminders = getSectionReminders(
            preCallState.gameHistory.turnCount,
            preCallState.gameWorld.sceneMode,
            preCallState.gameWorld.lastBargainTurn ?? 0,
            preCallState.gameWorld.turnCount ?? 0,
            preCallState.character.conditions.length,
            (preCallState.gameWorld.knownEntities ?? []).length,
            (preCallState.character.goals ?? []).length,
            ((preCallState.gameWorld as any).emergingThreats ?? []).length,
            !!((preCallState.gameWorld as any).__passiveAllies as string[] | undefined)?.length
        );
        // Join multiple reminders into a single string for the prompt
        const activeReminder = activeReminders.length > 0 
            ? activeReminders.join('\n\n---\n\n') 
            : null;
        let requestLogs = [...preCallState.gameHistory.debugLog];
        
        
        if (activeReminder) {
            const truncatedReminder = activeReminder.split('\n')[0];
            requestLogs.push({
                timestamp: new Date().toISOString(),
                message: `[SYSTEM REFRESH] Injected: ${truncatedReminder}`,
                type: 'info'
            });
            setGameHistory(prev => ({
                ...prev,
                debugLog: requestLogs
            }));
        }

        const response: ModelResponseSchema = await service.sendMessage(
            contextPrompt, 
            [...preCallState.gameHistory.history, userMsg], 
            preCallState.gameHistory.lastActiveSummary,
            preCallState.gameWorld.bannedNameMap ?? {}  // v1.7
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
        // Extracted to utils/characterDelta.ts
        let tempCharUpdates = currentCharacter;
        if (response.character_updates) {
            tempCharUpdates = processCharacterUpdates(currentCharacter, response.character_updates, showToast);
        }

        // --- SIMULATION ENGINE EXECUTION ---
        const nextTurn = (currentHistory.turnCount || 0) + 1;
        
        const { worldUpdate, characterUpdate, debugLogs, pendingLore } = SimulationEngine.processTurn(
            response, 
            currentWorld, 
            tempCharUpdates, 
            nextTurn,
            playerRemovedConditions
        );

        // Deduplicate conditions on the final update (extracted to utils/characterUtils.ts)
        const finalCharacterUpdate = {
            ...characterUpdate,
            conditions: deduplicateConditions(characterUpdate.conditions)
        };

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
        setCharacter(finalCharacterUpdate);

        // Queue pending lore for player approval
        if (pendingLore.length > 0) {
            setPendingLore(prev => [...prev, ...pendingLore]);
        }

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
                setUI({ showKeyPrompt: true });
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
  }, [getService, setGameHistory, setGameWorld, setCharacter, showToast, setUI, performSummarization, setPendingLore]);

  return {
    handleSend,
    handleVisualize,
    handleKeyLink,
    handleGenerateScenarios,
    handleUndo,
    handleGenerateCharacter,
    handleGenerateField,
    handleExtractDormantHooks,  // v1.6
  };
};