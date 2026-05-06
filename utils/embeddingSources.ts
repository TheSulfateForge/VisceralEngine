// ============================================================================
// utils/embeddingSources.ts
//
// Per-owner-kind text extraction for the embeddings table. Defines what
// string we feed the embedder for each row type so retrieval finds it.
//
// Plus a stable text-hash so the backfill can skip items whose text hasn't
// changed since the last embed.
// ============================================================================
import {
  KnownEntity,
  LoreItem,
  MemoryItem,
  SummarySegment,
} from '../types';
import {
  EntityRow,
  LoreRow,
  MemoryRow,
  SummarySegmentRow,
  LocationRow,
  WorldRuleRow,
  EmbeddingOwnerKind,
} from '../db/schema';

// ────────────────────────────────────────────────────────────────────────────
// Text source per owner kind.
// ────────────────────────────────────────────────────────────────────────────

export function memorySourceText(m: Pick<MemoryItem, 'fact'>): string {
  return m.fact ?? '';
}

export function loreSourceText(l: Pick<LoreItem, 'keyword' | 'content'>): string {
  return `${l.keyword ?? ''}: ${l.content ?? ''}`.trim();
}

export function entitySourceText(
  e: Pick<KnownEntity, 'name' | 'role' | 'impression' | 'leverage' | 'ledger'>
): string {
  const parts: string[] = [];
  if (e.name) parts.push(e.name);
  if (e.role) parts.push(`(${e.role})`);
  if (e.impression) parts.push(e.impression);
  if (e.leverage) parts.push(`leverage: ${e.leverage}`);
  if (e.ledger?.length) parts.push(e.ledger.join(' '));
  return parts.join(' — ').trim();
}

export function summarySegmentSourceText(s: Pick<SummarySegment, 'summary'>): string {
  return s.summary ?? '';
}

export function locationSourceText(l: Pick<LocationRow, 'display_name' | 'description' | 'tags'>): string {
  const parts: string[] = [];
  if (l.display_name) parts.push(l.display_name);
  if (l.description) parts.push(l.description);
  if (l.tags?.length) parts.push(l.tags.join(' '));
  return parts.join(' — ').trim();
}

export function worldRuleSourceText(r: Pick<WorldRuleRow, 'rule'>): string {
  return r.rule ?? '';
}

// Row-level adapters (so the backfill can hand any row blob to one function).
export function sourceTextFromRow(
  kind: EmbeddingOwnerKind,
  row: unknown
): string {
  switch (kind) {
    case 'memory':          return memorySourceText(row as MemoryRow);
    case 'lore':            return loreSourceText(row as LoreRow);
    case 'entity':          return entitySourceText({
                              name: (row as EntityRow).name,
                              role: (row as EntityRow).role,
                              impression: (row as EntityRow).impression,
                              leverage: (row as EntityRow).leverage,
                              ledger: [],   // ledger items live in their own table
                            } as KnownEntity);
    case 'summary_segment': return summarySegmentSourceText(row as SummarySegmentRow);
    case 'location':        return locationSourceText(row as LocationRow);
    case 'world_rule':      return worldRuleSourceText(row as WorldRuleRow);
    case 'message':         return ((row as { text?: string }).text) ?? '';
    default:                return '';
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Hashing.
// SHA-256 → first 16 hex chars. Fast enough for any practical corpus size,
// stable across runs, content-addressable so we can compare to the stored
// `text_hash` and decide whether to re-embed.
// ────────────────────────────────────────────────────────────────────────────

export async function textHash(input: string): Promise<string> {
  if (!input) return '';
  // Normalise whitespace so trivial reformatting doesn't trigger a re-embed.
  const normalised = input.replace(/\s+/g, ' ').trim();
  if (!normalised) return '';
  const encoded = new TextEncoder().encode(normalised);
  const buffer = await crypto.subtle.digest('SHA-256', encoded);
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < 8; i++) {  // 16 hex chars (8 bytes) — plenty for non-collision
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}
