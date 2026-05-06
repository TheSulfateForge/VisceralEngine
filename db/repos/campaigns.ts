// db/repos/campaigns.ts
// Repo for campaign-row reads/writes that don't go through projection.
// Save/load goes through db/projection.ts; this repo handles metadata queries.

import { vdb, CampaignRow } from '../schema';
import { SaveId, SaveMetadata } from '../../types';

export const campaignsRepo = {
  async getById(id: SaveId): Promise<CampaignRow | undefined> {
    return vdb.campaigns.get(id);
  },

  async getByName(name: string): Promise<CampaignRow | undefined> {
    return vdb.campaigns.where('name').equals(name).first();
  },

  async listMetadata(): Promise<SaveMetadata[]> {
    const all = await vdb.campaigns.toArray();
    return all
      .map((c): SaveMetadata => ({
        id: c.id,
        name: c.name,
        timestamp: c.updated_at,
      }))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  },

  async getAllIds(): Promise<SaveId[]> {
    return (await vdb.campaigns.toCollection().primaryKeys()) as SaveId[];
  },

  async exists(id: SaveId): Promise<boolean> {
    return (await vdb.campaigns.where('id').equals(id).count()) > 0;
  },
};
