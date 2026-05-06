// ============================================================================
// services/embeddingBackfill.ts
//
// Walks every embeddable owner kind for a given campaign and fills (or
// refreshes) embeddings whose source text has changed or whose embedding
// is missing. Runs incrementally with progress callbacks so the UI can
// show a non-blocking spinner.
//
// Call this on campaign open (after migrations) or on demand from a debug
// menu. It's idempotent.
// ============================================================================
import { vdb } from '../db/schema';
import { embeddingsRepo, EmbeddingUpsert } from '../db/repos/embeddings';
import { embeddingService } from './embeddingService';
import { sourceTextFromRow, textHash } from '../utils/embeddingSources';
import { SaveId } from '../types';
import type { EmbeddingOwnerKind } from '../db/schema';

// Owner kinds we currently embed. `message` is excluded by default — too
// much noise per turn. Add it to this list if you want chat-message recall.
const EMBEDDABLE_KINDS: EmbeddingOwnerKind[] = [
  'memory',
  'lore',
  'entity',
  'summary_segment',
  'location',
  'world_rule',
];

const BATCH_SIZE = 16;     // transformers.js handles this comfortably on CPU/WebGPU

export interface BackfillProgress {
  kind: EmbeddingOwnerKind;
  done: number;
  total: number;
  skippedByHash: number;
  errors: string[];
}

export interface BackfillReport {
  perKind: Record<EmbeddingOwnerKind, BackfillProgress>;
  totalEmbedded: number;
  totalSkipped: number;
  durationMs: number;
}

export interface BackfillOpts {
  /** Override which owner kinds to walk. Default: every kind in EMBEDDABLE_KINDS. */
  kinds?: EmbeddingOwnerKind[];
  /** Called after each batch with the running progress for each kind. */
  onProgress?: (progress: Record<EmbeddingOwnerKind, BackfillProgress>) => void;
  /** Called with model-load progress events (download bar, etc.). */
  onModelProgress?: (ev: unknown) => void;
  /** Stop signal — checked between batches. */
  signal?: AbortSignal;
  /** What turn to stamp on new embeddings. Defaults to whatever world_state says. */
  currentTurn?: number;
  /** Force re-embed regardless of stored hash. Useful after a model swap. */
  forceRefresh?: boolean;
}

interface RowsForKind {
  kind: EmbeddingOwnerKind;
  rows: { id: string; text: string; row: unknown }[];
}

async function gatherRows(campaignId: SaveId, kinds: EmbeddingOwnerKind[]): Promise<RowsForKind[]> {
  const result: RowsForKind[] = [];

  if (kinds.includes('memory')) {
    const rows = await vdb.memories.where('campaign_id').equals(campaignId).toArray();
    result.push({
      kind: 'memory',
      rows: rows.map((r) => ({ id: r.id, text: sourceTextFromRow('memory', r), row: r })),
    });
  }

  if (kinds.includes('lore')) {
    const rows = await vdb.lore.where('campaign_id').equals(campaignId).toArray();
    result.push({
      kind: 'lore',
      rows: rows.map((r) => ({ id: r.id, text: sourceTextFromRow('lore', r), row: r })),
    });
  }

  if (kinds.includes('entity')) {
    // Pull entities + ledger items so we can include the ledger in the text.
    const entityRows = await vdb.entities.where('campaign_id').equals(campaignId).toArray();
    const ledgerRows = entityRows.length
      ? await vdb.entity_ledger_items
          .where('entity_id')
          .anyOf(entityRows.map((e) => e.id))
          .toArray()
      : [];
    const ledgerByEntity = new Map<string, string[]>();
    for (const l of ledgerRows) {
      if (!ledgerByEntity.has(l.entity_id)) ledgerByEntity.set(l.entity_id, []);
      ledgerByEntity.get(l.entity_id)!.push(l.text);
    }
    result.push({
      kind: 'entity',
      rows: entityRows.map((r) => {
        const ledger = ledgerByEntity.get(r.id) ?? [];
        const parts = [
          r.name,
          r.role ? `(${r.role})` : '',
          r.impression,
          r.leverage ? `leverage: ${r.leverage}` : '',
          ledger.join(' '),
        ].filter(Boolean);
        return { id: r.id, text: parts.join(' — '), row: r };
      }),
    });
  }

  if (kinds.includes('summary_segment')) {
    const rows = await vdb.summary_segments.where('campaign_id').equals(campaignId).toArray();
    result.push({
      kind: 'summary_segment',
      rows: rows.map((r) => ({ id: r.id, text: sourceTextFromRow('summary_segment', r), row: r })),
    });
  }

  if (kinds.includes('location')) {
    const rows = await vdb.locations.where('campaign_id').equals(campaignId).toArray();
    result.push({
      kind: 'location',
      rows: rows.map((r) => ({ id: r.id, text: sourceTextFromRow('location', r), row: r })),
    });
  }

  if (kinds.includes('world_rule')) {
    const rows = await vdb.world_rules.where('campaign_id').equals(campaignId).toArray();
    result.push({
      kind: 'world_rule',
      rows: rows.map((r) => ({ id: r.id, text: sourceTextFromRow('world_rule', r), row: r })),
    });
  }

  return result;
}

