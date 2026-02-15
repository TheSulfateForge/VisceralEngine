
import { LoreItem, KnownEntity, ChatMessage, Role } from '../types';

const STOP_WORDS = new Set([
  'i', 'me', 'my', 'the', 'a', 'an', 'is', 'are', 'was', 'were',
  'to', 'of', 'in', 'on', 'at', 'for', 'and', 'or', 'but', 'not',
  'it', 'this', 'that', 'with', 'from', 'they', 'them', 'he', 'she',
  'do', 'does', 'did', 'will', 'would', 'could', 'should', 'have', 'has',
  'been', 'be', 'so', 'if', 'then', 'than', 'too', 'very', 'just',
  'about', 'up', 'out', 'into', 'over', 'after', 'before', 'some', 'what'
]);

/**
 * Tokenize a string into a Set of lowercase words, stripping stop words and
 * anything under 2 characters.
 */
function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))
  );
}

/**
 * Build a context query from user input PLUS the last N model messages.
 * This is critical — if the user says "I attack him", the NPC name is in
 * the recent model output, not the user input.
 */
function buildContextQuery(userInput: string, recentHistory: ChatMessage[], lookback: number = 3): Set<string> {
  const modelTexts = recentHistory
    .filter(m => m.role === Role.MODEL)
    .slice(-lookback)
    .map(m => m.text)
    .join(' ');

  return tokenize(`${userInput} ${modelTexts}`);
}

/**
 * Check if any token from the query appears in the target text.
 * Simple substring/includes matching — more reliable than Jaccard for
 * short keyword fields like entity names and lore keywords.
 */
function hasOverlap(queryTokens: Set<string>, targetText: string): boolean {
  const targetLower = targetText.toLowerCase();
  for (const token of queryTokens) {
    if (targetLower.includes(token)) return true;
  }
  return false;
}

export interface RAGResult {
  relevantLore: LoreItem[];
  relevantEntities: KnownEntity[];
  debugInfo: {
    totalLore: number;
    filteredLore: number;
    totalEntities: number;
    filteredEntities: number;
    queryTokens: string[];
  };
}

/**
 * Main retrieval function. Returns only lore and entities that are
 * contextually relevant to the current turn.
 *
 * Always-include rules:
 * - Entities with relationship_level ALLIED or DEVOTED (important NPCs)
 * - Entities currently in active combat (matched by activeThreats names)
 * - Up to `loreLimit` lore items and `entityLimit` entities
 */
export function retrieveRelevantContext(
  userInput: string,
  recentHistory: ChatMessage[],
  lore: LoreItem[],
  knownEntities: KnownEntity[],
  activeThreatNames: string[],
  loreLimit: number = 10,
  entityLimit: number = 8
): RAGResult {
  const queryTokens = buildContextQuery(userInput, recentHistory);

  // --- Filter Lore ---
  const scoredLore = lore.map(item => ({
    item,
    relevant: hasOverlap(queryTokens, `${item.keyword} ${item.content}`)
  }));

  const relevantLore = scoredLore
    .filter(s => s.relevant)
    .map(s => s.item)
    .slice(0, loreLimit);

  // --- Filter Entities ---
  const HIGH_PRIORITY_LEVELS = new Set(['ALLIED', 'DEVOTED']);
  const threatNameSet = new Set(activeThreatNames.map(n => n.toLowerCase()));

  const relevantEntities: KnownEntity[] = [];
  const secondaryEntities: KnownEntity[] = [];

  for (const entity of knownEntities) {
    const isHighPriority = HIGH_PRIORITY_LEVELS.has(entity.relationship_level);
    const isInCombat = threatNameSet.has(entity.name.toLowerCase());
    const isContextual = hasOverlap(queryTokens, `${entity.name} ${entity.role} ${entity.location}`);

    if (isHighPriority || isInCombat) {
      relevantEntities.push(entity); // Always include
    } else if (isContextual) {
      secondaryEntities.push(entity);
    }
  }

  // Fill remaining slots with contextually matched entities
  const remainingSlots = Math.max(0, entityLimit - relevantEntities.length);
  relevantEntities.push(...secondaryEntities.slice(0, remainingSlots));

  return { 
      relevantLore, 
      relevantEntities,
      debugInfo: {
          totalLore: lore.length,
          filteredLore: relevantLore.length,
          totalEntities: knownEntities.length,
          filteredEntities: relevantEntities.length,
          queryTokens: Array.from(queryTokens).slice(0, 20)
      }
  };
}
