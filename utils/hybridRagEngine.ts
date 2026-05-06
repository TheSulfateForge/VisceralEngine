// ============================================================================
// utils/hybridRagEngine.ts
//
// Phase 2 retrieval. Augments the existing TF-IDF/bigram lexical scoring in
// `ragEngine.ts` with cosine similarity over local embeddings.
//
//   finalScore =
//     0.55 * semanticSimilarity     // cosine(query_vec, doc_vec)
//   + 0.25 * lexicalScore           // existing TF-IDF, normalised to [0..1]
//   + 0.10 * salienceBoost          // memories: salience/5
//   + 0.05 * recencyBoost           // exp(-(currentTurn - turnCreated)/30)
//   +        mandatoryEntityBoost   // 1.0 for entities the player just named
//   +        pinnedBoost            // 0.3 for pinned memories
//
// Items without embeddings degrade gracefully: their semantic component is
// zero, so they're scored on lexical+boosts alone. That means cold-start
// retrieval still works while the backfill is running.
//
// This module does NOT replace `ragEngine.ts`. Both can coexist; opt into
// hybrid retrieval at the prompt-builder layer when ready.
// ============================================================================
import {
  ChatMessage,
  KnownEntity,
  LoreItem,
  MemoryItem,
  SummarySegment,
  Role,
  SaveId,
} from '../types';
import {
  analyzeText,
  analyzeQuery,
  calculateIDF,
  scoreDocument,
  findAliasMatchedEntities,
  RAGResult,
} from './ragEngine';
import { embeddingService } from '../services/embeddingService';
import { embeddingsRepo } from '../db/repos/embeddings';
import { EmbeddingRow, EmbeddingOwnerKind } from '../db/schema';
import {
  memorySourceText,
  loreSourceText,
  entitySourceText,
  summarySegmentSourceText,
} from './embeddingSources';

// ────────────────────────────────────────────────────────────────────────────
// Tunables
// ────────────────────────────────────────────────────────────────────────────
const W_SEMANTIC = 0.55;
const W_LEXICAL = 0.25;
const W_SALIENCE = 0.10;
const W_RECENCY = 0.05;
const MANDATORY_BOOST = 1.0;
const PINNED_BOOST = 0.3;
const RECENCY_TAU = 30;             // turns
const PINNED_TAGS = new Set([
  'vow', 'oath', 'debt', 'reveal', 'death', 'identity', 'betrayal',
]);

const PRIORITY_LEVELS = new Set(['ALLIED', 'DEVOTED']);

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────
function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) s += a[i] * b[i];
  return s;
}

function recencyBoost(currentTurn: number, turnCreated: number | undefined): number {
  if (!currentTurn || turnCreated === undefined) return 0;
  const age = Math.max(0, currentTurn - turnCreated);
  return Math.exp(-age / RECENCY_TAU);
}

function buildEmbMap(rows: EmbeddingRow[]): Map<string, Float32Array> {
  const m = new Map<string, Float32Array>();
  for (const r of rows) m.set(`${r.owner_kind}:${r.owner_id}`, r.vector);
  return m;
}

// Storage layer (db/projection.ts) prefixes engine IDs with `${campaignId}::`
// so they can't collide across campaigns. Embeddings owner_id therefore uses
// the prefixed form, but in-memory items (LoreItem.id, KnownEntity.id,
// MemoryItem.id) use the raw engine ID. These helpers bridge the two.
const ID_SEP = '::';
function stampEmbKey(cid: SaveId, id: string | null | undefined): string {
  if (!id) return '';
  // If already stamped (post-fix data), pass through; else prepend.
  return id.startsWith(`${cid}${ID_SEP}`) ? id : `${cid}${ID_SEP}${id}`;
}

function normaliseLexical(score: number, maxLexical: number): number {
  if (maxLexical <= 0) return 0;
  return score / maxLexical;
}

// ────────────────────────────────────────────────────────────────────────────
// Context bundle — pre-fetched once per turn so we don't hit IndexedDB
// inside the scoring loop.
// ────────────────────────────────────────────────────────────────────────────
export interface HybridContext {
  campaignId: SaveId;
  embeddings: EmbeddingRow[];
  queryVector: Float32Array | null;        // null when embedder unavailable
  queryText: string;
}

