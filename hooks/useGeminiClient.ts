import { useRef, useCallback } from 'react';
import { ChatMessage, Role, ModelResponseSchema, SummarySegment } from '../types';
import { generateMessageId } from '../idUtils';
import { mapSystemErrorToNarrative } from '../utils';
import { useToast } from '../components/providers/ToastProvider';
import { constructGeminiPrompt } from '../utils/promptUtils';
import { SYSTEM_INSTRUCTIONS } from '../systemInstructions'; // v1.19: Wire persona into API call
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
import { getContextProfile } from '../config/engineConfig';
import { extractDeniedMechanisms } from '../utils/mechanismDenial';

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
  const { handleGenerateCharacter, handleGenerateField, handleExtractDormantHooks, handleHydrateWorldSeed } = useCharacterGen();

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

  /**
   * v1.22: Segment-based summarisation.
   *
   * Instead of regenerating one flat summary over the whole transcript every
   * N turns, we summarise only the *new* window (since the last segment) and
   * append it to `summarySegments`. The prompt builder then RAG-ranks the
   * stored segments at injection time, so a 200-turn campaign keeps a chain
   * of ~10 small segments and the model still only sees 2-3 of them at once.
   *
   * Backward compat: if `lastActiveSummary` exists from an older save and no
   * segments yet, treat the legacy string as a single segment covering turns
   * 0..(currentTurn - intervalSize) on first run, then start appending.
   */
  const performSegmentSummarization = useCallback(async (
      service: GeminiService,
      history: ChatMessage[],
      currentTurn: number,
      intervalSize: number,
  ) => {
      // Slice only the new window — the messages added since the last segment.
      const window = history.slice(-intervalSize);
      if (window.length === 0) return;

      const summary = await service.summarizeHistory(window);
      if (!summary) return;

      setGameHistory(prev => {
          const existing = prev.summarySegments ?? [];
          const lastEnd = existing.length > 0
              ? existing[existing.length - 1].endTurn
              : 0;
          const startTurn = lastEnd + 1;
          const endTurn = currentTurn;

          // Guard: don't append a segment that doesn't advance the timeline.
          // Can happen if the user calls summarisation rapidly via debug tools.
          if (endTurn <= lastEnd) return prev;

          const next: SummarySegment = {
              startTurn,
              endTurn,
              summary,
              timestamp: new Date().toISOString(),
          };

          return {
              ...prev,
              summarySegments: [...existing, next],
              // Keep the legacy string in sync so any older consumer still
              // sees the most recent narrative summary.
              lastActiveSummary: summary,
          };
      });
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

    // v1.12 FIX UI-1: Detect player rejection of AI fabrications.
    // When the player writes "there is no X" / "cancel the Y" / etc.,
    // extract the rejected concept and add it to bannedMechanisms so
    // the engine blocks the AI from re-using that concept.
    const deniedMechanisms = extractDeniedMechanisms(text);
    if (deniedMechanisms.length > 0) {
        setGameWorld(currentWorld => {
            const currentBanned = currentWorld.bannedMechanisms ?? [];
            const updatedBanned = [...currentBanned, ...deniedMechanisms].slice(-20);
            return { ...currentWorld, bannedMechanisms: updatedBanned };
        });
        for (const d of deniedMechanisms) {
            console.log('[v1.12] Mechanism denial banned:', d);
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

        // v1.21/v1.22: Model-adaptive segment summarisation. Lite models
        // summarise more often so each segment stays small and recall-able.
        // Only the new window is summarised — older segments stay intact and
        // are RAG-ranked at prompt-build time.
        const contextProfile = getContextProfile(service.modelName);
        const historyForSummarization = useGameStore.getState().gameHistory;
        if (
            historyForSummarization.history.length > 0 &&
            historyForSummarization.history.length % contextProfile.summarizationInterval === 0
        ) {
            performSegmentSummarization(
                service,
                historyForSummarization.history,
                historyForSummarization.turnCount,
                contextProfile.summarizationInterval,
            ).catch(console.error);
        }

        const preCallState = useGameStore.getState();
        const playerRemovedConditions = preCallState.playerRemovedConditions;
        useGameStore.getState().clearPlayerRemovedConditions();

        // v1.21: Pass modelName for model-adaptive context limits, and
        // historicalSummary so it can be positioned at the TOP of dynamic context
        // (moved from geminiClient.ts where it was buried after 63KB of instructions).
        // Phase 2: constructGeminiPrompt is async (encodes the query
        // embedding off-thread for hybrid retrieval). Awaits ~5–20ms warm,
        // a few seconds on the very first call while the model loads.
        const { prompt: contextPrompt, ragDebug } = await constructGeminiPrompt(
            preCallState.gameHistory,
            preCallState.gameWorld,
            preCallState.character,
            text,
            playerRemovedConditions,
            service.modelName,
            preCallState.gameHistory.lastActiveSummary
        );
        
        // Debug Log the injected reminder if active
        // v1.5: Pass entityCount and goalCount to match updated signature.
        // v1.19 (Prompt Diet): Compute triggers for moved content so the
        // reminder selector can inject full protocol text exactly when needed.
        const dreamSeedActive = contextPrompt.includes('[DREAM SEED]');

        const conditions = preCallState.character.conditions ?? [];
        const HEAL_MARKER_RE = /\[\s*HEAL\s*:\s*T\s*\d+\s*\]/i;
        const INJURY_KEYWORDS = /fracture|fractured|wound|bleeding|gash|laceration|sprain|broken|concuss|hemorrhage|severed|torn|dislocat/i;
        const recentInjuryAdded = conditions.some(
            c => INJURY_KEYWORDS.test(c) && !HEAL_MARKER_RE.test(c)
        );

        const languagesKnown = preCallState.character.languagesKnown ?? [];
        // Foreign-speech reminder rotates in every 8 turns when the PC has a
        // language list at all — rare signal, low token cost on off-turns.
        const foreignSpeechPending = languagesKnown.length > 0
            && preCallState.gameHistory.turnCount > 0
            && preCallState.gameHistory.turnCount % 8 === 0;

        const activeReminders = getSectionReminders(
            preCallState.gameHistory.turnCount,
            preCallState.gameWorld.sceneMode,
            preCallState.gameWorld.lastBargainTurn ?? 0,
            preCallState.gameWorld.turnCount ?? 0,
            preCallState.character.conditions.length,
            (preCallState.gameWorld.knownEntities ?? []).length,
            (preCallState.character.goals ?? []).length,
            (preCallState.gameWorld.emergingThreats ?? []).length,
            !!preCallState.gameWorld.passiveAlliesDetected,
            dreamSeedActive,
            foreignSpeechPending,
            recentInjuryAdded,
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

        // v1.19: Prepend SYSTEM_INSTRUCTIONS so the VRE persona, core directives,
        // banned names, and output protocol actually reach config.systemInstruction.
        // Previously only dynamic game state context was being sent.
        const fullSystemPrompt = `${SYSTEM_INSTRUCTIONS}\n\n${contextPrompt}`;

        const response: ModelResponseSchema = await service.sendMessage(
            fullSystemPrompt, 
            [...preCallState.gameHistory.history, userMsg], 
            preCallState.gameHistory.lastActiveSummary,
            preCallState.gameWorld.bannedNameMap ?? {},  // v1.7
            activeReminder  // v1.19: Trailing reminder for recency-biased compliance
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
            playerRemovedConditions,
            text  // v1.17: Pass player input for cooldown detection
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
            npcInteraction: response.npc_interaction,
            worldTick: response.world_tick
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
  }, [getService, setGameHistory, setGameWorld, setCharacter, showToast, setUI, performSegmentSummarization, setPendingLore]);

  return {
    handleSend,
    handleVisualize,
    handleKeyLink,
    handleGenerateScenarios,
    handleUndo,
    handleGenerateCharacter,
    handleGenerateField,
    handleExtractDormantHooks,  // v1.6
    handleHydrateWorldSeed,     // Stream 7
  };
};
