/**
 * Pipeline configuration and context builder.
 * Assembles the TurnContext from inputs and defines the DEFAULT_PIPELINE order.
 */

import type { TurnContext, PipelineStep } from './types';
import type {
    ModelResponseSchema,
    GameWorld,
    Character,
    ThreatDenialTracker
} from '../../types';

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
        newTime: previousWorld.time ?? { totalMinutes: 0, day: 0, hour: 0, minute: 0, display: '00:00' },
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
];