export async function backfillEmbeddings(
  campaignId: SaveId,
  opts: BackfillOpts = {}
): Promise<BackfillReport> {
  const t0 = performance.now();
  const kinds = opts.kinds ?? EMBEDDABLE_KINDS;
  const modelId = embeddingService.getModelId();

  const turn =
    opts.currentTurn ??
    (await vdb.world_state.get(campaignId).then((w) => w?.turn_count ?? 0));

  // Subscribe to model-load progress for the duration of this run.
  const unsubscribe = opts.onModelProgress
    ? embeddingService.onProgress(opts.onModelProgress)
    : null;

  try {
    await embeddingService.init();

    const perKind = {} as Record<EmbeddingOwnerKind, BackfillProgress>;
    for (const k of kinds) perKind[k] = { kind: k, done: 0, total: 0, skippedByHash: 0, errors: [] };

    const rowsByKind = await gatherRows(campaignId, kinds);
    const existing = await embeddingsRepo.listForCampaign(campaignId);
    const existingByOwner = new Map<string, typeof existing[number]>();
    for (const e of existing) {
      existingByOwner.set(`${e.owner_kind}:${e.owner_id}`, e);
    }

    let totalEmbedded = 0;
    let totalSkipped = 0;

    for (const group of rowsByKind) {
      const progress = perKind[group.kind];
      progress.total = group.rows.length;

      // Determine which rows actually need embedding (text changed, model
      // changed, or no row exists yet).
      const queued: { id: string; text: string; hash: string }[] = [];
      for (const r of group.rows) {
        if (!r.text) {
          progress.done++;
          continue;
        }
        const hash = await textHash(r.text);
        const stored = existingByOwner.get(`${group.kind}:${r.id}`);
        const needs =
          opts.forceRefresh ||
          !stored ||
          stored.text_hash !== hash ||
          stored.model_id !== modelId;
        if (!needs) {
          progress.skippedByHash++;
          progress.done++;
          totalSkipped++;
          continue;
        }
        queued.push({ id: r.id, text: r.text, hash });
      }

      // Embed in batches.
      for (let i = 0; i < queued.length; i += BATCH_SIZE) {
        if (opts.signal?.aborted) {
          throw new DOMException('backfill aborted', 'AbortError');
        }

        const slice = queued.slice(i, i + BATCH_SIZE);
        let vectors: Float32Array[];
        try {
          vectors = await embeddingService.encodeBatch(slice.map((s) => s.text));
        } catch (err) {
          progress.errors.push(err instanceof Error ? err.message : String(err));
          progress.done += slice.length;
          opts.onProgress?.(perKind);
          continue;
        }

        const upserts: EmbeddingUpsert[] = slice.map((s, idx) => ({
          campaign_id: campaignId,
          owner_kind: group.kind,
          owner_id: s.id,
          text_hash: s.hash,
          vector: vectors[idx],
          dim: vectors[idx].length,
          model_id: modelId,
          created_turn: turn,
        }));
        try {
          await embeddingsRepo.bulkUpsert(upserts);
          totalEmbedded += upserts.length;
        } catch (err) {
          progress.errors.push(err instanceof Error ? err.message : String(err));
        }

        progress.done += slice.length;
        opts.onProgress?.(perKind);
      }
    }

    return {
      perKind,
      totalEmbedded,
      totalSkipped,
      durationMs: performance.now() - t0,
    };
  } finally {
    unsubscribe?.();
  }
}
