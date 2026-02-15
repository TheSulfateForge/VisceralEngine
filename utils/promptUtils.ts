import { GameHistory, GameWorld, Character } from '../types';
import { retrieveRelevantContext } from './ragEngine';

const DOWNTIME_KEYWORDS = [
  'sleep', 'rest', 'wait', 'camp', 'hide', 
  'relax', 'craft', 'recover', 'read', 'eat', 
  'drink', 'bath', 'wash', 'clean', 'sit',
  'meditate', 'heal', 'study', 'walk', 'travel',
  'say', 'ask', 'tell', 'shout', 'whisper', 'talk', 'kiss', 'hug'
];

export const constructGeminiPrompt = (
  gameHistory: GameHistory,
  gameWorld: GameWorld,
  character: Character,
  userInput: string
): string => {
  // Memory is always injected in full — it's compact and globally relevant
  const memoryContext = gameWorld.memory.map(m => `• ${m.fact}`).join('\n');

  // RAG: Filter lore and entities by contextual relevance
  const activeThreatNames = (gameWorld.activeThreats || []).map(t => t.name);
  const { relevantLore, relevantEntities } = retrieveRelevantContext(
    userInput,
    gameHistory.history,
    gameWorld.lore,
    gameWorld.knownEntities || [],
    activeThreatNames
  );

  const loreContext = relevantLore.map(l => `[${l.keyword}]: ${l.content}`).join('\n');
  
  const knownEntitiesContext = relevantEntities.length > 0
    ? `\n[KNOWN ENTITY REGISTRY - SOCIAL & MEMORY]\n` + relevantEntities.map(e => 
        `ID: ${e.id}
         Name: ${e.name} (${e.role})
         Location: ${e.location}
         Current State: [${e.relationship_level}] - ${e.impression}
         Leverage: ${e.leverage}
         Ledger (Memories): [${e.ledger.join(', ')}]`
      ).join('\n----------------\n')
    : "";

  // Narrative Intent Detection
  const lowerInput = userInput.toLowerCase();
  const isDowntime = DOWNTIME_KEYWORDS.some(kw => lowerInput.includes(kw));

  // Determine current atmospheric pressure
  const tension = gameWorld.tensionLevel || 0;
  const currentMode = gameWorld.sceneMode || 'NARRATIVE';

  // --- CHRONOS & BIO CONTEXT ---
  const timeDisplay = gameWorld.time?.display || "Day 1, 09:00";
  const bio = character.bio || { 
      metabolism: { calories: 80, hydration: 80, stamina: 100, libido: 5 }, 
      pressures: { bladder: 0, bowels: 0, lactation: 0, seminal: 0 },
      timestamps: { lastSleep: 0, lastMeal: 0, lastOrgasm: 0 },
      modifiers: { calories: 1.0, hydration: 1.0, stamina: 1.0, lactation: 1.0 }
  };
  
  const bioStatus = `
[BIOLOGICAL STATUS]
Time: ${timeDisplay}
Calories: ${Math.round(bio.metabolism.calories)}/100 ${bio.metabolism.calories < 40 ? "(HUNGRY)" : ""}
Hydration: ${Math.round(bio.metabolism.hydration)}/100 ${bio.metabolism.hydration < 40 ? "(THIRSTY)" : ""}
Stamina: ${Math.round(bio.metabolism.stamina)}/100
Lactation Pressure: ${Math.round(bio.pressures.lactation)}%

[ACTIVE MODIFIERS] (1.0 = Base)
Calorie Burn: x${bio.modifiers.calories}
Water Burn: x${bio.modifiers.hydration}
Stamina Burn: x${bio.modifiers.stamina}
Lactation Rate: x${bio.modifiers.lactation}
  `;

  let pacingInstruction = `
[PACING: NEUTRAL]
The simulation is running standard narrative protocols.
  `;

  if (tension > 70 || currentMode === 'COMBAT') {
      pacingInstruction = `
[PACING: HIGH TENSION / SURVIVAL]
1. Focus on survival, adrenaline, and rapid consequences.
2. Short, punchy sentences.
3. If the user hesitates, the threat advances.
      `;
  } else if (isDowntime || currentMode === 'SOCIAL') {
      pacingInstruction = `
[PACING: SLOW / SOCIAL]
1. DETAILED SENSORY FOCUS. Describe the environment's texture, smell, and temperature.
2. FORCE NPC INTERACTION. If the player speaks, the NPC *must* reply with dialogue.
3. NO COMBAT SPAWNS. Do not interrupt this scene with random attacks.
      `;
  }

  return `
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

${pacingInstruction}

[STRICT INPUT RULES]
1. If the user input is mundane ("I look around"), do NOT ask for a roll. Just describe.
2. If the user input is social ("I talk to him"), do NOT ask for a Charisma roll. Write the dialogue.
3. Analyze the user's intent in your 'thought_process' first.
4. Estimate \`time_passed_minutes\` accurately.

[INPUT]
${userInput}
`;
};