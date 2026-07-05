import { useRef, useCallback } from 'react';
import { ChatMessage, Role, ModelResponseSchema, SummarySegment } from '../types';
import { generateMessageId } from '../idUtils';
import { mapSystemErrorToNarrative } from '../utils';
import { useToast } from '../components/providers/ToastProvider';
import { constructGeminiPrompt } from '../utils/promptUtils';
import { getResponseSchema, SchemaMode } from '../schemas/responseSchema';
import { SYSTEM_INSTRUCTIONS } from '../systemInstructions'; // v1.19: Wire persona into API call
import { GeminiService } from '../geminiService';
import { useGameStore } from '../store';
import { SimulationEngine } from '../utils/simulationEngine';
import { phaseAfterElapsed } from '../utils/engine/timeUtils';
import { getSectionReminders } from '../sectionReminders';

// Extracted Hooks & Utils
import { useGeminiService } from './useGeminiService';
import { useVisualization } from './useVisualization';
import { useScenarioGen } from './useScenarioGen';
import { useCharacterGen } from './useCharacterGen';
import { processCharacterUpdates } from '../utils/characterDelta';
import { deduplicateConditions } from '../utils/characterUtils';
import { significantWords, checkMemoryDuplicate, evictBySalience } from '../utils/contentValidation';
import { generateMemoryId } from '../idUtils';
import { getContextProfile, MEMORY_CAP, DEFAULT_MEMORY_SALIENCE, MAX_REGISTRY_LINES } from '../config/engineConfig';
import { extractDeniedMechanisms } from '../utils/mechanismDenial';
import { detectSanitizationDrift, detectSofteningTells, RESAMPLE_REMINDER } from '../utils/driftDetector';
import { repairSeedPersonalities } from '../utils/worldSeedHydration';
import { shouldNudgeHook, selectAmbientHook, markHookNudged } from '../utils/hookNudge';
import { db } from '../db';

// ---------------------------------------------------------------------------
// v1.24: Threat-pipeline instrumentation. The Origin Gate / cooldown machinery
// has been tuned by feel across v1.17-v1.19; these rolling counters put
// numbers on it. Module-scoped (resets on reload) — this is a tuning
// instrument, not persisted state. Every THREAT_STATS_WINDOW turns a
// [THREAT STATS] line lands in the debug log.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// v1.24: World-pulse trigger. Fire-and-forget after a turn commits, when the
// beat implies downtime (large time skip) or on a fixed cadence. Runs on
// Flash-Lite, writes to the hidden registry, never blocks or fails the live
// turn. Guarded against concurrent runs.
// ---------------------------------------------------------------------------
const WORLD_PULSE_CADENCE_TURNS = 10;
const WORLD_PULSE_DOWNTIME_MINUTES = 240;
let worldPulseInFlight = false;

// v1.24: One-shot personality repair per session — restores canonical seed
// personalities that the pre-v1.24 entity-replace bug wiped from saves.
let personalityRepairDone = false;

const THREAT_STATS_WINDOW = 20;
const threatStats = { seeded: 0, blocked: 0, cooldownTurns: 0, windowStartTurn: -1 };