export async function buildHybridContext(
  campaignId: SaveId,
  userInput: string,
  recentHistory: ChatMessage[],
  lookback: number = 5
): Promise<HybridContext> {
  // 1. Build the query string the embedder sees: user input + last few turns
  //    of either party, mirroring the lexical analyzer's recall window.
  const tail = recentHistory
    .filter((m) => m.role === Role.USER || m.role === Role.MODEL)
    .slice(-lookback)
    .map((m) => m.text)
    .join(' ');
  const queryText = `${userInput} ${tail}`.trim();

  // 2. Try to encode. If the embedder isn't available (cold start failure,
  //    no Worker, etc.) we fall through with a null vector and the caller
  //    degrades to lexical-only.
  let queryVector: Float32Array | null = null;
  try {
    queryVector = await embeddingService.encode(queryText);
  } catch (err) {
    console.warn('[hybridRagEngine] query encoding failed, falling back to lexical:', err);
  }

  // 3. Load all embeddings for this campaign in one query.
  const embeddings = await embeddingsRepo.listForCampaign(campaignId);

  return { campaignId, embeddings, queryVector, queryText };
}

// ────────────────────────────────────────────────────────────────────────────
// Lore + Entities (drop-in replacement for retrieveRelevantContext)
// ────────────────────────────────────────────────────────────────────────────
export function retrieveRelevantContextHybrid(
  ctx: HybridContext,
  userInput: string,
  recentHistory: ChatMessage[],
  lore: LoreItem[],
  knownEntities: KnownEntity[],
  activeThreatNames: string[],
  loreLimit: number = 8,
  entityLimit: number = 6,
  lookback: number = 5,
  currentTurn: number = 0
): RAGResult {
  const queryAnalysis = analyzeQuery(userInput, recentHistory, lookback);
  const embMap = buildEmbMap(ctx.embeddings);

  const aliasMatched = findAliasMatchedEntities(userInput, recentHistory, knownEntities);
  const aliasIds = new Set(aliasMatched.map((e) => e.id));
  const threatNameSet = new Set(activeThreatNames.map((n) => n.toLowerCase()));

  interface Candidate {
    type: 'lore' | 'entity';
    id: string;
    name: string;
    item: LoreItem | KnownEntity;
    lex: number;
    sem: number;
    salience: number;
    recency: number;
    mandatory: boolean;
    pinned: boolean;
    final: number;
  }

  // 1. Build per-item analyses + semantic similarities
  const candidates: Candidate[] = [];

  for (const l of lore) {
    candidates.push({
      type: 'lore',
      id: l.id,
      name: l.keyword,
      item: l,
      lex: 0,
      sem: 0,
      salience: 0,
      recency: recencyBoost(currentTurn, l.turnCreated),
      mandatory: false,
      pinned: false,
      final: 0,
    });
  }
  for (const e of knownEntities) {
    const isPriority = PRIORITY_LEVELS.has(e.relationship_level);
    const isThreat = threatNameSet.has((e.name ?? '').toLowerCase());
    const isAlias = aliasIds.has(e.id);
    candidates.push({
      type: 'entity',
      id: e.id,
      name: e.name,
      item: e,
      lex: 0,
      sem: 0,
      salience: 0,
      recency: recencyBoost(currentTurn, e.lastSeenTurn),
      mandatory: isPriority || isThreat || isAlias,
      pinned: false,
      final: 0,
    });
  }

  // 2. Lexical scoring — compute analyses, IDF, raw scores
  const analyses = candidates.map((c) =>
    c.type === 'lore'
      ? analyzeText(loreSourceText(c.item as LoreItem))
      : analyzeText(entitySourceText(c.item as KnownEntity))
  );
  const idf = calculateIDF(analyses);
  let maxLex = 0;
  for (let i = 0; i < candidates.length; i++) {
    candidates[i].lex = scoreDocument(analyses[i], queryAnalysis, idf);
    if (candidates[i].lex > maxLex) maxLex = candidates[i].lex;
  }

  // 3. Semantic scoring — cosine against query vector (if available)
  if (ctx.queryVector) {
    for (const c of candidates) {
      const ownerKind: EmbeddingOwnerKind = c.type === 'lore' ? 'lore' : 'entity';
      const vec = embMap.get(`${ownerKind}:${stampEmbKey(ctx.campaignId, c.id)}`);
      if (vec) {
        // Vectors are normalised so cos = dot.
        c.sem = Math.max(0, dot(ctx.queryVector, vec));
      }
    }
  }

  // 4. Compose final score
  for (const c of candidates) {
    const lexN = normaliseLexical(c.lex, maxLex);
    c.final =
      W_SEMANTIC * c.sem +
      W_LEXICAL * lexN +
      W_SALIENCE * c.salience +
      W_RECENCY * c.recency +
      (c.mandatory ? MANDATORY_BOOST : 0) +
      (c.pinned ? PINNED_BOOST : 0);
  }

  candidates.sort((a, b) => b.final - a.final);

  const selectedLore: LoreItem[] = [];
  const selectedEntities: KnownEntity[] = [];
  const debugScores: { name: string; score: number }[] = [];

  for (const c of candidates) {
    if (c.type === 'lore' && selectedLore.length < loreLimit) {
      // Threshold relative to mandatory-less max so early cold-start (all-zero
      // semantic) doesn't admit garbage. 0.05 is intentionally permissive.
      if (c.final > 0.05) {
        selectedLore.push(c.item as LoreItem);
        debugScores.push({ name: c.name, score: Number(c.final.toFixed(3)) });
      }
    } else if (c.type === 'entity') {
      const slotAvail = selectedEntities.length < entityLimit;
      const passes = c.final > 0.05;
      if (c.mandatory || (slotAvail && passes)) {
        selectedEntities.push(c.item as KnownEntity);
        debugScores.push({ name: c.name, score: Number(c.final.toFixed(3)) });
      }
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
      topScores: debugScores.slice(0, 12),
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Memories
// ────────────────────────────────────────────────────────────────────────────
export function retrieveRelevantMemoriesHybrid(
  ctx: HybridContext,
  userInput: string,
  recentHistory: ChatMessage[],
  memories: MemoryItem[],
  limit: number,
  lookback: number = 5,
  currentTurn: number = 0
): MemoryItem[] {
  if (memories.length === 0 || limit <= 0) return [];

  const queryAnalysis = analyzeQuery(userInput, recentHistory, lookback);
  const embMap = buildEmbMap(ctx.embeddings);

  const analyses = memories.map((m) => analyzeText(memorySourceText(m)));
  const idf = calculateIDF(analyses);

  let maxLex = 0;
  const scored = memories.map((m, i) => {
    const lex = scoreDocument(analyses[i], queryAnalysis, idf);
    if (lex > maxLex) maxLex = lex;
    let sem = 0;
    if (ctx.queryVector) {
      const vec = embMap.get(`memory:${stampEmbKey(ctx.campaignId, m.id)}`);
      if (vec) sem = Math.max(0, dot(ctx.queryVector, vec));
    }
    const salience = (m.salience ?? 2) / 5;
    const recency = recencyBoost(currentTurn, m.turnCreated);
    const pinned = !!m.tags?.some((t) => PINNED_TAGS.has(t));
    return { m, lex, sem, salience, recency, pinned };
  });

  for (const s of scored) {
    const lexN = normaliseLexical(s.lex, maxLex);
    (s as Record<string, unknown>)['final'] =
      W_SEMANTIC * s.sem +
      W_LEXICAL * lexN +
      W_SALIENCE * s.salience +
      W_RECENCY * s.recency +
      (s.pinned ? PINNED_BOOST : 0);
  }

  scored.sort(
    (a, b) =>
      ((b as Record<string, unknown>)['final'] as number) -
      ((a as Record<string, unknown>)['final'] as number)
  );

  return scored
    .filter((s) => ((s as Record<string, unknown>)['final'] as number) > 0.04)
    .slice(0, limit)
    .map((s) => s.m);
}

// ────────────────────────────────────────────────────────────────────────────
// Summary segments
// ────────────────────────────────────────────────────────────────────────────
export function retrieveRelevantSegmentsHybrid(
  ctx: HybridContext,
  userInput: string,
  recentHistory: ChatMessage[],
  segments: (SummarySegment & { _embId?: string })[],
  segmentRowIds: string[],     // parallel to `segments` — DB row ids for embedding lookup
  limit: number,
  lookback: number = 5
): SummarySegment[] {
  if (segments.length === 0 || limit <= 0) return [];
  if (segments.length !== segmentRowIds.length) {
    throw new Error('segments and segmentRowIds must be the same length');
  }

  const queryAnalysis = analyzeQuery(userInput, recentHistory, lookback);
  const embMap = buildEmbMap(ctx.embeddings);

  const analyses = segments.map((s) => analyzeText(summarySegmentSourceText(s)));
  const idf = calculateIDF(analyses);

  let maxLex = 0;
  const scored = segments.map((s, i) => {
    const lex = scoreDocument(analyses[i], queryAnalysis, idf);
    if (lex > maxLex) maxLex = lex;
    let sem = 0;
    if (ctx.queryVector) {
      const vec = embMap.get(`summary_segment:${segmentRowIds[i]}`);
      if (vec) sem = Math.max(0, dot(ctx.queryVector, vec));
    }
    return { s, lex, sem };
  });

  return scored
    .map(({ s, lex, sem }) => ({
      s,
      final: W_SEMANTIC * sem + W_LEXICAL * normaliseLexical(lex, maxLex),
    }))
    .sort((a, b) => b.final - a.final)
    .filter((x) => x.final > 0.05)
    .slice(0, limit)
    .map((x) => x.s);
}
