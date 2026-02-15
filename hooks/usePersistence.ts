
import { useCallback, useEffect, useRef } from 'react';
import { GameSave } from '../types';
import { generateSaveId, generateMessageId } from '../idUtils';
import { db } from '../db';
import { downloadFile, debounce } from '../utils';
import { useToast } from '../components/providers/ToastProvider';
import { TIMING } from '../constants';
import { useGameStore } from '../store';

export const usePersistence = () => {
  const { 
      gameHistory, setGameHistory, 
      gameWorld, setGameWorld, 
      character, setCharacter, 
      setView, setIsSettingsOpen 
  } = useGameStore();

  const { showToast } = useToast();
  
  // Track if initial load is done to avoid overwriting autosave with empty state
  const isInitialized = useRef(false);
  const lastCleanupTurn = useRef(0);

  useEffect(() => {
    // We consider the game initialized if there are turns recorded or a character name exists
    if (gameHistory.turnCount > 0 || character.name) {
      isInitialized.current = true;
    }
  }, [gameHistory.turnCount, character.name]);

  // Image cleanup: run every 20 turns to remove orphaned blobs
  useEffect(() => {
    const currentState = useGameStore.getState();
    const turnCount = currentState.gameHistory.turnCount;
    if (turnCount > 0 && turnCount % 20 === 0 && turnCount !== lastCleanupTurn.current) {
        lastCleanupTurn.current = turnCount;
        const activeIds = currentState.gameWorld.generatedImages || [];
        db.cleanupOrphanedImages(activeIds).then(count => {
            if (count > 0) console.log(`[Cleanup] Removed ${count} orphaned images from IndexedDB`);
        }).catch(console.error);
    }
  }, [gameHistory.turnCount]);

  const handleExport = useCallback(() => {
    const currentState = useGameStore.getState();
    const save: GameSave = {
      id: generateSaveId(),
      name: `${currentState.character.name || 'Unknown'}_${new Date().toISOString().split('T')[0]}`,
      timestamp: new Date().toISOString(),
      gameState: { history: currentState.gameHistory, world: currentState.gameWorld },
      character: currentState.character,
      thumbnail: currentState.gameWorld.visualUrl
    };
    // Sanitize filename
    const safeName = save.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filename = `visceral_backup_${safeName}.json`;
    
    downloadFile(JSON.stringify(save, null, 2), filename, 'application/json');
    showToast("Reality state exported.", "success");
  }, [showToast]);

  const handleImport = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const save = JSON.parse(text) as GameSave;

      if (!save.gameState || !save.character) {
        throw new Error("Invalid save structure");
      }

      setGameHistory(save.gameState.history);
      setGameWorld(save.gameState.world);
      setCharacter(save.character);
      setView('game');
      showToast("Reality state reconstructed.", "success");
      setIsSettingsOpen(false);
    } catch (e) {
      console.error(e);
      showToast("Import failed. Corrupt data.", "error");
    }
  }, [setGameHistory, setGameWorld, setCharacter, setView, showToast, setIsSettingsOpen]);

  const saveToDb = useCallback(async (name: string, isAutosave = false) => {
    try {
      const currentState = useGameStore.getState();
      await db.saveGame({
        id: isAutosave ? 'autosave_slot' as any : generateMessageId() as any, 
        name,
        timestamp: new Date().toISOString(),
        gameState: { history: currentState.gameHistory, world: currentState.gameWorld },
        character: currentState.character
      });
      if (!isAutosave) {
        showToast("Checkpoint saved to Core.", "success");
      }
    } catch (e) {
      console.error("Save Error:", e);
      if (!isAutosave) showToast("Save failed.", "error");
    }
  }, [showToast]);

  const loadFromDb = useCallback(async (name: string) => {
    try {
      const save = await db.loadGame(name);
      if (save) {
        setGameHistory({ ...save.gameState.history, isThinking: false });
        setGameWorld({ ...save.gameState.world });
        setCharacter({ ...save.character });
        setView('game');
        showToast("Reality restored.", "success");
      } else {
        showToast("Save file not found.", "error");
      }
    } catch (e) {
      console.error("Load Error:", e);
      showToast("Load failed.", "error");
    }
  }, [setGameHistory, setGameWorld, setCharacter, setView, showToast]);

  // Autosave Effect with Cleanup
  const debouncedAutosave = useRef(
    debounce(() => {
        if (isInitialized.current) {
            saveToDb('AUTOSAVE', true);
        }
    }, TIMING.AUTOSAVE_DEBOUNCE)
  ).current;

  useEffect(() => {
    if (isInitialized.current) {
        debouncedAutosave();
    }
    return () => {
        debouncedAutosave.cancel();
    };
  }, [
    gameHistory.history.length, 
    gameHistory.turnCount, 
    character, 
    gameWorld.sceneMode, 
    gameWorld.knownEntities.length,
    debouncedAutosave
  ]);

  return {
    handleExport,
    handleImport,
    saveToDb,
    loadFromDb
  };
};
