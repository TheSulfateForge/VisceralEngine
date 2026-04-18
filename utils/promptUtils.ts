import { GameHistory, GameWorld, Character, SceneMode, MemoryItem, LoreItem, KnownEntity, BioMonitor, ActiveThreat, DormantHook, FactionExposure, ThreatDenialTracker, ChatMessage, Role } from '../types';
import { retrieveRelevantContext, RAGResult } from './ragEngine';
// v1.19: Section reminders moved to trailing position on user message (useGeminiClient.ts)
// import { getSectionReminders } from '../sectionReminders';
import { partitionConditions } from './contentValidation';
import { applyExistingMap } from './nameResolver';
import { DOWNTIME_KEYWORDS, DENIAL_SUPPRESSION_THRESHOLD, getContextProfile, SLEEP_KEYWORDS, DREAM_TRAUMA_THRESHOLD } from '../config/engineConfig';
import { buildTraumaPromptBlock } from './traumaSystem';
import { buildSkillPromptBlock } from './skillSystem';
import { buildFactionPromptBlock } from './factionSystem';

export interface PromptResult {
    prompt: string;
    ragDebug: RAGResult['debugInfo'];
}

// --- Builder Functions ---

// v1.21: Memory items are now capped per model profile. Most recent memories
// are kept (recency heuristic) since older memories are likelier to be stale
// or superseded. Full RAG scoring of memories is a future enhancement.
const buildMemoryContext = (memory: MemoryItem[], limit?: number): string => {
    if (memory.length === 0) return "";
    const capped = limit && memory.length > limit
        ? memory.slice(-limit)
        : memory;
    return capped.map(m => `• ${m.fact}`).join('\n');
};

/**
 * v1.21: Situation Recap — a concise anchor block injected at the TOP of dynamic
 * context. Gives the model a clear snapshot of "what is happening right now"
 * without requiring it to reconstruct this from scattered context blocks.
 * Critical for lite models that lose the thread when context is large.
 */
const buildSituationRecap = (
    character: Character,
    world: GameWorld,
    recentHistory: ChatMessage[]
): string => {
    const locGraph = world.locationGraph;
    const location = locGraph?.playerLocationId
        ? (locGraph.nodes?.[locGraph.playerLocationId]?.displayName ?? locGraph.playerLocationId)
        : 'Unknown';
    const presentEntities = (world.knownEntities || [])
        .filter(e => !e.status || e.status === 'present')
        .map(e => `${e.name} (${e.role})`)
        .slice(0, 5)
        .join(', ');
    const activeThreats = (world.emergingThreats || [])
        .filter(t => (t.turns_until_impact ?? 99) <= 3)
        .map(t => t.description.slice(0, 60))
        .slice(0, 2);
    const threatLine = activeThreats.length > 0
        ? `\nImminent: ${activeThreats.join('; ')}`
        : '';
    // Grab a brief snippet of the last model output for continuity
    const lastModelText = recentHistory
        .filter(m => m.role === Role.MODEL)
        .slice(-1)[0]?.text || '';
    const lastSnippet = lastModelText.length > 120
        ? lastModelText.slice(0, 120) + '…'
        : lastModelText;

    return `[SITUATION RECAP — Read this first]
${character.name} is at: ${location}
Present: ${presentEntities || 'No one nearby'}
Scene: ${world.sceneMode || 'NARRATIVE'} | Tension: ${world.tensionLevel ?? 0}/100${threatLine}
Last: ${lastSnippet}`;
};

const buildLoreContext = (lore: LoreItem[]): string => {
    if (lore.length === 0) return "";
    return lore.map(l => `[${l.keyword}]: ${l.content}`).join('\n');
};

