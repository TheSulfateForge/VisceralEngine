import type {
    ModelResponseSchema,
    GameWorld,
    Character,
    DebugLogEntry,
    LoreItem,
    KnownEntity,
    SceneMode,
    WorldTime,
    ThreatDenialTracker,
    ThreatArcHistory,
    DormantHook,
    FactionExposure,
    WorldTickEvent
} from '../../types';

/**
 * TurnContext encapsulates all mutable state that flows through the pipeline.
 * Each step reads from ctx and modifies ctx, passing it to the next step.
 */
export interface TurnContext {
    // Inputs (set once at construction, treated as read-only by steps)
    readonly response: ModelResponseSchema;
    readonly previousWorld: Readonly<GameWorld>;
    readonly previousCharacter: Readonly<Character>;
    readonly playerInput: string;
    readonly playerRemovedConditions: readonly string[];
    readonly currentTurn: number;

    // Sanitised response (mutable — sanitize step writes it)
    sanitisedResponse: ModelResponseSchema;

    // Accumulated state (each step mutates its slice)
    worldUpdate: GameWorld;
    characterUpdate: Character;
    debugLogs: DebugLogEntry[];
    pendingLore: LoreItem[];

    // Cross-step shared state (set by early steps, read by later steps)
    nameMap: Record<string, string>;
    usedNames: string[];
    suppressedEntityNames: Set<string>;
    denialTracker: ThreatDenialTracker;
    globalCooldownUntil: number;
    sessionDenialCount: number;
    lastThreatArcEndTurn: number;
    effectiveSceneMode: SceneMode;
    newPlayerLocation: string;
    updatedKnownEntities: KnownEntity[];
    processedThreats: WorldTickEvent[] | undefined;
    currentHooks: DormantHook[] | undefined;
    currentFactionExposure: FactionExposure | undefined;
    currentThreatArcHistory: ThreatArcHistory | undefined;
    detectedPassiveAllies: string[] | undefined;
    newHiddenRegistry: string;
    lastWorldTickTurn: number;
    nextThreats: any[];
    nextEnv: any;
    bioResult: any;
    newTime: WorldTime;
    tensionLevel: number;
}

export interface PipelineStep {
    name: string;
    execute: (ctx: TurnContext) => TurnContext;
}

export interface SimulationResult {
    worldUpdate: GameWorld;
    characterUpdate: Character;
    debugLogs: DebugLogEntry[];
    pendingLore: LoreItem[];
}
