
import { GameHistory, GameWorld, Character, SceneMode, MemoryItem, LoreItem, KnownEntity, BioMonitor } from '../types';
import { retrieveRelevantContext, RAGResult } from './ragEngine';
import { getSectionReminder } from '../sectionReminders';

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
    return `
**Primary Directive: Player Character Data**
This is the player character. This data is ABSOLUTE TRUTH.
- **Name:** ${character.name} (${character.gender}, ${character.race})
- **Appearance:** ${character.appearance}
- **Markings:** ${character.notableFeatures}
- **Backstory:** ${character.backstory}
- **Setting:** ${character.setting}
- **Inventory:** ${character.inventory.join(', ')}
- **Conditions:** ${character.conditions.join(', ')}
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
        .filter(e => e.relationship_level !== 'NEUTRAL' || e.ledger.length > 2)
        .slice(0, 6) // Cap to avoid prompt bloat
        .map(e => `- ${e.name} [${e.relationship_level}]: "${e.impression}" — Ledger: ${e.ledger.slice(-2).join('; ')}`)
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

export const constructGeminiPrompt = (
  gameHistory: GameHistory,
  gameWorld: GameWorld,
  character: Character,
  userInput: string
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

  // 7. Assembly
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