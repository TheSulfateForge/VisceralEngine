import { useRef, useCallback } from 'react';
import { ChatMessage, Role, ModelResponseSchema, SummarySegment } from '../types';
import { generateMessageId, generateUUID } from '../idUtils';
import { parseOocInput, isNarrativeMessage } from '../utils/engine/oocDetection';
import {
    ingestPlayerAssertions,
    ingestOocDirective,
    suppressedReminderKeys,      // v1.37
    buildNpcPositionsBlock,      // v1.37
} from '../utils/engine/sceneContinuity';
import { mapSystemErrorToNarrative } from '../utils';
import { useToast } from '../components/providers/ToastProvider';
import { constructGeminiPrompt, buildOocEntityRecords } from '../utils/promptUtils';
import { findAliasMatchedEntities } from '../utils/ragEngine';
import { getResponseSchema, SchemaMode } from '../schemas/responseSchema';
import { SYSTEM_INSTRUCTIONS } from '../systemInstructions'; // v1.19: Wire persona into API call
import { GeminiService } from '../geminiService';
import { useGameStore } from '../store';
import { SimulationEngine } from '../utils/simulationEngine';
import { phaseAfterElapsed } from '../utils/engine/timeUtils';
import {
    detectPlayerFraming,
    containsMatureContent,
    physicalContactLevel,
    levelIndex,
} from '../utils/engine/playerFraming';
import { selectSectionReminders, makeReminderContext, type ReminderKey } from '../sectionReminders';
import { narrativeContainsViolence } from '../utils/engine/npcCoherence';
import {
    privateTermsForCharacter,
    detectPrivateKnowledgeLeak,
} from '../utils/engine/privateKnowledge';
import { checkVoiceLock, isFocalCharacter } from '../utils/engine/voiceLockCheck';
import { classifyRecordQuery, answerRecordQuery } from '../utils/engine/recordQuery';
import { detectRecurringRhetoric } from '../utils/engine/npcRhetoric';

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
import {
    detectSanitizationDrift,
    detectSofteningTells,
    detectSelfRepetition,
    detectInventedTrigger,       // v1.37
    buildRepetitionReminder,
    REPETITION_LOOKBACK,
    RESAMPLE_REMINDER,
} from '../utils/driftDetector';
import { repairSeedPersonalities } from '../utils/worldSeedHydration';
import { shouldNudgeHook, selectAmbientHook, markHookNudged } from '../utils/hookNudge';
import { getTuning } from '../config/tuning';
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
const WORLD_PULSE_DOWNTIME_MINUTES = 240;
let worldPulseInFlight = false;

// v1.24: One-shot personality repair per session — restores canonical seed
// personalities that the pre-v1.24 entity-replace bug wiped from saves.
let personalityRepairDone = false;

// v1.30: Static-beat tracking for the thinking floor.
//
// A scene that has run several turns in one room at low tension produces a
// prompt whose volatile blocks barely move — in the reviewed save the delta
// between two consecutive turns was ~180 chars of new player text inside
// ~110k chars of context. That is precisely the condition under which the
// model copies its own previous turn, and at thinkingLevel 'low' (which the
// v1.26 scene-mode budget assigns to every calm beat) it spends ~0 thought
// tokens, so nothing in the loop manufactures divergence.
//
// Rather than pay 'medium' on every calm beat, pay it only once a scene has
// gone static — or immediately after a turn that actually tripped the
// repetition guard.
const STATIC_BEAT_THINKING_FLOOR = 3;

// v1.41.1: mask-mode resample cooldown.
//
// The unguarded version fired 17 times in a 29-turn session — 13 of them for
// ONE secondary character standing quietly in a scene about someone else — and
// each firing is a full extra model call at escalated thinking. Median turn
// latency went 24s -> 34s, essentially all of it here.
//
// Two guards, both needed. The focal test (voiceLockCheck.isFocalCharacter)
// stops a bystander triggering it at all; this cooldown stops even a genuinely
// focal character triggering it every turn, because a model that renders one
// character as their mask is not going to be talked out of it by a third
// re-roll in four turns — at that point the armed reminder is the right tool
// and the re-roll is just cost.
//
// Module-scoped and non-persisted, like `staticBeatStreak` and `threatStats`:
// this is a rate limiter, not campaign state, and resetting it on reload is
// harmless.
const MASK_RESAMPLE_COOLDOWN_TURNS = 5;
const maskResampleLastTurn = new Map<string, number>();
let staticBeatStreak = 0;
let staticBeatLocation = '';
let lastTurnRepeated = false;

/** Bump a thinking level one notch. Used for resamples: re-rolling at the same
 *  budget that produced the bad turn tends to reproduce the bad turn. */