const buildEntityContext = (entities: KnownEntity[]): string => {
    if (entities.length === 0) return "";

    // Only inject full context for present/nearby entities
    const active = entities.filter(e =>
        !e.status || e.status === 'present' || e.status === 'nearby'
    );
    const distant = entities.filter(e => e.status === 'distant');
    const dead = entities.filter(e => e.status === 'dead');

    let context = '';

    if (active.length > 0) {
        const activeStrings = active.map(e =>
            `ID: ${e.id}\n Name: ${e.name} (${e.role})\n Location: ${e.location}\n` +
            ` Current State: [${e.relationship_level}] - ${e.impression}\n` +
            ` Leverage: ${e.leverage}\n Ledger: [${e.ledger.join(', ')}]`
        ).join('\n----------------\n');
        context += `\n[ACTIVE ENTITIES — In Scene / Nearby]\n${activeStrings}`;
    }

    // Distant entities get a compressed one-liner to save tokens
    if (distant.length > 0) {
        const distantSummary = distant.map(e =>
            `${e.name} (${e.role}) — ${e.location} [${e.relationship_level}]`
        ).join('\n');
        context += `\n\n[DISTANT ENTITIES — Known but not present]\n${distantSummary}`;
    }

    // Dead entities get a single line so the AI knows not to reference them
    if (dead.length > 0) {
        const deadNames = dead.map(e => e.name).join(', ');
        context += `\n\n[DEAD — Do not reference as living or acting] ${deadNames}`;
    }

    return context;
};

const buildBioStatus = (bio: BioMonitor | undefined, timeDisplay: string): string => {
    const safeBio = bio || { 
        metabolism: { calories: 80, hydration: 80, stamina: 100, libido: 5 }, 
        pressures: { bladder: 0, bowels: 0, lactation: 0, seminal: 0 },
        timestamps: { lastSleep: 0, lastMeal: 0, lastOrgasm: 0 },
        modifiers: { calories: 1.0, hydration: 1.0, stamina: 1.0, lactation: 1.0 }
    };

    return `
[BIOLOGICAL STATUS]
Time: ${timeDisplay}
Calories: ${Math.round(safeBio.metabolism.calories)}/100 ${safeBio.metabolism.calories < 40 ? "(HUNGRY)" : ""}
Hydration: ${Math.round(safeBio.metabolism.hydration)}/100 ${safeBio.metabolism.hydration < 40 ? "(THIRSTY)" : ""}
Stamina: ${Math.round(safeBio.metabolism.stamina)}/100
Lactation Pressure: ${Math.round(safeBio.pressures.lactation)}%

[ACTIVE MODIFIERS] (1.0 = Base)
Calorie Burn: x${safeBio.modifiers.calories}
Water Burn: x${safeBio.modifiers.hydration}
Stamina Burn: x${safeBio.modifiers.stamina}
Lactation Rate: x${safeBio.modifiers.lactation}
    `.trim();
};

const buildPacingInstruction = (tension: number, currentMode: string, isDowntime: boolean): string => {
    if (tension > 70 || currentMode === 'COMBAT') {
        return `
[PACING: HIGH TENSION / SURVIVAL]
1. Focus on survival, adrenaline, and rapid consequences.
2. Short, punchy sentences.
3. If the user hesitates, the threat advances.
        `.trim();
    } 
    
    if (isDowntime || currentMode === 'SOCIAL') {
        return `
[PACING: SLOW / SOCIAL]
1. DETAILED SENSORY FOCUS. Describe the environment's texture, smell, and temperature.
2. FORCE NPC INTERACTION. If the player speaks, the NPC *must* reply with dialogue.
3. NO COMBAT SPAWNS. Do not interrupt this scene with random attacks.
4. Scenario can be sexually charged in a negative or positive way. This is not a requirement.
5. TIME: Dialogue turns are SHORT. A spoken sentence = 1-3 minutes. An extended exchange = 5-10 minutes. Do NOT default to 15 for every turn. Think: how long would this ACTUALLY take to say out loud?
        `.trim();
    }

    return `
[PACING: NEUTRAL]
The simulation is running standard narrative protocols.
    `.trim();
};

const buildCharacterBlock = (character: Character): string => {
    // Partition conditions: long personality/trait paragraphs that leaked in from
    // character creation are separated from short mechanical game-states.
    // Traits go into the CHARACTER TRAITS section (read-only context for the AI).
    // Active conditions go into the CONDITIONS field (the AI may add/remove these).
    const { active: activeConditions, passive: traits } = partitionConditions(character.conditions);

    const traitsSection = traits.length > 0
        ? `\n- **Character Traits (fixed, do NOT add/remove via character_updates):**\n${traits.map(t => `  • ${t}`).join('\n')}`
        : '';

    const skillBlock = buildSkillPromptBlock(character.skills ?? []);

    return `
**Primary Directive: Player Character Data**
This is the player character. This data is ABSOLUTE TRUTH.
- **Name:** ${character.name} (${character.gender}, ${character.race})
- **Appearance:** ${character.appearance}
- **Markings:** ${character.notableFeatures}
- **Backstory:** ${character.backstory}
- **Setting:** ${character.setting}
- **Inventory:** ${character.inventory.join(', ')}
- **Active Conditions (mechanical game-states, may be updated):** ${activeConditions.length > 0 ? activeConditions.join(', ') : 'None'}${traitsSection}
- **Relationships:** ${character.relationships.join(', ')}
- **Languages Known:** ${(character.languagesKnown && character.languagesKnown.length > 0) ? character.languagesKnown.join(', ') : 'Unspecified — treat as common tongue only; render foreign speech as unintelligible subtext.'}
- **Goals:** ${character.goals.join(', ')}${skillBlock}
    `.trim();
};

