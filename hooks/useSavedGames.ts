
import { useState, useEffect, useCallback } from 'react';
import { db } from '../db';
import { SaveMetadata } from '../types';

export const useSavedGames = (shouldFetch: boolean) => {
  const [saveList, setSaveList] = useState<SaveMetadata[]>([]);

  const refreshSaves = useCallback(async () => {
    const metadata = await db.getAllSavesMetadata();
    setSaveList(metadata);
  }, []);

  useEffect(() => {
    if (shouldFetch) {
      refreshSaves();
    }
  }, [shouldFetch, refreshSaves]);

  const deleteSave = async (name: string) => {
    await db.deleteGame(name);
    setSaveList(prev => prev.filter(n => n.name !== name));
  };

  return { saveList, refreshSaves, deleteSave };
};