const recordThreatStats = (
    debugLogs: Array<{ message: string }>,
    nextTurn: number,
    cooldownActive: boolean,
): string | null => {
    if (threatStats.windowStartTurn < 0) threatStats.windowStartTurn = nextTurn;
    for (const log of debugLogs) {
        if (log.message.includes('[ORIGIN GATE ✓')) threatStats.seeded++;
        else if (log.message.includes('[ORIGIN GATE ✗')) threatStats.blocked++;
    }
    if (cooldownActive) threatStats.cooldownTurns++;

    if (nextTurn - threatStats.windowStartTurn + 1 >= THREAT_STATS_WINDOW) {
        const total = threatStats.seeded + threatStats.blocked;
        const blockRate = total > 0 ? Math.round((threatStats.blocked / total) * 100) : 0;
        const line =
            `[THREAT STATS T${threatStats.windowStartTurn}-T${nextTurn}] ` +
            `seeded=${threatStats.seeded} blocked=${threatStats.blocked} (${blockRate}% block rate) ` +
            `cooldownTurns=${threatStats.cooldownTurns}/${THREAT_STATS_WINDOW}. ` +
            `Healthy range: 20-60% blocks. ~0 seeds + high blocks = over-suppression; ` +
            `~0 blocks = the gate isn't being exercised.`;
        threatStats.seeded = 0;
        threatStats.blocked = 0;
        threatStats.cooldownTurns = 0;
        threatStats.windowStartTurn = nextTurn + 1;
        return line;
    }
    return null;
};

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

      // v1.24: Salvage pass — the same summarization call also extracts
      // memory-worthy facts the model narrated but never recorded via
      // new_memories. Without this, those facts survive only in raw history
      // and are silently lost when the window scrolls past maxHistory.
      const { summary, memoryCandidates } = await service.summarizeHistoryWithSalvage(window);

      if (memoryCandidates.length > 0) {
          setGameWorld(prevWorld => {
              let pool = [...prevWorld.memory];
              let added = 0;
              for (const cand of memoryCandidates) {
                  const { isDuplicate } = checkMemoryDuplicate(cand.fact, pool);
                  if (isDuplicate) continue;
                  pool.push({
                      id: generateMemoryId(),
                      fact: cand.fact,
                      timestamp: new Date().toISOString(),
                      salience: cand.salience ?? DEFAULT_MEMORY_SALIENCE,
                      tags: cand.tags && cand.tags.length > 0 ? cand.tags : undefined,
                      turnCreated: currentTurn,
                  });
                  added++;
              }
              if (added === 0) return prevWorld;
              if (pool.length > MEMORY_CAP) {
                  pool = evictBySalience(pool, MEMORY_CAP, currentTurn, []);
              }
              console.log(`[SALVAGE] Recovered ${added} memory fragment(s) from summarization window.`);
              return { ...prevWorld, memory: pool };
          });
      }

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
  }, [setGameHistory, setGameWorld]);

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

        // v1.24: Repair wiped seed personalities once per session, BEFORE the
        // prompt is built, so this turn already renders canonical traits.
        if (!personalityRepairDone) {
            personalityRepairDone = true;
            const repairWorld = useGameStore.getState().gameWorld;
            if (repairWorld.worldSeedId && (repairWorld.knownEntities ?? []).some(e => !e.personality?.trim())) {
                try {
                    const seed = await db.loadWorldSeed(repairWorld.worldSeedId);
                    if (seed) {
                        const { entities, repairedNames } = repairSeedPersonalities(
                            repairWorld.knownEntities ?? [],
                            seed,
                        );
                        if (repairedNames.length > 0) {
                            setGameWorld(prev => ({ ...prev, knownEntities: entities }));
                            setGameHistory(prev => ({
                                ...prev,
                                debugLog: [
                                    ...prev.debugLog,
                                    {
                                        timestamp: new Date().toISOString(),
                                        message: `[PERSONALITY REPAIR] Restored canonical personality on: ${repairedNames.join(', ')}`,
                                        type: 'success',
                                    },
                                ],
                            }));
                        }
                    }
                } catch (e) {
                    console.warn('[PERSONALITY REPAIR] failed:', e);
                }
            }
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

        // v1.20: Hostile NPC detection. Threat-parity behavior text is now
        // injected as a conditional reminder rather than always-on §10
        // language, so peaceful/ordinary scenes don't get primed with
        // threat-aware vocabulary that was collapsing characterization
        // to predatory/cold/calculating/clinical. Counts an entity as
        // hostile if it has HOSTILE or NEMESIS relationship_level AND is
        // present/nearby (status undefined counts as in-scene for legacy
        // entities). Distant/dead/retired hostiles don't count — they
        // can't act on the player this turn.
        const hostileEntityPresent = (preCallState.gameWorld.knownEntities ?? [])
            .some(e =>
                (e.relationship_level === 'HOSTILE' ||
                 e.relationship_level === 'NEMESIS') &&
                (!e.status || e.status === 'present' || e.status === 'nearby')
            );
        const tensionLevel = preCallState.gameWorld.tensionLevel ?? 0;

        // v1.22: Canonical voice lock detection. Fires the
        // CANONICAL_VOICE_LOCK reminder when at least one in-scene entity
        // has a non-empty canonical personality field — the case where
        // archetype substitution (e.g., harsh canonical → "aristocratic
        // charming" default) is the dominant drift risk.
        const canonicalPersonalityNpcPresent = (preCallState.gameWorld.knownEntities ?? [])
            .some(e =>
                typeof e.personality === 'string' &&
                e.personality.trim().length > 0 &&
                (!e.status || e.status === 'present' || e.status === 'nearby')
            );

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
            hostileEntityPresent,
            tensionLevel,
            canonicalPersonalityNpcPresent,  // v1.22
        );
        // v1.25: Ambient hook nudge — on a jittered cadence during calm
        // NARRATIVE beats, surface ONE ignorable hook drawn from established
        // world state (world-pulse opportunities > dormant-hook foreshadow >
        // offscreen NPC traces). Timing, selection, and non-repetition are
        // all code-side; the model only weaves the given line into prose.
        const ambientHook = shouldNudgeHook(
            preCallState.gameHistory.turnCount,
            preCallState.gameWorld,
        )
            ? selectAmbientHook(preCallState.gameWorld)
            : null;

        // Join reminders (+ optional hook nudge) into a single trailing string
        const reminderParts = ambientHook
            ? [...activeReminders, ambientHook.block]
            : activeReminders;
        const activeReminder = reminderParts.length > 0
            ? reminderParts.join('\n\n---\n\n')
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

        // v1.24: CACHE-FRIENDLY PROMPT SPLIT. The static SYSTEM_INSTRUCTIONS
        // travel alone as the system prompt (explicit-cached in geminiClient);
        // the volatile per-turn context travels as `dynamicContext` and lands
        // in the FINAL user message. Previously the two were concatenated,
        // which made the "system instruction" change every turn and killed
        // the implicit-cache prefix for the entire history behind it.
        const fullSystemPrompt = SYSTEM_INSTRUCTIONS;

        // Task 10 (regression harness): expose this turn's full prompt parts
        // on window so problem turns can be captured as goldens from the
        // console: copy(JSON.stringify(window.__vreLastTurn)).
        (window as unknown as Record<string, unknown>).__vreLastTurn = {
            capturedAt: new Date().toISOString(),
            turn: preCallState.gameHistory.turnCount,
            modelName: service.modelName,
            systemInstruction: SYSTEM_INSTRUCTIONS,
            dynamicContext: contextPrompt,
            userText: text,
            sceneMode: preCallState.gameWorld.sceneMode,
        };

        // Review item 3: send a compact, scene-mode-aware response schema.
        // handleSend never runs a MONTAGE beat (that path lives in useMontage),
        // so the schema for this turn follows the current sceneMode and drops
        // the combat / location / montage branches it doesn't need.
        const turnSchema = getResponseSchema(
            (preCallState.gameWorld.sceneMode ?? 'NARRATIVE') as SchemaMode
        );

        // Review item 4: only spend a second generation on sanitization drift
        // when the beat is actually mature — a softening signal on a mundane
        // shopping scene isn't worth a full re-roll.
        const lastNarrative = [...preCallState.gameHistory.history]
            .reverse()
            .find(m => m.role === Role.MODEL)?.text ?? '';
        const MATURE_CONTENT_RE = /\b(blood|bleed|wound|gore|kill|stab|slash|sever|gut|disembowel|torture|rape|sex|fuck|cock|cunt|breast|nipple|thrust|cum|orgasm|naked|nude|arous)\w*/i;
        const matureContextActive =
            preCallState.gameWorld.sceneMode === 'COMBAT' ||
            (preCallState.gameWorld.tensionLevel ?? 0) >= 40 ||
            MATURE_CONTENT_RE.test(text) ||
            MATURE_CONTENT_RE.test(lastNarrative);

        let response: ModelResponseSchema = await service.sendMessage(
            fullSystemPrompt,
            [...preCallState.gameHistory.history, userMsg],
            preCallState.gameHistory.lastActiveSummary,
            preCallState.gameWorld.bannedNameMap ?? {},  // v1.7
            activeReminder,  // v1.19: Trailing reminder for recency-biased compliance
            turnSchema,  // Review item 3
            contextPrompt  // v1.24: dynamic context → final user message (cache-friendly)
        );

        if (latestRequestId.current !== requestId) {
            console.log("Discarding stale response", requestId);
            return;
        }

        // v1.21: Sanitization-drift resample. If the model's thought_process
        // contains confession-language for sanitization (fade-to-black,
        // "tasteful", "sanitize", "imply rather than describe", "soften",
        // etc.), re-roll the turn once with the RESAMPLE_REMINDER appended
        // to the trailing reminder. Single retry only — repeated drift
        // indicates a deeper prompt issue, not a one-off attractor lapse.
        // The detector reads ONLY thought_process so narrative prose using
        // words like "softly" isn't a false positive.
        // v1.24: Two independent softening detectors, merged into one report:
        //   (a) confession drift — the model ADMITS sanitizing in thought_process
        //   (b) output tells — silent fade-to-black measured from the output
        //       itself (time-skip, scene-break, length collapse in a mature
        //       SOCIAL beat). Catches what (a) misses.
        const recentNarrativeLengths = preCallState.gameHistory.history
            .filter(m => m.role === Role.MODEL)
            .slice(-6)
            .map(m => m.text.length);
        const confessionDrift = detectSanitizationDrift(response.thought_process);
        const outputTells = detectSofteningTells({
            narrative: response.narrative,
            timePassedMinutes: response.time_passed_minutes,
            sceneMode: response.scene_mode ?? preCallState.gameWorld.sceneMode,
            matureContextActive,
            recentNarrativeLengths,
        });
        const drift = {
            drifted: confessionDrift.drifted || outputTells.drifted,
            matches: [...confessionDrift.matches, ...outputTells.matches],
        };
        if (drift.drifted && !matureContextActive) {
            // Drift signal in a non-mature beat — log it but don't pay for a
            // re-roll. (Review item 4: gate the resample by context.)
            console.log('[VRE] Sanitization drift detected (non-mature beat, not resampling):', drift.matches);
            setGameHistory(prev => ({
                ...prev,
                debugLog: [
                    ...prev.debugLog,
                    {
                        timestamp: new Date().toISOString(),
                        message: `[DRIFT] Signal in non-mature beat — skipping resample. Matches: ${drift.matches.join(', ')}`,
                        type: 'info'
                    }
                ]
            }));
        } else if (drift.drifted) {
            console.log('[VRE] Sanitization drift detected:', drift.matches);
            setGameHistory(prev => ({
                ...prev,
                debugLog: [
                    ...prev.debugLog,
                    {
                        timestamp: new Date().toISOString(),
                        message: `[DRIFT] Sanitization signals in thought_process — resampling once. Matches: ${drift.matches.join(', ')}`,
                        type: 'info'
                    }
                ]
            }));

            const reinforcedReminder = [activeReminder, RESAMPLE_REMINDER]
                .filter((s): s is string => Boolean(s))
                .join('\n\n---\n\n');

            response = await service.sendMessage(
                fullSystemPrompt,
                [...preCallState.gameHistory.history, userMsg],
                preCallState.gameHistory.lastActiveSummary,
                preCallState.gameWorld.bannedNameMap ?? {},
                reinforcedReminder,
                turnSchema,  // Review item 3
                contextPrompt  // v1.24: dynamic context → final user message
            );

            if (latestRequestId.current !== requestId) {
                console.log("Discarding stale resample response", requestId);
                return;
            }

            // Note whether the resample cleared the drift. If it didn't,
            // we still accept the response — repeated retries would just
            // burn tokens.
            const driftAfter = detectSanitizationDrift(response.thought_process);
            setGameHistory(prev => ({
                ...prev,
                debugLog: [
                    ...prev.debugLog,
                    {
                        timestamp: new Date().toISOString(),
                        message: driftAfter.drifted
                            ? `[DRIFT] Resample still showing signals: ${driftAfter.matches.join(', ')} — accepting anyway`
                            : `[DRIFT] Resample cleared sanitization signals`,
                        type: driftAfter.drifted ? 'warning' : 'success'
                    }
                ]
            }));
        }

        // Review item 4: deterministic clock correction (replaces up to 2 full
        // regenerations). The authoritative phase is derived from the clock —
        // start time plus the minutes this beat advanced. If the model's
        // declared phase disagrees, the prose is almost always fine and only the
        // enum is wrong, so we simply overwrite it instead of re-rolling an
        // entire expensive generation. No extra API calls.
        const startTime = preCallState.gameWorld.time;
        const authoritativePhase = phaseAfterElapsed(
            startTime?.hour ?? 9,
            startTime?.minute ?? 0,
            response.time_passed_minutes ?? 0,
        );
        if (response.scene_time_phase && response.scene_time_phase !== authoritativePhase) {
            const declared = response.scene_time_phase;
            response.scene_time_phase = authoritativePhase;
            setGameHistory(prev => ({
                ...prev,
                debugLog: [
                    ...prev.debugLog,
                    {
                        timestamp: new Date().toISOString(),
                        message: `[CLOCK_DRIFT_CORRECTED] AI declared phase=${declared}; overwrote with clock-derived ${authoritativePhase}. No re-roll.`,
                        type: 'info'
                    }
                ]
            }));
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

        // v1.25: Ambient hook bookkeeping — reset the cadence and strike the
        // consumed [OPPORTUNITY] line from the registry so it never repeats.
        if (ambientHook) {
            markHookNudged(nextTurn);
            if (ambientHook.consumeRegistryLine && worldUpdate.hiddenRegistry) {
                worldUpdate.hiddenRegistry = worldUpdate.hiddenRegistry
                    .split('\n')
                    .filter(l => l.trim() !== ambientHook.consumeRegistryLine!.trim())
                    .join('\n');
            }
            debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[AMBIENT HOOK] Surfaced (${ambientHook.summary})`,
                type: 'info',
            });
        }

        // v1.24: Threat-pipeline instrumentation — rolling window counters.
        const cooldownActive = (worldUpdate.threatCooldownUntilTurn ?? 0) > nextTurn;
        const threatStatsLine = recordThreatStats(debugLogs, nextTurn, cooldownActive);
        if (threatStatsLine) {
            debugLogs.push({
                timestamp: new Date().toISOString(),
                message: threatStatsLine,
                type: 'info',
            });
        }

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
                // Review item 1: real token accounting from Gemini usageMetadata.
                { timestamp: new Date().toISOString(), message: response.usageMetadata
                    ? `[TOKENS] prompt=${response.usageMetadata.promptTokenCount} (cached ${response.usageMetadata.cachedContentTokenCount}) · output=${response.usageMetadata.candidatesTokenCount} · thoughts=${response.usageMetadata.thoughtsTokenCount} · total=${response.usageMetadata.totalTokenCount}`
                    : `[TOKENS] usageMetadata unavailable for this turn`, type: 'info' },
                { timestamp: new Date().toISOString(), message: `[RAG] Lore: ${ragDebug.filteredLore}/${ragDebug.totalLore} | Entities: ${ragDebug.filteredEntities}/${ragDebug.totalEntities} | Tokens: [${ragDebug.queryTokens.slice(0, 10).join(', ')}]`, type: 'info' },
                ...debugLogs
            ]
        }));

        // v1.24: Background world pulse — the world moves while the player
        // isn't looking. Downtime beats (sleep, travel, long skips) and every
        // Nth turn advance offscreen NPC/faction agendas via a cheap
        // non-blocking call; results land in the hidden registry where the
        // next turn's narrator surfaces them organically.
        const shouldPulse =
            (response.time_passed_minutes ?? 0) >= WORLD_PULSE_DOWNTIME_MINUTES ||
            (nextTurn > 0 && nextTurn % WORLD_PULSE_CADENCE_TURNS === 0);
        if (shouldPulse && !worldPulseInFlight) {
            worldPulseInFlight = true;
            (async () => {
                try {
                    const pulseWorld = useGameStore.getState().gameWorld;
                    const result = await service.worldPulse(pulseWorld, nextTurn);
                    if (!result) return;
                    const lines = [
                        ...result.developments.map(d => `[WORLD-PULSE T${nextTurn}] ${d}`),
                        ...result.opportunities.map(o => `[OPPORTUNITY T${nextTurn}] ${o}`),
                    ];
                    if (lines.length === 0) return;
                    setGameWorld(prev => {
                        const registry = (prev.hiddenRegistry ?? '').split('\n').filter(Boolean);
                        const merged = [...registry, ...lines].slice(-MAX_REGISTRY_LINES);
                        return {
                            ...prev,
                            hiddenRegistry: merged.join('\n'),
                            lastWorldTickTurn: nextTurn,
                        };
                    });
                    setGameHistory(prev => ({
                        ...prev,
                        debugLog: [
                            ...prev.debugLog,
                            {
                                timestamp: new Date().toISOString(),
                                message: `[WORLD PULSE T${nextTurn}] ${result.developments.length} development(s), ${result.opportunities.length} opportunity(ies) → hidden registry.`,
                                type: 'info',
                            },
                        ],
                    }));
                } catch (e) {
                    console.warn('[WORLD PULSE] background run failed:', e);
                } finally {
                    worldPulseInFlight = false;
                }
            })();
        }

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
