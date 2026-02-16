
import { LoreItem, KnownEntity, ChatMessage, Role } from '../types';

// Extended Stop Words list for better noise filtering
const STOP_WORDS = new Set([
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours',
  'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', 'her', 'hers',
  'herself', 'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves',
  'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'am', 'is', 'are',
  'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does',
  'did', 'doing', 'a', 'an', 'the', 'and', 'but', 'if', 'or', 'because', 'as', 'until',
  'while', 'of', 'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down',
  'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here',
  'there', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so',
  'than', 'too', 'very', 's', 't', 'can', 'will', 'just', 'don', 'should', 'now',
  'would', 'could'
]);

interface TokenAnalysis {
  unigrams: Set<string>;
  bigrams: Set<string>;
}

/**
 * Normalizes text and extracts unigrams and bigrams.
 * Bi-grams help capture compound concepts like "broken arm" or "plasma rifle".
 */
function analyzeText(text: string): TokenAnalysis {
  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));

  const unigrams = new Set(words);
  const bigrams = new Set<string>();

  for (let i = 0; i < words.length - 1; i++) {
    bigrams.add(`${words[i]} ${words[i + 1]}`);
  }

  return { unigrams, bigrams };
}

/**
 * Build a query analysis from user input and recent model context.
 * Including recent history ensures we catch references to things the AI just said.
 */
function analyzeQuery(userInput: string, recentHistory: ChatMessage[], lookback: number = 3): TokenAnalysis {
  const modelTexts = recentHistory
    .filter(m => m.role === Role.MODEL)
    .slice(-lookback)
    .map(m => m.text)
    .join(' ');

  return analyzeText(`${userInput} ${modelTexts}`);
}

/**
 * Calculates IDF (Inverse Document Frequency) map for a corpus.
 * IDF(t) = log(1 + (N / (1 + df(t))))
 * penalizes very common words.
 */
function calculateIDF(documents: TokenAnalysis[]): Map<string, number> {
  const df = new Map<string, number>();
  const N = documents.length;

  for (const doc of documents) {
    const seen = new Set([...doc.unigrams, ...doc.bigrams]);
    for (const token of seen) {
      df.set(token, (df.get(token) || 0) + 1);
    }
  }

  const idf = new Map<string, number>();
  for (const [token, count] of df) {
    // Smoothed IDF
    idf.set(token, Math.log(1 + (N / (1 + count))));
  }
  return idf;
}

/**
 * Scores a document against a query using TF-IDF principles.
 * Since documents are short snippets, we treat TF (Term Frequency) as binary (1 or 0) mostly,
 * effectively summing IDF values of matching terms.
 * Bigrams are given a 2.5x multiplier to prioritize phrase matches.
 */
function scoreDocument(doc: TokenAnalysis, query: TokenAnalysis, idf: Map<string, number>): number {
  let score = 0;

  // Score Unigrams
  for (const token of query.unigrams) {
    if (doc.unigrams.has(token)) {
      score += (idf.get(token) || 0);
    }
  }

  // Score Bigrams (Higher Weight for exact phrase matches)
  for (const token of query.bigrams) {
    if (doc.bigrams.has(token)) {
      score += (idf.get(token) || 0) * 2.5; 
    }
  }

  return score;
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
    topScores: { name: string; score: number }[];
  };
}

export function retrieveRelevantContext(
  userInput: string,
  recentHistory: ChatMessage[],
  lore: LoreItem[],
  knownEntities: KnownEntity[],
  activeThreatNames: string[],
  loreLimit: number = 8,
  entityLimit: number = 6
): RAGResult {
  // 1. Analyze Query
  const queryAnalysis = analyzeQuery(userInput, recentHistory);
  
  // 2. Prepare Corpus & Analyze Documents
  // We treat Lore and Entities as a single corpus for IDF calculation to normalize term weights globally
  
  interface ScoredItem<T> {
    item: T;
    analysis: TokenAnalysis;
    score: number;
    type: 'lore' | 'entity';
    isMandatory: boolean;
    id: string;
    name: string; // for debug
  }

  const items: ScoredItem<LoreItem | KnownEntity>[] = [];
  const HIGH_PRIORITY_LEVELS = new Set(['ALLIED', 'DEVOTED']);
  const threatNameSet = new Set(activeThreatNames.map(n => n.toLowerCase()));

  // Process Lore
  for (const l of lore) {
    items.push({
      item: l,
      analysis: analyzeText(`${l.keyword} ${l.content}`),
      score: 0,
      type: 'lore',
      isMandatory: false,
      id: l.id,
      name: l.keyword
    });
  }

  // Process Entities
  for (const e of knownEntities) {
    const isPriority = HIGH_PRIORITY_LEVELS.has(e.relationship_level);
    const isThreat = threatNameSet.has(e.name.toLowerCase());
    // Entities that are in the room or highly important are "Mandatory"
    const isMandatory = isPriority || isThreat;
    
    items.push({
      item: e,
      analysis: analyzeText(`${e.name} ${e.role} ${e.location} ${e.impression}`),
      score: 0,
      type: 'entity',
      isMandatory,
      id: e.id,
      name: e.name
    });
  }

  // 3. Calculate IDF for the active corpus
  const idfMap = calculateIDF(items.map(i => i.analysis));

  // 4. Score Documents
  for (const doc of items) {
    doc.score = scoreDocument(doc.analysis, queryAnalysis, idfMap);
    
    // Boost mandatory items to ensure they survive the sort, 
    // but we will also handle them specifically in filtering
    if (doc.isMandatory) {
        doc.score += 50.0; // Massive boost ensures they are top rank
    }
  }

  // 5. Rank & Select
  items.sort((a, b) => b.score - a.score);

  const selectedLore: LoreItem[] = [];
  const selectedEntities: KnownEntity[] = [];
  const debugScores: { name: string; score: number }[] = [];

  // Filter Lore
  const loreCandidates = items.filter(i => i.type === 'lore');
  for (const candidate of loreCandidates) {
    if (selectedLore.length < loreLimit && candidate.score > 0.5) {
      selectedLore.push(candidate.item as LoreItem);
      debugScores.push({ name: candidate.name, score: Number(candidate.score.toFixed(2)) });
    }
  }

  // Filter Entities
  const entityCandidates = items.filter(i => i.type === 'entity');
  for (const candidate of entityCandidates) {
    const isSlotAvailable = selectedEntities.length < entityLimit;
    const isRelevant = candidate.score > 0.5;
    
    // Always include mandatory items, otherwise respect limits and score threshold
    if (candidate.isMandatory || (isSlotAvailable && isRelevant)) {
        selectedEntities.push(candidate.item as KnownEntity);
        // Only log non-mandatory high scores to keep debug noise down, or all? Let's log all included.
        debugScores.push({ name: candidate.name, score: Number(candidate.score.toFixed(2)) });
    }
  }

  return {
    relevantLore: selectedLore,
    relevantEntities: selectedEntities,
    debugInfo: {
      totalLore: lore.length,
      filteredLore: selectedLore.length,
      totalEntities: knownEntities.length,
      filteredEntities: selectedEntities.length,
      queryTokens: [...queryAnalysis.unigrams, ...queryAnalysis.bigrams],
      topScores: debugScores.slice(0, 8)
    }
  };
}
