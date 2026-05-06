// db/repos/lore.ts
// Wraps the lore table.

import { vdb, LoreRow } from '../schema';
import { LoreItem, LoreId, SaveId } from '../../types';

const fromRow = (r: LoreRow): LoreItem => ({
  id: r.id,
  keyword: r.keyword,
  content: r.content,
  timestamp: r.timestamp,
  ...(r.turn_created !== null ? { turnCreated: r.turn_created } : {}),
  ...(r.semantic_update_of !== null ? { semanticUpdateOf: r.semantic_update_of } : {}),
});

const toRow = (campaignId: SaveId, l: LoreItem): LoreRow => ({
  id: l.id,
  campaign_id: campaignId,
  keyword: l.keyword,
  content: l.content,
  timestamp: l.timestamp,
  turn_created: l.turnCreated ?? null,
  semantic_update_of: l.semanticUpdateOf ?? null,
});

export const loreRepo = {
  async getById(id: LoreId): Promise<LoreItem | undefined> {
    const r = await vdb.lore.get(id);
    return r ? fromRow(r) : undefined;
  },

  async getByKeyword(campaignId: SaveId, keyword: string): Promise<LoreItem | undefined> {
    const r = await vdb.lore
      .where('[campaign_id+keyword]')
      .equals([campaignId, keyword])
      .first();
    return r ? fromRow(r) : undefined;
  },

  async listForCampaign(campaignId: SaveId): Promise<LoreItem[]> {
    const rows = await vdb.lore.where('campaign_id').equals(campaignId).toArray();
    return rows.map(fromRow);
  },

  async upsert(campaignId: SaveId, l: LoreItem): Promise<void> {
    await vdb.lore.put(toRow(campaignId, l));
  },

  async deleteById(id: LoreId): Promise<void> {
    await vdb.lore.delete(id);
  },
};