const buildWorldPressure = (
    knownEntities: KnownEntity[], 
    turnCount: number, 
    lastWorldTickTurn: number
): string => {
    // Count turns since registry last had a WORLD-TICK entry
    const turnsSinceActivity = turnCount - lastWorldTickTurn;
    const hasRecentWorldActivity = turnsSinceActivity < 4;
    
    // Build NPC goal summary from entities that have ledger entries suggesting active goals
    const activeNPCs = knownEntities
        .filter(e => e.relationship_level !== 'NEUTRAL' || (e.ledger?.length ?? 0) > 2)
        .slice(0, 6) // Cap to avoid prompt bloat
        .map(e => `- ${e.name} [${e.relationship_level}]: "${e.impression}" — Ledger: ${(e.ledger ?? []).slice(-2).join('; ')}`)
        .join('\n');

    // Every 4+ turns of low world activity, increase pressure
    const pressureNote = turnCount > 5 && !hasRecentWorldActivity 
        ? `\n⚠ WARNING: The world has been static for ${turnsSinceActivity} turns. At least one NPC MUST take a meaningful action this turn. Check their goals.`
        : '';

    if (!activeNPCs) return '';

    return `
[NPC STATUS — These people have lives. What are they doing RIGHT NOW?]
${activeNPCs}
${pressureNote}
    `.trim();
};

// --- Main Function ---

/**
 * Builds a hard scope lock block for combat/tension encounters.
 * Prevents the AI from retroactively introducing entities (tracking hounds,
 * reinforcements, mages) that were never established in the scene.
 */
const buildEncounterScopeLock = (activeThreats: ActiveThreat[]): string => {
    if (!activeThreats || activeThreats.length === 0) return '';
    const threatList = activeThreats
        .map(t => `- ${t.name} [${t.archetype}] — Status: ${t.status}, Condition: ${t.condition}`)
        .join('\n');
    return `
[⚠ ENCOUNTER SCOPE LOCK — CONSISTENCY ENFORCEMENT]
The ONLY hostile entities present in this encounter are those listed below. This list is ABSOLUTE.
You may NOT retroactively introduce new enemy types, creatures, reinforcements, or assets
(e.g. tracking hounds, mages, backup squads) that do not already appear here.
If new forces arrive, they must be seeded as an emerging_threat FIRST and arrive in a future turn.
Violating this rule breaks simulation consistency and is a SYSTEM ERROR.

ESTABLISHED HOSTILE ENTITIES:
${threatList}
    `.trim();
};

/**
 * v1.6: Builds the Origin Gate context block injected into each turn's prompt.
 * Shows the AI exactly which dormant hook IDs are valid and what faction exposure
 * scores currently exist, so it can correctly populate dormant_hook_id.
 */
