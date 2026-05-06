// db/repos/images.ts
// Wraps the images and image_uses tables.

import { vdb, ImageRow, ImageOwnerKind, ImageUseRow } from '../schema';
import { generateUUID } from '../../idUtils';

const dataUrlToBlob = (base64Data: string): Blob => {
  const parts = base64Data.split(',');
  const header = parts[0];
  const base64 = parts[1];
  const mimeMatch = header.match(/:(.*?);/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
};

export const imagesRepo = {
  /**
   * Persist a base64 data-URL image. Returns the assigned id.
   * Mirrors the legacy `db.saveImage` API.
   */
  async saveDataUrl(base64Data: string): Promise<string> {
    const id = `img_${generateUUID()}`;
    const blob = dataUrlToBlob(base64Data);
    const row: ImageRow = { id, blob, created_at: new Date().toISOString() };
    await vdb.images.put(row);
    return id;
  },

  async getBlob(id: string): Promise<Blob | null> {
    const row = await vdb.images.get(id);
    return row?.blob ?? null;
  },

  /**
   * Delete every image whose id is NOT in `activeImageIds`.
   * Returns the count of deleted images.
   * Active set is derived from current campaigns + thumbnails by the caller.
   */
  async cleanupOrphans(activeImageIds: string[]): Promise<number> {
    const active = new Set(activeImageIds);
    const all = await vdb.images.toCollection().primaryKeys();
    const orphans = (all as string[]).filter((id) => !active.has(id));
    if (orphans.length === 0) return 0;
    await vdb.images.bulkDelete(orphans);
    // Cascade: drop image_uses entries that pointed at the orphans.
    await vdb.image_uses.where('image_id').anyOf(orphans).delete();
    return orphans.length;
  },

  async recordUse(image_id: string, owner_kind: ImageOwnerKind, owner_id: string): Promise<void> {
    const row: ImageUseRow = { image_id, owner_kind, owner_id };
    await vdb.image_uses.put(row);
  },

  async listUsesForOwner(owner_id: string): Promise<ImageUseRow[]> {
    return vdb.image_uses.where('owner_id').equals(owner_id).toArray();
  },

  /**
   * Returns ids of every image referenced by image_uses, plus campaign
   * thumbnails — i.e. the "active set" for cleanup.
   */
  async getActiveImageIds(): Promise<string[]> {
    const uses = await vdb.image_uses.toArray();
    return uses.map((u) => u.image_id);
  },
};
