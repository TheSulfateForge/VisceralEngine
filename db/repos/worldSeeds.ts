// db/repos/worldSeeds.ts
// Wraps the world_seeds table.

import { vdb, WorldSeedRow } from '../schema';
import { WorldSeed, WorldSeedId } from '../../types';

const fromRow = (r: WorldSeedRow): WorldSeed => r.payload;

const toRow = (s: WorldSeed): WorldSeedRow => ({
  id: s.id,
  name: s.name,
  description: s.description,
  timestamp: s.timestamp,
  last_modified: s.lastModified,
  tags: s.tags ?? [],
  thumbnail_image_id: s.thumbnail ?? null,
  payload: s,
});

export const worldSeedsRepo = {
  async upsert(seed: WorldSeed): Promise<void> {
    await vdb.world_seeds.put(toRow(seed));
  },

  async getById(id: WorldSeedId): Promise<WorldSeed | undefined> {
    const r = await vdb.world_seeds.get(id);
    return r ? fromRow(r) : undefined;
  },

  async listAll(): Promise<WorldSeed[]> {
    const rows = await vdb.world_seeds.toArray();
    return rows
      .map(fromRow)
      .sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());
  },

  async deleteById(id: WorldSeedId): Promise<void> {
    await vdb.world_seeds.delete(id);
  },
};