const buildDormantHooksContext = (
    dormantHooks: DormantHook[],
    factionExposure: FactionExposure
): string => {
    if (!dormantHooks.length && !Object.keys(factionExposure).length) return '';

    const lines: string[] = ['[ORIGIN GATE CONTEXT — read before seeding any threat this turn]', ''];

    if (dormantHooks.length > 0) {
        lines.push('DORMANT HOOKS (pre-existing tension vectors from character background):');
        lines.push('To pass Origin Test A, set dormant_hook_id to the exact ID shown below.');
        // v1.11: Inform AI about scaled overlap requirements
        lines.push('NOTE: Broad hooks require MORE thematic overlap words (not just faction names).');
        lines.push('Faction/setting words (e.g., a faction name) count as HALF weight toward overlap.');
        lines.push('');
        for (const hook of dormantHooks) {
            const statusMark =
                hook.status === 'dormant'   ? '◆ DORMANT'   :
                hook.status === 'activated' ? '▶ ACTIVE'    : '✓ RESOLVED';

            // v1.11: Show cooldown status
            let cooldownNote = '';
            if (hook.cooldownUntilTurn !== undefined && hook.cooldownUntilTurn > 0) {
                cooldownNote = ` ⏸ COOLDOWN (cannot source new threats yet)`;
            }

            lines.push(`  ${statusMark}${cooldownNote} [${hook.id}]`);
            lines.push(`    ${hook.summary}`);
            lines.push(`    Activates when: ${hook.activationConditions}`);
            if (hook.involvedEntities.length > 0) {
                lines.push(`    Entities: ${hook.involvedEntities.join(', ')}`);
            }
        }
        lines.push('');
    }

    const activeExposures = Object.entries(factionExposure)
        .filter(([, e]) => e.exposureScore > 0)
        .sort((a, b) => b[1].exposureScore - a[1].exposureScore);

    if (activeExposures.length > 0) {
        lines.push('FACTION EXPOSURE (≥20 required to pass Origin Test C):');
        for (const [name, entry] of activeExposures) {
            const filled = Math.floor(entry.exposureScore / 10);
            const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
            lines.push(`  ${name}: [${bar}] ${entry.exposureScore}/100`);
        }
        lines.push('');
    }

    lines.push('If no dormant hook ID matches and no player action this session caused this,');
    lines.push('and no faction above has score ≥ 20, the threat seed is FORBIDDEN.');
    lines.push('[END ORIGIN GATE CONTEXT]');

    return lines.join('\n');
};

// --- v1.17: Threat Suppression Context ---
const buildThreatSuppressionContext = (
    currentTurn: number,
    globalCooldownUntil?: number,
    denialTracker?: ThreatDenialTracker
): string => {
    let context = '';

    // 1. Global Cooldown Status
    if (globalCooldownUntil && globalCooldownUntil > currentTurn) {
        const remaining = globalCooldownUntil - currentTurn;
        context += `[GLOBAL THREAT COOLDOWN ACTIVE]\n`;
        context += `The simulation is currently in a cooldown period for ${remaining} more turn(s).\n`;
        context += `DO NOT generate any new emerging threats during this time.\n`;
        context += `Focus entirely on narrative progression, NPC actions, and environment changes.\n\n`;
    }

    // 2. Suppressed Entities
    // v1.18: Only show multi-word entity names. Single-word fragments like
    // "nathan", "mana", "high", "city" polluted the AI's instructions and
    // prevented it from mentioning the player character or common setting terms.
    if (denialTracker) {
        const suppressed = Object.entries(denialTracker)
            .filter(([name, entry]) =>
                entry.denialCount >= DENIAL_SUPPRESSION_THRESHOLD && name.includes(' ')
            )
            .map(([name, _]) => name);

        if (suppressed.length > 0) {
            context += `[SUPPRESSED ENTITIES]\n`;
            context += `The following entities have been blocked by the Origin Gate too many times and are now SUPPRESSED:\n`;
            context += suppressed.map(name => `- ${name}`).join('\n') + '\n';
            context += `DO NOT use these entities in threats, NPC actions, or environment changes.\n\n`;
        }
    }

    return context;
};

/**
 * Builds a condition lock block when the player has manually removed conditions.
 * Informs the AI that these conditions were deliberately cleared and must NOT
 * be re-added via character_updates unless strong new narrative evidence justifies it.
 */
const buildConditionLock = (playerRemovedConditions: string[]): string => {
    if (!playerRemovedConditions || playerRemovedConditions.length === 0) return '';
    const list = playerRemovedConditions.map(c => `- ${c}`).join('\n');
    return `
[⚠ CONDITION LOCK — PLAYER-CLEARED STATES]
The player manually removed the following conditions this turn. Do NOT re-add them via
\`character_updates.added_conditions\` unless this turn's narrative contains a direct,
specific new cause for each condition. "The character is still dehydrated" is NOT sufficient —
you must describe a concrete new event that would cause the condition to return.
Player action already addressed these conditions. Respect that.

CLEARED CONDITIONS (do not re-add without new narrative cause):
${list}
    `.trim();
};

