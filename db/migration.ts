// ============================================================================
// db/migration.ts — One-time migration from legacy IndexedDB ('VisceralEngineDB')
// to the new normalized schema ('VisceralEngineDB_v2').
//
// Reads legacy stores via raw IndexedDB so this module works regardless of
// the state of the legacy `db.ts` facade.
//
// Strategy:
//   1. Check the migration flag in the new DB's `world_state` (sentinel row).
//   2. If already migrated, return.
//   3. Open the legacy DB read-only; pull every save, template, world seed,
//      and image. Pump saves through `absorbGameSave`; templates and seeds
//      through their repos; images straight into the new `images` table.
//   4. Write the sentinel row.
//
// We never delete the legacy DB. If something goes wrong, the user can blow
// away the new DB (`deleteVisceralDB()`) and try again.
// ============================================================================
import { vdb } from './schema';
import { absorbGameSave } from './projection';
import { templatesRepo } from './repos/templates';
import { worldSeedsRepo } from './repos/worldSeeds';
import {
  GameSave,
  CharacterTemplate,
  WorldSeed,
  SaveId,
} from '../types';

const LEGACY_DB_NAME = 'VisceralEngineDB';
const SENTINEL_ID = '__migration_sentinel__' as SaveId;

interface LegacyImageRecord {
  id: string;
  blob: Blob;
}

function openLegacyDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    // We pass no version so we attach to whatever the legacy version is.
    const req = indexedDB.open(LEGACY_DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function getAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(storeName)) {
      resolve([]);
      return;
    }
    const tx = db.transaction([storeName], 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

async function isAlreadyMigrated(): Promise<boolean> {
  try {
    const sentinel = await vdb.world_state.get(SENTINEL_ID);
    return !!sentinel;
  } catch {
    return false;
  }
}

async function writeSentinel(): Promise<void> {
  await vdb.world_state.put({
    campaign_id: SENTINEL_ID,
    current_model: '__migration_sentinel__',
    scene_mode: 'NARRATIVE',
    tension_level: 0,
    world_time_total_minutes: 0,
    world_time_display: '',
    turn_count: 0,
    last_world_tick_turn: 0,
    last_bargain_turn: 0,
    last_threat_arc_end_turn: null,
    threat_cooldown_until_turn: null,
    session_denial_count: 0,
    passive_allies_detected: 0,
    player_location_id: null,
    player_location_text: null,
    hidden_registry: '',
    visual_url: null,
    is_generating_visual: 0,
    is_generating_scenarios: 0,
    is_thinking: 0,
    failed_models: [],
    environment: null,
    last_active_summary: null,
  });
}

export interface MigrationReport {
  ranNow: boolean;
  saves: number;
  templates: number;
  worldSeeds: number;
  images: number;
  errors: string[];
}

/**
 * Run the legacy → new migration if it hasn't been run yet. Idempotent.
 * Safe to call on every boot.
 */
export async function migrateLegacyIfNeeded(): Promise<MigrationReport> {
  const report: MigrationReport = {
    ranNow: false,
    saves: 0,
    templates: 0,
    worldSeeds: 0,
    images: 0,
    errors: [],
  };

  await vdb.open();

  if (await isAlreadyMigrated()) {
    return report;
  }

  const legacy = await openLegacyDb();
  if (!legacy) {
    // No legacy DB at all → first-time install. Mark migrated so we don't try again.
    await writeSentinel();
    report.ranNow = true;
    return report;
  }

  try {
    // Saves first — they reference image ids, so images need to land too.
    const legacySaves = await getAll<GameSave>(legacy, 'saves');
    for (const save of legacySaves) {
      try {
        await absorbGameSave(save);
        report.saves++;
      } catch (err) {
        report.errors.push(`save "${save.name}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Templates
    const legacyTemplates = await getAll<CharacterTemplate>(legacy, 'templates');
    for (const t of legacyTemplates) {
      try {
        await templatesRepo.upsert(t);
        report.templates++;
      } catch (err) {
        report.errors.push(`template "${t.name}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // World seeds
    const legacySeeds = await getAll<WorldSeed>(legacy, 'worlds');
    for (const s of legacySeeds) {
      try {
        await worldSeedsRepo.upsert(s);
        report.worldSeeds++;
      } catch (err) {
        report.errors.push(`world seed "${s.name}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Images — copy raw blobs across.
    const legacyImages = await getAll<LegacyImageRecord>(legacy, 'images');
    for (const img of legacyImages) {
      try {
        await vdb.images.put({
          id: img.id,
          blob: img.blob,
          created_at: new Date().toISOString(),
        });
        report.images++;
      } catch (err) {
        report.errors.push(`image "${img.id}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    await writeSentinel();
    report.ranNow = true;
    return report;
  } finally {
    legacy.close();
  }
}

/**
 * Force a re-migration on next boot by clearing the sentinel.
 * Intended for debugging only.
 */
export async function resetMigrationSentinel(): Promise<void> {
  await vdb.world_state.delete(SENTINEL_ID);
}
