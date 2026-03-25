import { useState, useCallback, useEffect } from 'react';
import type { WorldSeed, WorldSeedId } from '../types';
import { generateWorldSeedId } from '../idUtils';
import { db } from '../db';
import { useToast } from '../components/providers/ToastProvider';

export function useWorldSeeds() {
  const [seeds, setSeeds] = useState<WorldSeed[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { showToast } = useToast();

  const refresh = useCallback(async () => {
    try {
      const all = await db.getAllWorldSeeds();
      setSeeds(all);
    } catch (e) {
      console.error('[WorldSeeds] Failed to load:', e);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const saveWorldSeed = useCallback(async (seed: Omit<WorldSeed, 'id' | 'timestamp' | 'lastModified'> & { id?: WorldSeedId }): Promise<WorldSeed> => {
    const fullSeed: WorldSeed = {
      ...seed,
      id: seed.id || generateWorldSeedId(),
      timestamp: new Date().toISOString(),
      lastModified: new Date().toISOString(),
    };
    await db.saveWorldSeed(fullSeed);
    await refresh();
    showToast('World seed saved.', 'success');
    return fullSeed;
  }, [refresh, showToast]);

  const deleteWorldSeed = useCallback(async (id: WorldSeedId) => {
    await db.deleteWorldSeed(id);
    await refresh();
    showToast('World seed deleted.', 'success');
  }, [refresh, showToast]);

  return { seeds, isLoading, setIsLoading, saveWorldSeed, deleteWorldSeed, refresh };
}