/**
 * v1.19 — Dream/Nightmare Seed Builder
 *
 * Returns a [DREAM SEED] block when the player is sleeping AND the character's
 * trauma is at or above DREAM_TRAUMA_THRESHOLD AND at least one memory fragment
 * exists. The seeded fragment is handed to the AI, which renders a bracketed
 * [DREAM]...[/DREAM] non-canonical scene per the Section 11 protocol in
 * systemInstructions.ts.
 *
 * Intentionally returns '' when conditions are not met — this keeps the default
 * (no dream) cheap and keeps dreams rare and dramatic.
 */
const buildDreamSeed = (
    character: Character,
    world: GameWorld,
    userInput: string
): string => {
    if ((character.trauma ?? 0) < DREAM_TRAUMA_THRESHOLD) return '';
    const input = userInput.toLowerCase();
    const isSleeping = SLEEP_KEYWORDS.some(kw => input.includes(kw));
    if (!isSleeping) return '';

    const pool = world.memory ?? [];
    if (pool.length === 0) return '';

    // Weight recent memories slightly higher (last 10 get 2x weight).
    const recent = pool.slice(-10);
    const weighted = [...pool, ...recent];
    const picked = weighted[Math.floor(Math.random() * weighted.length)];

    return `
[DREAM SEED — NIGHTMARE TRIGGER ACTIVE]
The player is sleeping. Character trauma is ${character.trauma}/100 (≥ ${DREAM_TRAUMA_THRESHOLD}).
A dream MUST be rendered this turn, per Section 11 of the system instructions.

Seed fragment (the dream should riff on, distort, or re-contextualize this memory — do NOT retell it literally):
  "${picked.fact}"

REQUIRED OUTPUT:
- Open the narrative with "[DREAM]" on its own line.
- Render a non-canonical sensory/symbolic scene. Distorted time, impossible
  geography, and symbolic stand-ins for NPCs are all permitted.
- No roll_request. No emerging_threats. No legal events. No location change.
- End with the PC waking (breath, sweat, sheets, heartbeat, the real room).
- Close with "[/DREAM]" on its own line, then render the brief waking beat.
- Set \`time_passed_minutes\` to 0–3 (just the waking moment; sleep time is
  already counted upstream).
- Apply \`character_updates.trauma_delta\`:
    +5 to +15 if the dream re-traumatizes or opens an unresolved wound,
    -3 to -10 if the dream lets the character process or integrate.
  Never submit 0 — the dream must move the trauma needle.
`.trim();
};

