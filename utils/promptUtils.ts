import { GameHistory, GameWorld, Character, SceneMode, MemoryItem, LoreItem, KnownEntity, BioMonitor, ActiveThreat } from '../types';
import { retrieveRelevantContext, RAGResult } from './ragEngine';
import { getSectionReminder } from '../sectionReminders';
import { partitionConditions } from './contentValidation';

const DOWNTIME_KEYWORDS = [
  'sleep', 'rest', 'wait', 'camp', 'hide', 
  'relax', 'craft', 'recover', 'read', 'eat', 
  'drink', 'bath', 'wash', 'clean', 'sit',
  'meditate', 'heal', 'study', 'walk', 'travel',
  'say', 'ask', 'tell', 'shout', 'whisper', 'talk', 'kiss', 'hug'
];

export interface PromptResult {
    prompt: string;
    ragDebug: RAGResult['debugInfo'];
}

// --- Builder Functions ---

const buildMemoryContext = (memory: MemoryItem[]): string => {
    if (memory.length === 0) return "";
    return memory.map(m => `• ${m.fact}`).join('\n');
};

const buildLoreContext = (lore: LoreItem[]): string => {
    if (lore.length === 0) return "";
    return lore.map(l => `[${l.keyword}]: ${l.content}`).join('\n');
};

const buildEntityContext = (entities: KnownEntity[]): string => {
    if (entities.length === 0) return "";
    
    const entityStrings = entities.map(e => 
        `ID: ${e.id}
         Name: ${e.name} (${e.role})
         Location: ${e.location}
         Current State: [${e.relationship_level}] - ${e.impression}
         Leverage: ${e.leverage}
         Ledger (Memories): [${e.ledger.join(', ')}]`
    ).join('\n----------------\n');

    return `\n[KNOWN ENTITY REGISTRY - SOCIAL & MEMORY]\n${entityStrings}`;
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
    const { active: activeConditions, traits } = partitionConditions(character.conditions);

    const traitsSection = traits.length > 0
        ? `\n- **Character Traits (fixed, do NOT add/remove via character_updates):**\n${traits.map(t => `  • ${t}`).join('\n')}`
        : '';

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
- **Goals:** ${character.goals.join(', ')}
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

export const constructGeminiPrompt = (
  gameHistory: GameHistory,
  gameWorld: GameWorld,
  character: Character,
  userInput: string,
  playerRemovedConditions: string[] = []
): PromptResult => {
  // 1. RAG Retrieval
  const activeThreatNames = (gameWorld.activeThreats || []).map(t => t.name);
  const { relevantLore, relevantEntities, debugInfo } = retrieveRelevantContext(
    userInput,
    gameHistory.history,
    gameWorld.lore,
    gameWorld.knownEntities || [],
    activeThreatNames
  );

  // 2. Build Context Strings
  const memoryContext = buildMemoryContext(gameWorld.memory);
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

  // 5. Section Reminders
  const sectionRefresh = getSectionReminder(
    gameHistory.turnCount,
    currentMode as SceneMode
  );
  
  // 6. World Pressure (v1.1)
  const worldPressure = buildWorldPressure(
      relevantEntities,
      gameHistory.turnCount,
      gameWorld.lastWorldTickTurn ?? 0
  );

  // 7. Narrative Integrity Guards (v1.2)
  const encounterScopeLock = buildEncounterScopeLock(gameWorld.activeThreats || []);
  const conditionLock = buildConditionLock(playerRemovedConditions);

  // 8. Assembly
  const promptString = `
[CONTEXT]
${memoryContext}
${loreContext}
${knownEntitiesContext}

[CURRENT ATMOSPHERE]
Mode: ${currentMode}
Tension Level: ${tension}/100

${bioStatus}

[HIDDEN_REGISTRY]
${gameWorld.hiddenRegistry}

${characterBlock}

${pacingInstruction}

${worldPressure ? `\n${worldPressure}\n` : ''}
${encounterScopeLock ? `\n${encounterScopeLock}\n` : ''}
${conditionLock ? `\n${conditionLock}\n` : ''}

[STRICT INPUT RULES]
1. If the user input is mundane ("I look around"), do NOT ask for a roll. Just describe.
2. If the user input is social ("I talk to him"), do NOT ask for a Charisma roll. Write the dialogue.
3. Analyze the user's intent in your 'thought_process' first.
4. Estimate \`time_passed_minutes\` accurately.
5. Check the current Conditions list before adding new ones. Do NOT add conditions that semantically duplicate existing ones (e.g., do not add "Broken Left Arm" if "Left Arm Fractured" already exists). If a condition worsens, REMOVE the old one and ADD the new severity.
6. Populate \`world_tick\` with at least one NPC action. The world does not pause.

${sectionRefresh ? `\n${sectionRefresh}\n` : ''}
[INPUT]
${userInput}
`;

  return {
      prompt: promptString,
      ragDebug: debugInfo
  };
};