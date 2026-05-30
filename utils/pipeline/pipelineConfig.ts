/**
 * Pipeline configuration and context builder.
 * Assembles the TurnContext from inputs and defines the DEFAULT_PIPELINE order.
 */

import type { TurnContext, PipelineStep } from './types';
import type {
    ModelResponseSchema,
    GameWorld,
    Character,
    ThreatDenialTracker,
    TimeMode
} from '../../types';
import { deriveWorldTime, resolveTimeMode } from '../engine';

import { sanitizeStep } from './steps/01-sanitize';
import { timeProgressionStep } from './steps/02-timeProgression';
import { bioTickStep } from './steps/03-bioTick';
import { reproductionStep } from './steps/04-reproduction';
import { thoughtAndCombatStep } from './steps/05-thoughtAndCombat';
import { entityLifecycleStep } from './steps/06-entityLifecycle';
import { memoryLoreStep } from './steps/07-memoryLore';
import { hiddenRegistryStep } from './steps/08-hiddenRegistry';
import { worldTickStep } from './steps/09-worldTick';
import { conditionPipelineStep } from './steps/10-conditionPipeline';
import { sceneModeBargainStep } from './steps/11-sceneModeBargain';
import { assembleStateStep } from './steps/12-assembleState';
import { traumaEffectsStep } from './steps/13-traumaEffects';
import { factionConflictsStep } from './steps/14-factionConflicts';
import { aiSkillUpdatesStep } from './steps/15-aiSkillUpdates';
import { usageAdvancementStep } from './steps/16-usageAdvancement';

/**
 * Builds the initial TurnContext from inputs.
 * This initializes all mutable state that flows through the pipeline.
 */
export function buildTurnContext(
    response: ModelResponseSchema,
    previousWorld: GameWorld,
    previousCharacter: Character,
    currentTurn: number,
    playerRemovedConditions: string[] = [],
    playerInput: string = ''
): TurnContext {
    return {
        // Immutable inputs
        response,
        previousWorld,
        previousCharacter,
        playerInput,
        playerRemovedConditions,
        currentTurn,

        // Mutable state initialized with empty/default values
        sanitisedResponse: response, // Will be overwritten by sanitize step
        worldUpdate: { ...previousWorld },
        characterUpdate: { ...previousCharacter },
        debugLogs: [],
        pendingLore: [],

        // Cross-step shared state
        nameMap: { ...previousWorld.bannedNameMap },
        usedNames: [...(previousWorld.usedNameRegistry ?? [])],
        suppressedEntityNames: new Set<string>(),
        denialTracker: { ...(previousWorld.threatDenialTracker ?? {}) } as ThreatDenialTracker,
        globalCooldownUntil: previousWorld.threatCooldownUntilTurn ?? 0,
        sessionDenialCount: previousWorld.sessionDenialCount ?? 0,
        lastThreatArcEndTurn: previousWorld.lastThreatArcEndTurn ?? 0,
        effectiveSceneMode: previousWorld.sceneMode ?? 'NARRATIVE',
        effectiveTimeMode: resolveTimeMode(response),
        newPlayerLocation: previousWorld.location ?? '',
        updatedKnownEntities: [...(previousWorld.knownEntities ?? [])],
        processedThreats: undefined,
        currentHooks: undefined,
        currentFactionExposure: undefined,
        currentThreatArcHistory: undefined,
        detectedPassiveAllies: undefined,
        newHiddenRegistry: previousWorld.hiddenRegistry || '',
        lastWorldTickTurn: previousWorld.lastWorldTickTurn ?? 0,
        nextThreats: previousWorld.activeThreats,
        nextEnv: previousWorld.environment,
        bioResult: undefined as any,
        newTime: previousWorld.time ?? deriveWorldTime(0),
        tensionLevel: response.tension_level ?? previousWorld.tensionLevel ?? 10,
    };
}

/**
 * The default pipeline: all steps in order.
 * This is the primary execution path.
 */
export const DEFAULT_PIPELINE: PipelineStep[] = [
    sanitizeStep,
    timeProgressionStep,
    bioTickStep,
    reproductionStep,
    thoughtAndCombatStep,
    entityLifecycleStep,
    memoryLoreStep,
    hiddenRegistryStep,
    worldTickStep,
    conditionPipelineStep,
    sceneModeBargainStep,
    assembleStateStep,
    traumaEffectsStep,
    factionConflictsStep,
    aiSkillUpdatesStep,
    usageAdvancementStep,
];

/**
 * v1.21: Per-time_mode pipeline gating. Each mode names the step(s) it skips;
 * only "effect" steps are ever gated — state-assembly steps (sanitize, time,
 * assembleState, etc.) always run so the pipeline output stays well-formed.
 *
 *   MONTAGE  days–years   — summary-only; per-tick bio/world/trauma/faction
 *                           effects are replaced by montage-scale summarisation.
 *   REST     sleep/idle   — bio + memory focus; no combat or faction conflict.
 *   ACTIVITY declared act. — mostly default; combat gated off (no train_combat
 *                            activity-type plumbing yet — that's System 4).
 *   TICK     combat round — no global world drift inside a ~30s beat.
 *   SCENE    default      — all steps run.
 */
export const TIME_MODE_SKIP_STEPS: Record<TimeMode, ReadonlySet<string>> = {
    TICK: new Set(['09-worldTick']),
    SCENE: new Set(),
    ACTIVITY: new Set(['05-thoughtAndCombat']),
    REST: new Set(['05-thoughtAndCombat', 'factionConflicts']),
    MONTAGE: new Set(['03-bioTick', '09-worldTick', 'traumaEffects', 'factionConflicts']),
};

/**
 * v1.21: Build the pipeline for a given time_mode by filtering DEFAULT_PIPELINE
 * down to the steps that mode enables. Falls back to the full pipeline for any
 * unknown mode.
 */
export function buildPipeline(timeMode: TimeMode): PipelineStep[] {
    const skip = TIME_MODE_SKIP_STEPS[timeMode];
    if (!skip || skip.size === 0) return DEFAULT_PIPELINE;
    return DEFAULT_PIPELINE.filter(step => !skip.has(step.name));
}
