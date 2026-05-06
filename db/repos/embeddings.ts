// ============================================================================
// db/repos/embeddings.ts
//
// Wraps the embeddings table. Phase 2 of the migration uses this to store
// per-item vectors (memory.fact, lore content, entity description, etc.) and
// to search them by cosine similarity.
//
// IndexedDB has no native vector index — for search we load all vectors for
// a campaign into memory and run a tight cosine loop. At ~5000 vectors × 384
// dims that's ~7.5MB; well within reasonable bounds.
// ============================================================================
import { vdb, EmbeddingRow, EmbeddingOwnerKind } from '../schema';
import { SaveId } from '../../types';
import { generateUUID } from '../../idUtils';

export interface EmbeddingUpsert {
  campaign_id: SaveId;
  owner_kind: EmbeddingOwnerKind;
  owner_id: string;
  text_hash: string;
  vector: Float32Array;
  dim: number;
  model_id: string;
  created_turn: number;
}

export interface CosineHit {
  owner_kind: EmbeddingOwnerKind;
  owner_id: string;
  similarity: number;
}

function cosine(a: Float32Array, b: Float32Array): number {
  // Vectors from the embedder are already L2-normalized (we pass
  // `normalize: true`), so cosine = dot product. Defensively compute the
  // dot anyway in case a caller stored an un-normalized vector.
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export const embeddingsRepo = {
  /**
   * Look up the embedding row for a specific owner (kind, id). Returns
   * undefined if missing.
   */
  async getForOwner(
    owner_kind: EmbeddingOwnerKind,
    owner_id: string
  ): Promise<EmbeddingRow | undefined> {
    return vdb.embeddings
      .where('[owner_kind+owner_id]')
      .equals([owner_kind, owner_id])
      .first();
  },

  /**
   * List every embedding for a campaign. Used to warm the in-memory cache
   * on campaign open.
   */
  async listForCampaign(campaign_id: SaveId): Promise<EmbeddingRow[]> {
    return vdb.embeddings.where('campaign_id').equals(campaign_id).toArray();
  },

  /**
   * List embeddings of a specific kind for a campaign.
   */
  async listForCampaignByKind(
    campaign_id: SaveId,
    owner_kind: EmbeddingOwnerKind
  ): Promise<EmbeddingRow[]> {
    return vdb.embeddings
      .where('[campaign_id+owner_kind]')
      .equals([campaign_id, owner_kind])
      .toArray();
  },

  /**
   * Upsert a single embedding. If a row already exists for the (kind, id)
   * pair, the existing row's id is reused so we don't accumulate duplicates.
   */
  async upsert(input: EmbeddingUpsert): Promise<void> {
    const existing = await embeddingsRepo.getForOwner(input.owner_kind, input.owner_id);
    const row: EmbeddingRow = {
      id: existing?.id ?? generateUUID(),
      campaign_id: input.campaign_id,
      owner_kind: input.owner_kind,
      owner_id: input.owner_id,
      text_hash: input.text_hash,
      vector: input.vector,
      dim: input.dim,
      model_id: input.model_id,
      created_turn: input.created_turn,
    };
    await vdb.embeddings.put(row);
  },

  async bulkUpsert(inputs: EmbeddingUpsert[]): Promise<void> {
    if (inputs.length === 0) return;
    // Look up existing rows in one go to reuse their ids.
    const existing = await Promise.all(
      inputs.map((i) => embeddingsRepo.getForOwner(i.owner_kind, i.owner_id))
    );
    const rows: EmbeddingRow[] = inputs.map((input, i): EmbeddingRow => ({
      id: existing[i]?.id ?? generateUUID(),
      campaign_id: input.campaign_id,
      owner_kind: input.owner_kind,
      owner_id: input.owner_id,
      text_hash: input.text_hash,
      vector: input.vector,
      dim: input.dim,
      model_id: input.model_id,
      created_turn: input.created_turn,
    }));
    await vdb.embeddings.bulkPut(rows);
  },

  async deleteByOwner(owner_kind: EmbeddingOwnerKind, owner_id: string): Promise<void> {
    await vdb.embeddings
      .where('[owner_kind+owner_id]')
      .equals([owner_kind, owner_id])
      .delete();
  },

  async deleteForCampaign(campaign_id: SaveId): Promise<void> {
    await vdb.embeddings.where('campaign_id').equals(campaign_id).delete();
  },

  /**
   * In-memory cosine search. Caller passes the loaded rows (typically from
   * listForCampaign/listForCampaignByKind, cached at the call site).
   */
  search(
    rows: EmbeddingRow[],
    query: Float32Array,
    opts: { topK?: number; minSim?: number; kindFilter?: EmbeddingOwnerKind[] } = {}
  ): CosineHit[] {
    const topK = opts.topK ?? 50;
    const minSim = opts.minSim ?? 0;
    const kindFilter = opts.kindFilter ? new Set(opts.kindFilter) : null;

    const hits: CosineHit[] = [];
    for (const r of rows) {
      if (kindFilter && !kindFilter.has(r.owner_kind)) continue;
      const sim = cosine(query, r.vector);
      if (sim < minSim) continue;
      hits.push({ owner_kind: r.owner_kind, owner_id: r.owner_id, similarity: sim });
    }
    hits.sort((a, b) => b.similarity - a.similarity);
    return hits.slice(0, topK);
  },

  cosine, // exported for tests / hybrid scoring
};