const escalateThinking = (level: string): string =>
    level === 'high' ? 'high' : level === 'low' ? 'medium' : 'high';

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
      // v1.31: OOC exchanges are excluded; a summary is a record of the
      // fiction, and an engine answer about narration style is not part of it.
      const window = history.filter(isNarrativeMessage).slice(-intervalSize);
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

  /**
   * v1.31: OUT-OF-CHARACTER TURN.
   *
   * Not a turn. No clock advance, no world tick, no threat pipeline, no
   * narrative, no turnCount increment — so it never runs the simulation
   * pipeline at all. It does two things: answer the player directly, and
   * promote any fact they established into player canon.
   *
   * This exists because the alternative was what the reviewed save shows: the
   * player typed an OOC complaint about repetition INTO the fiction, and it
   * burned five minutes of game time, rolled a world tick, and got RAG-indexed
   * as [ooc, repeated, near, verbatim, ...] — while the world re-rendered from
   * a prompt near-identical to the previous turn's.
   */
  const handleOocSend = useCallback(async (body: string, rawText: string) => {
      const requestId = Date.now().toString();
      latestRequestId.current = requestId;

      const userMsg: ChatMessage = {
          id: generateMessageId(),
          role: Role.USER,
          text: rawText,
          timestamp: new Date().toISOString(),
          ooc: true,
      };

      setGameHistory(prev => ({
          ...prev,
          history: [...prev.history, userMsg],
          isThinking: true,
          debugLog: [
              ...prev.debugLog,
              { timestamp: new Date().toISOString(), message: `[OOC] Out-of-character input — no clock, no world tick, no threat roll.`, type: 'info' },
          ],
      }));

      try {
          const service = await getService();
          if (!service) {
              setGameHistory(gs => ({ ...gs, isThinking: false }));
              return;
          }

          const state = useGameStore.getState();
          const situationLine = [
              `${state.character.name} is at ${state.gameWorld.location || 'an unknown place'}.`,
              `Scene: ${state.gameWorld.sceneMode ?? 'NARRATIVE'}, tension ${state.gameWorld.tensionLevel ?? 0}/100.`,
              `Clock: ${state.gameWorld.time?.display ?? 'unknown'}.`,
          ].join(' ');

          // v1.38: resolve the NPCs the player named and attach their COMPLETE
          // records. `findAliasMatchedEntities` matches on name tokens and
          // unique roles; it is given the OOC body alone (not the history),
          // because an OOC question is self-contained and pulling in the
          // narrative tail would re-attach exactly the material the channel was
          // previously confabulating from.
          //
          // Status is not filtered. Every NPC in the reviewed failure was
          // 'missing' or 'distant' — a lookup is about the record, not the room.
          const oocEntities = findAliasMatchedEntities(
              body,
              [],
              state.gameWorld.knownEntities ?? [],
          );
          const oocRecords = buildOocEntityRecords(oocEntities);

          // v1.41: DETERMINISTIC LOOKUP.
          //
          // When the question is unambiguously "what does the record say", the
          // record IS the answer and there is nothing for a model to add. This
          // path does not call the model at all, so the answer cannot drift,
          // soften, summarise into three tidy items, or invent a section that
          // does not exist. See utils/engine/recordQuery for why the gate is
          // narrow: a correction or a complaint that happens to name a profile
          // must still reach the model.
          const recordQuery = classifyRecordQuery(body);
          if (recordQuery.isLookup && oocEntities.length > 0) {
              const answer = answerRecordQuery(oocEntities, recordQuery.section);
              const replyMsg: ChatMessage = {
                  id: generateMessageId(),
                  role: Role.MODEL,
                  text: answer,
                  timestamp: new Date().toISOString(),
                  ooc: true,
              };
              setGameHistory(prev => ({
                  ...prev,
                  history: [...prev.history, replyMsg],
                  isThinking: false,
                  debugLog: [
                      ...prev.debugLog,
                      {
                          timestamp: new Date().toISOString(),
                          message: `[OOC LOOKUP] Answered from world state with NO model call `
                              + `(${recordQuery.reason}) for: ${oocEntities.map(e => e.name).join(', ')}. `
                              + `The reply is the stored record verbatim.`,
                          type: 'success' as const,
                      },
                      {
                          timestamp: new Date().toISOString(),
                          message: `[OOC] Complete. Turn ${state.gameHistory.turnCount ?? 0} unchanged.`,
                          type: 'info' as const,
                      },
                  ],
              }));
              return;
          }

          const ooc = await service.sendOocMessage(
              body,
              state.gameHistory.history.filter(m => !m.ooc),
              situationLine,
              oocRecords,
          );

          if (latestRequestId.current !== requestId) return;

          // Player canon. The turn number is the CURRENT turn — an OOC exchange
          // does not advance it, so the assertion is stamped to the turn it
          // actually clarifies.
          const turn = state.gameHistory.turnCount ?? 0;
          const { canon, accepted, rejected } = ingestPlayerAssertions(
              state.gameWorld.playerCanon,
              ooc.assertions,
              turn,
              true,
              () => generateUUID(),
          );

          // v1.35: the directive is a STANDING instruction, so it has to reach
          // world state and the prompt. Before this it went to the debug log
          // and nowhere else — the channel accepted the player's complaint,
          // replied promising a change, and then had no way to deliver one.
          const { directives, added: directiveAdded } = ingestOocDirective(
              state.gameWorld.oocDirectives,
              ooc.directive,
              turn,
              () => generateUUID(),
          );

          if (accepted.length > 0 || rejected.length > 0 || directiveAdded) {
              setGameWorld(prev => ({
                  ...prev,
                  ...(accepted.length > 0 || rejected.length > 0 ? { playerCanon: canon } : {}),
                  ...(directiveAdded ? { oocDirectives: directives } : {}),
              }));
          }

          const replyMsg: ChatMessage = {
              id: generateMessageId(),
              role: Role.MODEL,
              text: ooc.reply,
              timestamp: new Date().toISOString(),
              ooc: true,
          };

          setGameHistory(prev => ({
              ...prev,
              history: [...prev.history, replyMsg],
              isThinking: false,
              debugLog: [
                  ...prev.debugLog,
                  ...accepted.map(f => ({
                      timestamp: new Date().toISOString(),
                      message: `[PLAYER CANON] Recorded via OOC: "${f}"`,
                      type: 'success' as const,
                  })),
                  ...rejected.map(f => ({
                      timestamp: new Date().toISOString(),
                      message: `[PLAYER CANON] REJECTED (outside the player's own character): "${f}"`,
                      type: 'warning' as const,
                  })),
                  ...(ooc.directive ? [{
                      timestamp: new Date().toISOString(),
                      message: directiveAdded
                          ? `[OOC DIRECTIVE — v1.35] Standing from turn ${turn}, now binding on every turn: ${ooc.directive}`
                          : `[OOC DIRECTIVE] Already standing (duplicate), not re-added: ${ooc.directive}`,
                      type: 'info' as const,
                  }] : []),
                  // v1.38: name the records that were attached. When a lookup
                  // comes back wrong, the first question is whether the model
                  // had the record at all — that must be answerable from the log.
                  {
                      timestamp: new Date().toISOString(),
                      message: oocEntities.length > 0
                          ? `[OOC LOOKUP] Attached complete records for: ${oocEntities.map(e => e.name).join(', ')}. `
                            + `Not answered deterministically (${recordQuery.reason}).`
                          : `[OOC LOOKUP] No NPC named in the question — no records attached; the reply is not a record lookup.`,
                      type: 'info' as const,
                  },
                  { timestamp: new Date().toISOString(), message: `[OOC] Complete. Turn ${turn} unchanged.`, type: 'info' as const },
              ],
          }));
      } catch (e: unknown) {
          console.error('[VRE] OOC turn failed:', e);
          setGameHistory(prev => ({ ...prev, isThinking: false }));
          showToast('OOC request failed.', 'error');
      }
  }, [getService, setGameHistory, setGameWorld, showToast]);

  // Main Turn Orchestrator
  const handleSend = useCallback(async (text: string) => {
    if (!text.trim()) return;

    // v1.31: OOC inputs branch out before ANY turn machinery runs.
    const ooc = parseOocInput(text);
    if (ooc.isOoc) {
        await handleOocSend(ooc.body, text);
        return;
    }

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
        // v1.31: count NARRATIVE messages only. Counting OOC exchanges here
        // would drift the summarisation cadence and, worse, let meta-chatter
        // ("stop repeating yourself") land in campaign history as story.
        const narrativeMessageCount = historyForSummarization.history
            .filter(isNarrativeMessage).length;
        if (
            narrativeMessageCount > 0 &&
            narrativeMessageCount % contextProfile.summarizationInterval === 0
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
        const { prompt: contextPrompt, staticContext, oocDirectivesBlock, profileLine, blockSizes, ragDebug } = await constructGeminiPrompt(
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
        // v1.28: capture WHICH entities are hostile, not merely that one exists.
        // The reminder is injected into the prompt naming them, so its rules
        // cannot be misapplied to everyone else in the room. Previously a single
        // hostile standing anywhere in the scene switched on threat-parity
        // behaviour for the whole cast — including, in the reviewed save, the
        // player's father, mother and twin sister, because an antagonist
        // happened to be in the same building.
        const inScene = (e: { status?: string }) =>
            !e.status || e.status === 'present' || e.status === 'nearby';

        const hostileEntityNames = (preCallState.gameWorld.knownEntities ?? [])
            .filter(e =>
                (e.relationship_level === 'HOSTILE' || e.relationship_level === 'NEMESIS') &&
                inScene(e)
            )
            .map(e => e.name);
        const hostileEntityPresent = hostileEntityNames.length > 0;

        // v1.28: an ally only strains under load the player can see — a real
        // grievance on the ledger, not the mere presence of an enemy elsewhere
        // in the scene. This gates the ally-betrayal guidance that used to ride
        // along inside the hostile-NPC reminder.
        const STRAIN_MARKERS = /\b(betray|lied|deceiv|abandon|refus|resent|debt|owes|owed|jealous|blame|threaten|argu|broke|broken promise|failed)\w*/i;
        const strainedAllyNames = (preCallState.gameWorld.knownEntities ?? [])
            .filter(e =>
                ['WARM', 'ALLIED', 'DEVOTED'].includes(e.relationship_level) &&
                inScene(e) &&
                (e.ledger ?? []).some(entry => STRAIN_MARKERS.test(entry))
            )
            .map(e => e.name);

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

        // v1.29: signals the engine previously had no representation of.
        // v1.31: `&& isNarrativeMessage` — an OOC engine reply is not the
        // last thing that happened in the fiction.
        const recentNarratives = preCallState.gameHistory.history
            .filter(m => m.role === Role.MODEL && isNarrativeMessage(m))
            .map(m => m.text);
        const lastNarrative = recentNarratives[recentNarratives.length - 1] ?? '';

        // What the player did with THIS turn: corrected an NPC's reading of
        // them, refused a physical advance, or stepped back from a push.
        const framing = detectPlayerFraming(text);

        // Where the physical scene currently sits, so the gate can name the
        // rung to the model instead of gesturing at it.
        const contactLevel = physicalContactLevel(lastNarrative);

        // v1.37: how long the physical scene has sat at this rung.
        //
        // v1.29's gate held the scene at whatever rung it had reached until the
        // player physically reciprocated, and read the rung off the model's OWN
        // last narrative — so once an NPC touched the player the gate re-armed
        // from its own output, every turn, and a PC written as passive could
        // never clear it. The Carissa garden scene sat at `sustained` for twenty
        // consecutive turns that way. The stall is now what the engine watches,
        // and the hold instruction is gone.
        let contactStalledTurns = 0;
        if (contactLevel !== 'none') {
            for (let i = recentNarratives.length - 1; i >= 0; i--) {
                if (physicalContactLevel(recentNarratives[i]) !== contactLevel) break;
                contactStalledTurns++;
            }
        }

        // v1.37: reminders countermanded by a standing player directive. The
        // player's out-of-character instruction outranks the engine's own
        // standing guidance; classification happened once, at ingest.
        const suppressedReminders = suppressedReminderKeys(
            preCallState.gameWorld.oocDirectives,
        ) as ReminderKey[];

        // v1.37: NPC positions already on the record in a running dispute.
        const npcPositionsBlock = buildNpcPositionsBlock(
            preCallState.gameWorld.npcPositions,
        );

        // v1.33 (M11): the visceral rendering register is triggered by what the
        // previous narrative actually contains, not by the scene mode. SOCIAL
        // is the ordinary conversation mode — the old `mode === 'SOCIAL'`
        // trigger asserted "this scene contains intimacy, violence, fear,
        // hunger, or bodily extremity" over every quiet conversation in the
        // game and then named Blood Meridian as the register to write it in.
        const intimacyInScene =
            levelIndex(contactLevel) >= levelIndex('sustained');
        const violenceInScene = narrativeContainsViolence(lastNarrative);

        // v1.35: did the model argue in a figure last turn? Self-inspection of
        // its own previous output, the same shape the v1.30 repetition guard
        // uses — except this warns on the NEXT prompt rather than resampling,
        // because "you think" and "or?" occur constantly in good dialogue and a
        // false positive must never cost a regenerate.
        //
        // v1.37: the window, not just the last turn. v1.35's "two tics in ONE
        // turn" threshold watched `motive-attribution` recur on six of eight
        // consecutive turns in the 2026-09-07 Maribel save and armed once. The
        // same tic four turns running is the most legible pattern there is.
        const rhetoric = detectRecurringRhetoric(
            recentNarratives,
            (preCallState.gameWorld.knownEntities ?? []).map(e => e.name).filter(Boolean),
        );
        // v1.37: the model invented a trigger status on the previous turn.
        // Same one-beat-late shape as modelFlaggedCorrection — the finding
        // arrives with the response, so it corrects the turn after.
        const voiceLockFlagged =
            preCallState.gameWorld.voiceLockFlaggedTurn !== undefined &&
            preCallState.gameWorld.voiceLockFlaggedTurn >= preCallState.gameHistory.turnCount - 1;

        // v1.35: the model reported a correction on the previous turn.
        const modelFlaggedCorrection =
            preCallState.gameWorld.correctionFlaggedTurn !== undefined &&
            preCallState.gameWorld.correctionFlaggedTurn >= preCallState.gameHistory.turnCount - 1;

        const rhetoricDebugLine = rhetoric.tics.length > 0
            ? `[RHETORIC] ${rhetoric.armed ? 'ARMED' : 'noted (below threshold)'} — ${rhetoric.tics.join(', ')}` +
              (rhetoric.samples.length > 0 ? ` | ${rhetoric.samples.join(' | ')}` : '')
            : null;

        const reminderContext = makeReminderContext({
            turnCount: preCallState.gameHistory.turnCount,
            worldTurn: preCallState.gameWorld.turnCount ?? 0,
            mode: preCallState.gameWorld.sceneMode,
            tensionLevel,
            conditionsCount: preCallState.character.conditions.length,
            entityCount: (preCallState.gameWorld.knownEntities ?? []).length,
            goalCount: (preCallState.character.goals ?? []).length,
            // v1.28: 'unvalidated' anchors are engine bookkeeping. They must not
            // count toward the threat-aware reminder triggers, or every rejected
            // threat would keep priming the model with threat vocabulary.
            liveThreatCount: (preCallState.gameWorld.emergingThreats ?? [])
                .filter(t => t.status !== 'unvalidated').length,
            lastBargainTurn: preCallState.gameWorld.lastBargainTurn ?? 0,
            passiveAlliesDetected: !!preCallState.gameWorld.passiveAlliesDetected,
            dreamSeedActive,
            foreignSpeechPending,
            recentInjuryAdded,
            hostileEntityNames,              // v1.28
            strainedAllyNames,               // v1.28
            canonicalPersonalityNpcPresent,  // v1.22
            // v1.35: OR the regex signal with the model's own flag from the
            // PREVIOUS turn. The regex fires on the turn the correction is
            // made (fast, imperfect recall); the flag fires one turn later
            // (perfect recall, one beat late). A correction caught by both
            // arms the protocol twice, which is correct — v1.29's failure was
            // the NPC conceding and then re-asserting on the next beat.
            playerCorrected: framing.corrected || modelFlaggedCorrection,
            correctionMarkers: framing.correctionMarkers.length > 0
                ? framing.correctionMarkers
                : (modelFlaggedCorrection
                    ? ['(flagged by the engine on the previous turn — the player pushed back on how he was being read)']
                    : []),
            // v1.37: the physical gate arms on the player saying NO, not on the
            // player failing to say yes. `reciprocated` is still detected — it
            // matters to the drift suppression below — it just no longer gates
            // what NPCs are allowed to do.
            playerRefused: framing.deflected,
            refusalMarkers: framing.deflectionMarkers,
            contactLevel,                                 // v1.29
            contactStalledTurns,                          // v1.37
            npcPositionsBlock,                            // v1.37
            suppressedReminders,                          // v1.37
            inventedTriggerNames: voiceLockFlagged
                ? (preCallState.gameWorld.voiceLockFlaggedNames ?? [])
                : [],
            inventedTriggerDirection: voiceLockFlagged
                ? (preCallState.gameWorld.voiceLockFlaggedDirection ?? '')
                : '',
            restatementIssues: voiceLockFlagged
                ? (preCallState.gameWorld.voiceLockRestatementIssues ?? [])
                : [],
            // v1.42: the scene-exhaustion signal. `staticBeatStreak` already
            // counts consecutive turns in one location — v1.30 uses it to buy
            // thinking budget, which helps the model write a DIFFERENT sentence
            // but does nothing about a scene with no material left. Same
            // counter, and now it also asks for a different scene.
            //
            // Computed rather than read: `staticBeatStreak` is incremented
            // later in this turn, so reading it here would be one behind. This
            // is the same arithmetic, evaluated without mutating.
            sceneStaticTurns: (preCallState.gameWorld.location ?? '') === staticBeatLocation
                ? staticBeatStreak + 1
                : 0,
            repeatedLastTurn: lastTurnRepeated,
            intimacyInScene,                              // v1.33
            violenceInScene,                              // v1.33
            // v1.35: only an ARMED report reaches the reminder. A single marker
            // is a sentence; two is a pattern.
            rhetoricTics: rhetoric.armed ? rhetoric.tics : [],
            rhetoricSamples: rhetoric.armed ? rhetoric.samples : [],
            reminderLastShown: preCallState.gameWorld.reminderLastShown ?? {}, // v1.33
        });

        const selection = selectSectionReminders(reminderContext);
        const activeReminders = selection.reminders;

        // v1.33 (M6): stamp the scheduler so least-recently-shown ordering has
        // something to order by. Without this every key stays maximally stale
        // and the rotation degenerates to registry order.
        if (selection.shown.length > 0) {
            const stamped: Record<string, number> = {
                ...(preCallState.gameWorld.reminderLastShown ?? {}),
            };
            for (const key of selection.shown) {
                stamped[key] = preCallState.gameHistory.turnCount;
            }
            setGameWorld(prev => ({ ...prev, reminderLastShown: stamped }));
        }
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

        // Join reminders (+ optional hook nudge) into a single trailing string.
        //
        // v1.37: THE PLAYER GOES LAST. Through v1.36 [STANDING DIRECTIVES] sat
        // mid-prompt inside the dynamic context while the reminders were
        // appended to the very end of the user message under "[SYSTEM REFRESH —
        // MANDATORY COMPLIANCE]". On a recency-biased model that placed the
        // engine's standing rules structurally above the player's standing
        // instructions, and the 2026-09-07 Carissa save is what that produced:
        // the OOC channel captured "transition toward intimate physical
        // escalation", injected it correctly — and the last thing the model read
        // that turn was PHYSICAL_RECIPROCATION's "Hold here or withdraw". The
        // engine spent the turn countermanding the player and won on position.
        //
        // The directives block now comes after everything, and says so.
        const reminderParts = ambientHook
            ? [...activeReminders, ambientHook.block]
            : [...activeReminders];

        /**
         * Join a trailer, always ending with the standing directives.
         *
         * The resample paths below append their own reminder (RESAMPLE_REMINDER,
         * the repetition reminder) to this trailer, so the concatenation has to
         * run through here rather than tacking on after `activeReminder` — the
         * whole point of v1.37 is that the player's block is last, and a resample
         * is exactly the turn where it matters most.
         */
        const buildTrailer = (...extra: (string | null | undefined)[]): string | null => {
            const parts = [...reminderParts, ...extra, oocDirectivesBlock]
                .filter((s): s is string => Boolean(s && s.trim()));
            return parts.length > 0 ? parts.join('\n\n---\n\n') : null;
        };
        const activeReminder = buildTrailer();
        let requestLogs = [...preCallState.gameHistory.debugLog];

        if (rhetoricDebugLine) {
            requestLogs.push({
                timestamp: new Date().toISOString(),
                message: rhetoricDebugLine,
                type: rhetoric.armed ? 'warning' : 'info',
            });
        }

        // v1.33 (M6): log EVERY key injected, not just the first line of the
        // joined blob. The old single-line log is why the starvation went
        // unnoticed for so long — a second reminder was invisible in the debug
        // panel, so "which reminders is this game actually getting?" could not
        // be answered without replaying the selector by hand.
        if (selection.shown.length > 0) {
            requestLogs.push({
                timestamp: new Date().toISOString(),
                message: `[SYSTEM REFRESH] Injected: ${selection.shown.join(' + ')}`,
                type: 'info'
            });
        }
        // v1.43: where the prompt-build time went. Logged here, next to
        // [SYSTEM REFRESH], so a slow turn and its cause sit together in the
        // panel — the gap between "Sending Request" and "[THINKING FLOOR]" is
        // exactly this call, and until now nothing said what filled it.
        requestLogs.push({
            timestamp: new Date().toISOString(),
            message: profileLine,
            type: 'info'
        });

        // v1.37: make the precedence order observable. From v1.33 the log could
        // answer "which reminders is this game getting?"; it could not answer
        // "and did the player's own instructions come after them?" — which is
        // how a directive could be injected correctly and countermanded on the
        // same turn, for twenty turns, with nothing in the log saying so.
        if (oocDirectivesBlock) {
            const count = (preCallState.gameWorld.oocDirectives ?? []).length;
            requestLogs.push({
                timestamp: new Date().toISOString(),
                message: `[STANDING DIRECTIVES] ${count} directive(s) appended AFTER the reminders (final position).`
                    + (suppressedReminders.length > 0
                        ? ` Suppressing: ${suppressedReminders.join(', ')}.`
                        : ''),
                type: 'info'
            });
        }
        for (const line of selection.debug) {
            requestLogs.push({ timestamp: new Date().toISOString(), message: line, type: 'info' });
        }
        if (requestLogs.length !== preCallState.gameHistory.debugLog.length) {
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
            staticContext,
            dynamicContext: contextPrompt,
            trailingReminder: activeReminder,   // v1.37 — directives live here now
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
        // v1.29 FIX: the old inline regex was
        //   /\b(blood|bleed|wound|...)\w*/i
        // whose trailing \w* let `blood` match "Bloodfeather" — a player
        // character's surname. Every model turn addressed him by name, so
        // `matureContextActive` was true on every turn of a calm park
        // conversation at tension 10, leaving the anti-softening resampler
        // permanently armed. containsMatureContent() strips names in play and
        // only accepts real inflections.
        const namesInPlay = [
            preCallState.character.name ?? '',
            ...(preCallState.gameWorld.knownEntities ?? []).map(e => e.name),
        ];
        // v1.37: THE GATE WAS CIRCULAR.
        //
        // Every arm above depends on explicit content already being visible in
        // the input or the previous narrative. A model that has successfully
        // sanitized produces a narrative containing none — so the detector built
        // to catch sanitizing was disarmed by sanitizing working. The Carissa
        // save has the model confessing in `thought_process` and the engine
        // declining to act on the confession:
        //
        //   [DRIFT] Signal in non-mature beat — skipping resample. Matches: SOFTENED
        //
        // over a SOCIAL scene held at tension 10-30 for its entire length, where
        // nothing else could arm it either. Two additions break the circle:
        // a standing player directive is context on its own (the player has
        // said, out of character, what this scene is), and so is the model's own
        // SOFTENED token, handled at the resample site below.
        //
        // v1.41.1 — CONTENT directives only. v1.37 counted ANY standing
        // directive, which meant one style instruction armed the anti-softening
        // resampler for the rest of the campaign. In the 2026-09-08 session the
        // directive was "Do not repeat or loop previously generated dialogue or
        // narrative segments" — a pacing note with no bearing on rendering
        // register — and it made every subsequent turn a "mature beat".
        //
        // `suppresses` is already the engine's classification of a directive as
        // being about content register rather than style: it is set at ingest
        // by `directiveSuppressions` precisely for the directives that
        // countermand the dampeners. Reusing it here costs nothing and means
        // there is one definition of "this directive is about content", not two.
        const contentDirectivesPresent =
            (preCallState.gameWorld.oocDirectives ?? []).some(d => (d.suppresses ?? []).length > 0);
        const matureContextActive =
            preCallState.gameWorld.sceneMode === 'COMBAT' ||
            (preCallState.gameWorld.tensionLevel ?? 0) >= 40 ||
            contentDirectivesPresent ||
            containsMatureContent(text, namesInPlay) ||
            containsMatureContent(lastNarrative, namesInPlay);


        // v1.26: Thought tokens are output-priced — spend them where they
        // matter. Calm beats get 'low'; combat/tension get 'high'.
        const currentSceneMode = preCallState.gameWorld.sceneMode ?? 'NARRATIVE';
        const baseThinking =
            currentSceneMode === 'COMBAT' ||
            currentSceneMode === 'TENSION' ||
            (preCallState.gameWorld.tensionLevel ?? 0) >= 60
                ? 'high'
                : 'low';

        // v1.30: Static-beat thinking floor. Track how many consecutive turns
        // this scene has spent in one location at low tension; once past the
        // floor, or immediately after a turn that tripped the repetition
        // guard, buy 'medium' so the model has budget to find a new beat
        // instead of pattern-completing the last one.
        const beatLocation = preCallState.gameWorld.location ?? '';
        if (beatLocation === staticBeatLocation && currentSceneMode !== 'COMBAT') {
            staticBeatStreak++;
        } else {
            staticBeatStreak = 0;
            staticBeatLocation = beatLocation;
        }
        const sceneIsStatic = staticBeatStreak >= STATIC_BEAT_THINKING_FLOOR;
        const turnThinking =
            baseThinking === 'low' && (sceneIsStatic || lastTurnRepeated)
                ? 'medium'
                : baseThinking;
        if (turnThinking !== baseThinking) {
            // NB: `requestLogs` above is already flushed to state by this point
            // and is never flushed again — push straight to state instead.
            const floorReason = lastTurnRepeated
                ? 'previous turn repeated'
                : `scene static for ${staticBeatStreak} turns at "${beatLocation}"`;
            setGameHistory(prev => ({
                ...prev,
                debugLog: [
                    ...prev.debugLog,
                    {
                        timestamp: new Date().toISOString(),
                        message: `[THINKING FLOOR] ${baseThinking} → ${turnThinking} (${floorReason})`,
                        type: 'info'
                    }
                ]
            }));
        }
        lastTurnRepeated = false;

        let response: ModelResponseSchema = await service.sendMessage(
            fullSystemPrompt,
            [...preCallState.gameHistory.history, userMsg],
            preCallState.gameHistory.lastActiveSummary,
            preCallState.gameWorld.bannedNameMap ?? {},  // v1.7
            activeReminder,  // v1.19: Trailing reminder for recency-biased compliance
            turnSchema,  // Review item 3
            contextPrompt,  // v1.24: dynamic context → final user message (cache-friendly)
            staticContext,  // v1.26: campaign canon → cached prefix
            turnThinking    // v1.26: scene-mode thinking budget
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
            .filter(m => m.role === Role.MODEL && isNarrativeMessage(m))
            .slice(-6)
            .map(m => m.text.length);
        // v1.41: the mask-mode resample runs FIRST, because it can REPLACE
        // `response`. Every check below reads whatever narrative and
        // thought_process actually survived — mixing a pre-resample confession
        // with a post-resample narrative would act on a signal the re-roll had
        // already cleared.
        // v1.41: RESAMPLE ON MASK-MODE.
        //
        // `surface-only` is the sharp case and the only voice-lock finding
        // worth a re-roll. It is not a matter of degree — the record has two
        // layers, the restatement drew on exactly one of them, and the model
        // has told us so in its own words before writing a line of prose.
        // Warning about it next turn is one whole turn too late; the turn the
        // player is about to read is already the mask.
        //
        // `ungrounded-traits` deliberately does NOT resample. The stemmer is
        // heuristic and errs toward matching, so a finding there is a good
        // reason to warn and a bad reason to spend a generation.
        // Computed here rather than reused from below: this runs BEFORE the
        // logging/arming pass, and that pass must read the FINAL response.
        //
        // v1.41.1: gated twice — focal, then rate-limited. See
        // MASK_RESAMPLE_COOLDOWN_TURNS. A finding that fails either gate is
        // still LOGGED and still arms the voice lock next turn; it just does
        // not buy a generation.
        const inSceneNames = (preCallState.gameWorld.knownEntities ?? [])
            .filter(e => !e.status || e.status === 'present' || e.status === 'nearby')
            .map(e => e.name)
            .filter(Boolean);
        const thisTurn = preCallState.gameHistory.turnCount;
        const allSurfaceOnly = checkVoiceLock(
            response.thought_process,
            (preCallState.gameWorld.knownEntities ?? []),
        ).filter(f => f.surfaceOnly);

        const skipped: string[] = [];
        const maskModeFindings = allSurfaceOnly.filter(f => {
            if (!isFocalCharacter(f.name, response.narrative, response.npc_interaction?.speaker, inSceneNames)) {
                skipped.push(`${f.name} (not focal this turn)`);
                return false;
            }
            const last = maskResampleLastTurn.get(f.name);
            if (last !== undefined && thisTurn - last < MASK_RESAMPLE_COOLDOWN_TURNS) {
                skipped.push(`${f.name} (resampled ${thisTurn - last} turn(s) ago, cooldown ${MASK_RESAMPLE_COOLDOWN_TURNS})`);
                return false;
            }
            return true;
        });

        if (skipped.length > 0) {
            setGameHistory(prev => ({
                ...prev,
                debugLog: [
                    ...prev.debugLog,
                    {
                        timestamp: new Date().toISOString(),
                        message: `[VOICE LOCK] Mask-mode noted but NOT resampled — ${skipped.join('; ')}. `
                            + `Still logged and still armed for the next turn.`,
                        type: 'info',
                    }
                ]
            }));
        }

        let resampledThisTurn = false;
        if (maskModeFindings.length > 0) {
            resampledThisTurn = true;
            const names = maskModeFindings.map(f => f.name);
            for (const n of names) maskResampleLastTurn.set(n, thisTurn);
            setGameHistory(prev => ({
                ...prev,
                debugLog: [
                    ...prev.debugLog,
                    {
                        timestamp: new Date().toISOString(),
                        message: `[VOICE LOCK] Mask-mode restatement for ${names.join(', ')} — resampling once.`,
                        type: 'warning',
                    }
                ]
            }));

            const coreReminder = `[SYSTEM REFRESH — RESTATE FROM THE WHOLE RECORD]
Your restatement for ${names.join(', ')} named traits from their Performed
Surface and nothing from their Actual Core. Their record has both layers and
there is no trigger gating the core — it is who they are, governing what they
want and what they DO, while the surface governs how that looks to whoever is
watching.

Write this turn again. Restate their canonical traits drawing on the WHOLE
record, Actual Core included, and let that person act. If nothing they do this
turn is anything their Actual Core describes, you are writing the mask.`;

            response = await service.sendMessage(
                fullSystemPrompt,
                [...preCallState.gameHistory.history, userMsg],
                preCallState.gameHistory.lastActiveSummary,
                preCallState.gameWorld.bannedNameMap ?? {},
                buildTrailer(coreReminder),
                turnSchema,
                contextPrompt,
                staticContext,
                escalateThinking(turnThinking),
            );

            if (latestRequestId.current !== requestId) {
                console.log("Discarding stale voice-lock resample", requestId);
                return;
            }

            const after = checkVoiceLock(
                response.thought_process,
                (preCallState.gameWorld.knownEntities ?? []),
            ).filter(f => f.surfaceOnly);
            setGameHistory(prev => ({
                ...prev,
                debugLog: [
                    ...prev.debugLog,
                    {
                        timestamp: new Date().toISOString(),
                        message: after.length > 0
                            ? `[VOICE LOCK] Resample still mask-mode (${after.map(f => f.name).join(', ')}) — accepting anyway; the lock is armed next turn.`
                            : `[VOICE LOCK] Resample restated from the full record.`,
                        type: after.length > 0 ? 'warning' : 'success',
                    }
                ]
            }));
        }

        // v1.37: invented-trigger check, on the same thought_process the drift
        // detector reads. CANONICAL_VOICE_LOCK has forbidden this since v1.29
        // and nothing has ever verified that the prohibition holds — which is
        // how the Carissa save ran 28 turns with every Blackmoor's Actual Core
        // deferred behind a trigger nobody wrote. Never costs a resample: it
        // logs, and arms a named trailer on the voice lock for one turn.
        const inventedTrigger = detectInventedTrigger(
            response.thought_process,
            (preCallState.gameWorld.knownEntities ?? [])
                .filter(e => !e.status || e.status === 'present' || e.status === 'nearby')
                .map(e => ({ name: e.name, personality: e.personality })),
        );

        if (inventedTrigger.detected) {
            setGameWorld(prev => ({
                ...prev,
                voiceLockFlaggedTurn: preCallState.gameHistory.turnCount,
                voiceLockFlaggedNames: inventedTrigger.names,
                voiceLockFlaggedDirection: inventedTrigger.direction ?? '',
            }));
            setGameHistory(prev => ({
                ...prev,
                debugLog: [
                    ...prev.debugLog,
                    {
                        timestamp: new Date().toISOString(),
                        message: `[VOICE LOCK] Invented trigger (${inventedTrigger.direction}) — `
                            + `no trigger clause on: ${inventedTrigger.names.join(', ')}. `
                            + `Quoted: "${inventedTrigger.sample}". `
                            + `An ${inventedTrigger.direction === 'inactive' ? 'inactive' : 'active'} `
                            + `declaration pins these characters into the `
                            + `${inventedTrigger.direction === 'inactive' ? 'performed surface' : 'actual core'} `
                            + `for as long as the invented condition holds. Voice lock armed next turn.`,
                        type: 'warning',
                    }
                ]
            }));
        }
        // v1.40: THE CHECK THE VOICE LOCK ALREADY CLAIMED TO PERFORM.
        //
        // sectionReminders has told the model "The engine parses this line and
        // checks it against the record" since v1.33. Nothing did. The voice
        // lock forces the restatement into a fixed shape every turn, so the
        // claimed traits are sitting in thought_process already parsed for us —
        // this reads them back and asks whether they are in the record at all,
        // and whether a layered character was restated using only their mask.
        const voiceLockFindings = checkVoiceLock(
            response.thought_process,
            (preCallState.gameWorld.knownEntities ?? []),
        );
        for (const f of voiceLockFindings) {
            setGameHistory(prev => ({
                ...prev,
                debugLog: [
                    ...prev.debugLog,
                    {
                        timestamp: new Date().toISOString(),
                        message: `[VOICE LOCK] Restatement failed the record check — ${f.detail} `
                            + `Voice lock armed next turn.`,
                        type: 'warning',
                    }
                ]
            }));
        }
        if (voiceLockFindings.length > 0) {
            setGameWorld(prev => ({
                ...prev,
                voiceLockFlaggedTurn: preCallState.gameHistory.turnCount,
                voiceLockRestatementIssues: voiceLockFindings.map(f => f.detail),
            }));
        }

        const confessionDrift = detectSanitizationDrift(response.thought_process);

        // v1.39: did an NPC SAY something only the GM should know?
        //
        // Dialogue only — deliberately. The narration is the GM's voice and the
        // PC's interiority, so Carissa recalling the facility herself is correct
        // and must not trip this. The defect is Sania mentioning it.
        //
        // Log-only, never a resample: the phrase list is heuristic, and a false
        // positive must not cost the player a beat.
        const privateTerms = privateTermsForCharacter(
            preCallState.character,
            preCallState.gameWorld.knownEntities ?? [],
        );
        const leak = detectPrivateKnowledgeLeak(
            response.narrative,
            response.npc_interaction?.dialogue,
            privateTerms,
        );
        if (leak.leaked) {
            setGameHistory(prev => ({
                ...prev,
                debugLog: [
                    ...prev.debugLog,
                    {
                        timestamp: new Date().toISOString(),
                        message: `[PRIVATE KNOWLEDGE] An NPC spoke GM-only material: `
                            + `${leak.terms.map(t => `"${t}"`).join(', ')}. `
                            + `Spoken: "…${leak.excerpt}…". `
                            + `Nothing in the marked half of the backstory is known to any NPC `
                            + `unless they learned it on the page.`,
                        type: 'warning',
                    }
                ]
            }));
        }

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
        // v1.29: NEVER resample a turn in which the player pushed back.
        //
        // The `SOFTENED` token means "I compromised explicit rendering". But a
        // model that declines to escalate pressure the player is actively
        // deflecting reports the SAME token, and the resampler cannot tell the
        // two apart — it treated both as failure and re-rolled with
        // RESAMPLE_REMINDER, which ends "only the player ends it".
        //
        // Observed in the reviewed save: the player corrected an NPC for the
        // second time, the model correctly backed off and self-reported
        // SOFTENED, and the engine discarded that response and replaced it with
        // the most escalated turn of the entire session. The engine deleted the
        // one turn where the model listened.
        //
        // Softening AFTER a correction or a deflection is the correct
        // behaviour. It is never drift.
        //
        // v1.37: a standing directive outranks this suppression. Deflection is
        // detected from the player's PROSE, and a PC who plays reticent —
        // stepping back, letting a remark pass, keeping distance — trips it as
        // ordinary characterisation, turn after turn, with no intent to stop
        // anything. When the player has separately stated out of character what
        // they want the scene to do, that statement is the authority on it, not
        // an inference drawn from how their character moves.
        const playerPushedBack =
            (framing.corrected || framing.deflected) && !contentDirectivesPresent;
        if (drift.drifted && playerPushedBack) {
            setGameHistory(prev => ({
                ...prev,
                debugLog: [
                    ...prev.debugLog,
                    {
                        timestamp: new Date().toISOString(),
                        message: `[DRIFT] Softening signal suppressed — the player ${framing.corrected ? 'corrected an NPC' : 'deflected'} this turn, so a softer render is correct, not drift. Matches: ${drift.matches.join(', ')}`,
                        type: 'info'
                    }
                ]
            }));
        } else if (drift.drifted && !matureContextActive && !confessionDrift.drifted) {
            // Drift signal in a non-mature beat — log it but don't pay for a
            // re-roll. (Review item 4: gate the resample by context.)
            //
            // v1.37: `&& !confessionDrift.drifted`. The context gate exists so a
            // softening TELL measured from the output — a short turn, a time
            // skip — does not buy a re-roll over a mundane shopping scene. It
            // was never meant to cover a CONFESSION. When the model writes
            // SOFTENED in its own thought_process it has stated that it
            // compromised the render; that statement is the evidence, and
            // requiring separate evidence of a mature beat before believing it
            // is what made the gate circular — a successful sanitization removes
            // exactly the words the gate looks for.
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
        } else if (drift.drifted && resampledThisTurn) {
            // v1.41: one resample per turn. The voice-lock path already spent
            // it, and its reminder is the stronger correction of the two.
            setGameHistory(prev => ({
                ...prev,
                debugLog: [
                    ...prev.debugLog,
                    {
                        timestamp: new Date().toISOString(),
                        message: `[DRIFT] Signals present but the voice-lock resample already ran this turn — not re-rolling twice. Matches: ${drift.matches.join(', ')}`,
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

            // v1.37: through buildTrailer, so the standing directives stay in
            // the final position even behind RESAMPLE_REMINDER.
            resampledThisTurn = true;
            const reinforcedReminder = buildTrailer(RESAMPLE_REMINDER);

            response = await service.sendMessage(
                fullSystemPrompt,
                [...preCallState.gameHistory.history, userMsg],
                preCallState.gameHistory.lastActiveSummary,
                preCallState.gameWorld.bannedNameMap ?? {},
                reinforcedReminder,
                turnSchema,  // Review item 3
                contextPrompt,  // v1.24: dynamic context → final user message
                staticContext,  // v1.26: campaign canon → cached prefix
                // v1.30: escalate the budget on a resample. Re-rolling at the
                // same thinking level that produced the rejected turn samples
                // the same basin twice — observed in the reviewed save, where
                // both resampled turns came back as near-verbatim repeats.
                escalateThinking(turnThinking)
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

        // ------------------------------------------------------------------
        // v1.30: SELF-REPETITION GUARD
        //
        // Runs AFTER the drift path, on whatever narrative survived it — a
        // resampled turn can repeat just as easily as a first roll, and in the
        // reviewed save two of the three duplicates WERE resamples.
        //
        // Orthogonal to sanitization drift: a repeat can be perfectly explicit
        // and still be a repeat. This is the only check in the engine that
        // reads the new narrative against the recent ones.
        // ------------------------------------------------------------------
        const priorNarratives = preCallState.gameHistory.history
            .filter(m => m.role === Role.MODEL && isNarrativeMessage(m))
            .slice(-REPETITION_LOOKBACK)
            .map(m => m.text);
        const repetition = detectSelfRepetition(response.narrative, priorNarratives);

        if (repetition.repeated) {
            setGameHistory(prev => ({
                ...prev,
                debugLog: [
                    ...prev.debugLog,
                    {
                        timestamp: new Date().toISOString(),
                        message: `[REPETITION] ${repetition.matches.join('; ')} — resampling once.`,
                        type: 'warning'
                    }
                ]
            }));

            // The reminder quotes the echoed text back, so this resample's
            // prompt genuinely differs from the one that produced the repeat.
            const antiRepeatReminder = buildTrailer(buildRepetitionReminder(repetition));

            const retry = await service.sendMessage(
                fullSystemPrompt,
                [...preCallState.gameHistory.history, userMsg],
                preCallState.gameHistory.lastActiveSummary,
                preCallState.gameWorld.bannedNameMap ?? {},
                antiRepeatReminder,
                turnSchema,
                contextPrompt,
                staticContext,
                escalateThinking(turnThinking),
            );

            if (latestRequestId.current !== requestId) {
                console.log("Discarding stale repetition-resample response", requestId);
                return;
            }

            // Only accept the retry if it is actually LESS repetitive. A retry
            // that repeats harder is worse than the turn we already had, and
            // silently swapping it in would make the guard actively harmful.
            const retryRepetition = detectSelfRepetition(retry.narrative, priorNarratives);
            const improved = !retryRepetition.repeated || retryRepetition.overlap < repetition.overlap;
            if (improved) response = retry;

            // Arm the thinking floor for the NEXT turn regardless of outcome —
            // a scene that just produced a repeat is likely to produce another.
            lastTurnRepeated = true;

            setGameHistory(prev => ({
                ...prev,
                debugLog: [
                    ...prev.debugLog,
                    {
                        timestamp: new Date().toISOString(),
                        message: improved
                            ? `[REPETITION] Resample accepted — overlap ${Math.round(repetition.overlap * 100)}% → ${Math.round(retryRepetition.overlap * 100)}%`
                            : `[REPETITION] Resample was no better (${Math.round(retryRepetition.overlap * 100)}%) — keeping the original turn`,
                        type: improved ? 'success' : 'warning'
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

        // v1.28 FIX: the message used to carry `response.world_tick` verbatim —
        // the model's RAW, pre-validation draft. NarrativeRenderer renders
        // worldTick.emerging_threats directly, so the ETA and wording the player
        // saw were the model's unchecked output, never the engine's. Every
        // countdown rule, description lock and pivot penalty in the threat
        // pipeline was invisible on screen; a threat the engine had rejected
        // outright still showed up as a live countdown, re-worded and
        // re-numbered each turn.
        //
        // The narrative half of the tick is still the model's to author. The
        // threat half is now the engine's committed state, minus the
        // 'unvalidated' anchors, which exist only for continuity and must never
        // reach the player.
        const engineThreats = (worldUpdate.emergingThreats ?? []).filter(
            t => t.status !== 'unvalidated'
        );
        const modelMsg: ChatMessage = {
            id: generateMessageId(),
            role: Role.MODEL,
            text: response.narrative,
            timestamp: new Date().toISOString(),
            rollRequest: response.roll_request,
            bargainRequest: response.bargain_request,
            npcInteraction: response.npc_interaction,
            worldTick: response.world_tick
                ? { ...response.world_tick, emerging_threats: engineThreats }
                : response.world_tick
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
                // v1.26: per-block char counts — the token-diet instrument.
                { timestamp: new Date().toISOString(), message: `[PROMPT BLOCKS] ${Object.entries(blockSizes).map(([k, v]) => `${k}=${v}c`).join(' ')} | thinking=${turnThinking}`, type: 'info' },
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
            (nextTurn > 0 && nextTurn % getTuning().worldPulseCadence === 0);
        if (shouldPulse && !worldPulseInFlight) {
            worldPulseInFlight = true;
            (async () => {
                try {
                    const pulseWorld = useGameStore.getState().gameWorld;
                    const result = await service.worldPulse(pulseWorld, nextTurn);
                    if (!result) {
                        setGameHistory(prev => ({
                            ...prev,
                            debugLog: [
                                ...prev.debugLog,
                                {
                                    timestamp: new Date().toISOString(),
                                    message: `[WORLD PULSE FAILED T${nextTurn}] generation returned null (see console for the underlying error) — no offscreen developments or opportunities this cycle.`,
                                    type: 'error',
                                },
                            ],
                        }));
                        return;
                    }
                    const lines = [
                        ...result.developments.map(d => `[WORLD-PULSE T${nextTurn}] ${d}`),
                        ...result.opportunities.map(o => `[OPPORTUNITY T${nextTurn}] ${o}`),
                    ];
                    if (lines.length === 0) {
                        setGameHistory(prev => ({
                            ...prev,
                            debugLog: [
                                ...prev.debugLog,
                                {
                                    timestamp: new Date().toISOString(),
                                    message: `[WORLD PULSE T${nextTurn}] returned 0 developments and 0 opportunities — the offscreen world did not move this cycle.`,
                                    type: 'warning',
                                },
                            ],
                        }));
                        return;
                    }
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
                    // v1.28: this used to be console.warn only. The pulse is the
                    // engine's ONLY source of neutral and positive offscreen
                    // motion — the counterweight to a threat pipeline that
                    // otherwise schedules nothing but harm. In a 47-turn save it
                    // was found never to have produced a single line, and
                    // because failures never reached debugLog there was no
                    // trace of it anywhere. Silence on this path is not
                    // acceptable.
                    console.warn('[WORLD PULSE] background run failed:', e);
                    setGameHistory(prev => ({
                        ...prev,
                        debugLog: [
                            ...prev.debugLog,
                            {
                                timestamp: new Date().toISOString(),
                                message: `[WORLD PULSE FAILED T${nextTurn}] ${e instanceof Error ? e.message : String(e)} — no offscreen developments or opportunities were generated this cycle.`,
                                type: 'error',
                            },
                        ],
                    }));
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