export const constructGeminiPrompt = (
  gameHistory: GameHistory,
  gameWorld: GameWorld,
  character: Character,
  userInput: string,
  playerRemovedConditions: string[] = [],
  modelName: string = 'gemini-3-flash-preview',        // v1.21
  historicalSummary?: string                             // v1.21: Moved from geminiClient
): PromptResult => {
  // v1.21: Resolve model-specific context limits
  const profile = getContextProfile(modelName);

  // 1. RAG Retrieval — use model-adaptive limits and lookback
  const activeThreatNames = (gameWorld.activeThreats || []).map(t => t.name);
  const { relevantLore, relevantEntities, debugInfo } = retrieveRelevantContext(
    userInput,
    gameHistory.history,
    gameWorld.lore,
    gameWorld.knownEntities || [],
    activeThreatNames,
    profile.loreLimitOverride,   // v1.21: model-adaptive
    profile.entityLimitOverride, // v1.21: model-adaptive
    profile.ragLookback          // v1.21: wider lookback for better entity recall
  );

  // 2. Build Context Strings — memory now capped by model profile
  const memoryContext = buildMemoryContext(gameWorld.memory, profile.memoryLimit);
  const loreContext = buildLoreContext(relevantLore);
  const knownEntitiesContext = buildEntityContext(relevantEntities);

  // 3. Narrative Intent & State
  const lowerInput = userInput.toLowerCase();
  const isDowntime = DOWNTIME_KEYWORDS.some(kw => lowerInput.includes(kw));
  const tension = gameWorld.tensionLevel || 0;
  const currentMode = gameWorld.sceneMode || 'NARRATIVE';
  const timeDisplay = gameWorld.time?.display || "Day 1, 09:00";

  // 4. Build Instructions
  const bioStatus = buildBioStatus(character.bio, timeDisplay);
  const pacingInstruction = buildPacingInstruction(tension, currentMode, isDowntime);
  const characterBlock = buildCharacterBlock(character);

  // v1.19: Section reminders removed from here — they are now appended as a
  // trailing suffix on the user message in useGeminiClient.ts → sendMessage()
  // to exploit Gemini's recency bias for better compliance.
  
  // 6. World Pressure (v1.1)
  const worldPressure = buildWorldPressure(
      relevantEntities,
      gameHistory.turnCount,
      gameWorld.lastWorldTickTurn ?? 0
  );

  // 7. Narrative Integrity Guards (v1.2)
  const encounterScopeLock = buildEncounterScopeLock(gameWorld.activeThreats || []);
  const conditionLock = buildConditionLock(playerRemovedConditions);

  // v1.6: Origin Gate context
  const dormantHooksContext = buildDormantHooksContext(
      gameWorld.dormantHooks ?? [],
      gameWorld.factionExposure ?? {}
  );

  // v1.17: Threat Suppression Context
  const suppressionContext = buildThreatSuppressionContext(
      gameHistory.turnCount,
      gameWorld.threatCooldownUntilTurn,
      gameWorld.threatDenialTracker
  );

  // Stream 4: Trauma Narrative Effects
  const traumaBlock = buildTraumaPromptBlock(character.trauma, gameWorld.activeTraumaEffect);

  // Stream 6: Faction-Scale Conflict
  const factionBlock = buildFactionPromptBlock(gameWorld.factions ?? [], gameWorld.factionConflicts ?? []);

  // Stream 7: World Rules Injection
  const worldRulesBlock = gameWorld.worldRules && gameWorld.worldRules.length > 0
    ? `[WORLD RULES]\n${gameWorld.worldRules.map(rule => `- ${rule}`).join('\n')}`
    : '';

  // v1.7: Final sanitisation pass — ensure no banned names leak into prompt
  const nameMap = gameWorld.bannedNameMap ?? {};
  const sanitise = (s: string) => applyExistingMap(s, nameMap);

  // v1.21: Situation Recap — concise anchor at the top of dynamic context
  const situationRecap = buildSituationRecap(character, gameWorld, gameHistory.history);

  // v1.19: Dream/Nightmare seed — only injected when the player is sleeping
  // and trauma ≥ DREAM_TRAUMA_THRESHOLD. Empty string otherwise.
  const dreamSeed = buildDreamSeed(character, gameWorld, userInput);

  // v1.21: Historical summary now lives in the dynamic prompt (top position)
  // instead of being appended to the end of 63KB system instructions where
  // lite models can't attend to it.
  const summaryBlock = historicalSummary
      ? `[PREVIOUSLY ON...]\n${sanitise(historicalSummary)}\n`
      : '';

  // 8. Assembly
  const promptString = `
${summaryBlock}
${sanitise(situationRecap)}
${sanitise(dreamSeed ? `\n${dreamSeed}\n` : '')}

[CONTEXT]
${sanitise(memoryContext)}
${sanitise(loreContext)}
${sanitise(knownEntitiesContext)}

[CURRENT ATMOSPHERE]
Mode: ${currentMode}
Tension Level: ${tension}/100

${sanitise(bioStatus)}

[HIDDEN_REGISTRY]
${sanitise(suppressionContext ? suppressionContext : '')}${sanitise(dormantHooksContext ? dormantHooksContext + '\n\n' : '')}${sanitise(gameWorld.hiddenRegistry)}

${sanitise(characterBlock)}

${sanitise(pacingInstruction)}

${sanitise(traumaBlock)}

${sanitise(factionBlock)}

${sanitise(worldRulesBlock ? `\n${worldRulesBlock}\n` : '')}

${sanitise(worldPressure ? `\n${worldPressure}\n` : '')}
${sanitise(encounterScopeLock ? `\n${encounterScopeLock}\n` : '')}
${sanitise(conditionLock ? `\n${conditionLock}\n` : '')}

[STRICT INPUT RULES]
1. If the user input is mundane ("I look around"), do NOT ask for a roll. Just describe.
2. If the user input is social ("I talk to him"), do NOT ask for a Charisma roll. Write the dialogue.
3. Analyze the user's intent in your 'thought_process' first.
4. Estimate \`time_passed_minutes\` accurately.
5. Check the current Conditions list before adding new ones. Do NOT add conditions that semantically duplicate existing ones (e.g., do not add "Broken Left Arm" if "Left Arm Fractured" already exists). If a condition worsens, REMOVE the old one and ADD the new severity.
6. Populate \`world_tick\` with at least one NPC action. The world does not pause.

`;

  return {
      prompt: promptString,
      ragDebug: debugInfo
  };
};