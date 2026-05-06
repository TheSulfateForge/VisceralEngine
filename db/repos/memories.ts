// db/repos/memories.ts
// Wraps memories + memory_tags tables.

import { vdb, MemoryRow, MemoryTagRow } from '../schema';
import { MemoryItem, MemoryId, SaveId } from '../../types';

const PINNED_TAGS = new Set([
  'vow', 'oath', 'debt', 'reveal', 'death', 'identity', 'betrayal',
]);

const fromRow = (r: MemoryRow, tags: string[]): MemoryItem => ({
  id: r.id,
  fact: r.fact,
  timestamp: r.timestamp,
  salience: r.salience,
  tags,
  turnCreated: r.turn_created,
});

async function attachTags(rows: MemoryRow[]): Promise<MemoryItem[]> {
  if (rows.length === 0) return [];
  const tagRows = await vdb.memory_tags
    .where('memory_id')
    .anyOf(rows.map((r) => r.id))
    .toArray();
  const tagsByMem = new Map<string, string[]>();
  for (const t of tagRows) {
    if (!tagsByMem.has(t.memory_id)) tagsByMem.set(t.memory_id, []);
    tagsByMem.get(t.memory_id)!.push(t.tag);
  }
  return rows.map((r) => fromRow(r, tagsByMem.get(r.id) ?? []));
}

export const memoriesRepo = {
  async getById(id: MemoryId): Promise<MemoryItem | undefined> {
    const r = await vdb.memories.get(id);
    if (!r) return undefined;
    const tagRows = await vdb.memory_tags.where('memory_id').equals(id).toArray();
    return fromRow(r, tagRows.map((t) => t.tag));
  },

  async listForCampaign(campaignId: SaveId): Promise<MemoryItem[]> {
    const rows = await vdb.memories.where('campaign_id').equals(campaignId).toArray();
    return attachTags(rows);
  },

  async listPinned(campaignId: SaveId): Promise<MemoryItem[]> {
    const rows = await vdb.memories
      .where('campaign_id')
      .equals(campaignId)
      .and((r) => r.is_pinned === 1)
      .toArray();
    return attachTags(rows);
  },

  async listBySalience(campaignId: SaveId, minSalience: number): Promise<MemoryItem[]> {
    const rows = await vdb.memories
      .where('campaign_id')
      .equals(campaignId)
      .and((r) => r.salience >= minSalience)
      .toArray();
    return attachTags(rows);
  },

  async upsert(campaignId: SaveId, m: MemoryItem): Promise<void> {
    const tags = m.tags ?? [];
    const isPinned = tags.some((t) => PINNED_TAGS.has(t)) ? 1 : 0;
    const row: MemoryRow = {
      id: m.id,
      campaign_id: campaignId,
      fact: m.fact,
      salience: m.salience ?? 2,
      turn_created: m.turnCreated ?? 0,
      timestamp: m.timestamp,
      is_pinned: isPinned,
    };
    await vdb.memories.put(row);
    await vdb.memory_tags.where('memory_id').equals(m.id).delete();
    if (tags.length) {
      const tagRows: MemoryTagRow[] = tags.map((tag) => ({ memory_id: m.id, tag }));
      await vdb.memory_tags.bulkPut(tagRows);
    }
  },

  async deleteById(id: MemoryId): Promise<void> {
    await vdb.memories.delete(id);
    await vdb.memory_tags.where('memory_id').equals(id).delete();
  },
};
