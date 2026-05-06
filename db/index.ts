// ============================================================================
// db/index.ts — Phase 1 facade.
//
// Exposes the same `db` singleton API as the legacy `db.ts` at the repo root,
// but routed through the new normalized schema (db/schema.ts), the projection
// layer (db/projection.ts), and the repos (db/repos/*).
//
// CUTOVER: once you're ready to retire legacy `db.ts`, replace its body with
//
//     export * from './db/index';
//
// and delete the old `Database` class definition. All call sites continue to
// work unchanged because the public API is identical.
// ============================================================================
import {
  GameSave,
  SaveMetadata,
  CharacterTemplate,
  WorldSeed,
  WorldSeedId,
  TemplateId,
  SaveId,
} from '../types';
import { generateSaveId } from '../idUtils';
import { vdb } from './schema';
import { absorbGameSave, projectGameSave, deleteCampaignAndRows } from './projection';
import { campaignsRepo } from './repos/campaigns';
import { imagesRepo } from './repos/images';
import { templatesRepo } from './repos/templates';
import { worldSeedsRepo } from './repos/worldSeeds';

class DatabaseFacade {
  /** No-op kept for parity with the legacy Database.init() call. Dexie opens lazily. */
  async init(): Promise<void> {
    if (!vdb.isOpen()) await vdb.open();
  }

  // ─── Saves ─────────────────────────────────────────────────────────────
  async saveGame(save: GameSave): Promise<void> {
    // Match legacy upsert-by-name semantics: if a save with the same name
    // exists, reuse its id so the save list stays stable.
    const existing = await campaignsRepo.getByName(save.name);
    if (existing) {
      save.id = existing.id;
    } else if (!save.id) {
      save.id = generateSaveId();
    }
    await absorbGameSave(save);
  }

  async loadGame(name: string): Promise<GameSave | undefined> {
    const camp = await campaignsRepo.getByName(name);
    if (!camp) return undefined;
    return projectGameSave(camp.id);
  }

  async deleteGame(name: string): Promise<void> {
    const camp = await campaignsRepo.getByName(name);
    if (!camp) return;
    await deleteCampaignAndRows(camp.id);
  }

  async getAllSavesMetadata(): Promise<SaveMetadata[]> {
    return campaignsRepo.listMetadata();
  }

  // ─── Images ────────────────────────────────────────────────────────────
  async saveImage(base64Data: string): Promise<string> {
    return imagesRepo.saveDataUrl(base64Data);
  }

  async getImage(id: string): Promise<Blob | null> {
    return imagesRepo.getBlob(id);
  }

  async cleanupOrphanedImages(activeImageIds: string[]): Promise<number> {
    return imagesRepo.cleanupOrphans(activeImageIds);
  }

  // ─── Templates ─────────────────────────────────────────────────────────
  async saveTemplate(template: CharacterTemplate): Promise<void> {
    return templatesRepo.upsert(template);
  }

  async loadTemplate(name: string): Promise<CharacterTemplate | undefined> {
    return templatesRepo.getByName(name);
  }

  async getAllTemplates(): Promise<CharacterTemplate[]> {
    return templatesRepo.listAll();
  }

  async deleteTemplate(id: TemplateId): Promise<void> {
    return templatesRepo.deleteById(id);
  }

  // ─── World Seeds ───────────────────────────────────────────────────────
  async saveWorldSeed(seed: WorldSeed): Promise<void> {
    return worldSeedsRepo.upsert(seed);
  }

  async loadWorldSeed(id: WorldSeedId): Promise<WorldSeed | undefined> {
    return worldSeedsRepo.getById(id);
  }

  async getAllWorldSeeds(): Promise<WorldSeed[]> {
    return worldSeedsRepo.listAll();
  }

  async deleteWorldSeed(id: WorldSeedId): Promise<void> {
    return worldSeedsRepo.deleteById(id);
  }
}

export const db = new DatabaseFacade();

// Also export the underlying pieces for advanced callers that want repo
// access directly (Phase 2 simulation reads).
export { vdb } from './schema';
export { absorbGameSave, projectGameSave, deleteCampaignAndRows } from './projection';
export { campaignsRepo } from './repos/campaigns';
export { imagesRepo } from './repos/images';
export { templatesRepo } from './repos/templates';
export { worldSeedsRepo } from './repos/worldSeeds';
export { entitiesRepo } from './repos/entities';
export { memoriesRepo } from './repos/memories';
export { loreRepo } from './repos/lore';
